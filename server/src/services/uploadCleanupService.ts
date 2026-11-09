/**
 * Orphaned-upload cleanup: `npm run uploads:cleanup -w server` (see docs/ROBUSTNESS.md).
 *
 * A file is stored before the record that points at it. If the record is then rejected, or removed by a path that does not
 * delete the file, the file stays in the uploads directory for ever. This walks the local uploads directory, collects every
 * `/uploads/<folder>/<file>` reference the database holds, and reports the files nothing refers to and that are older than a
 * minimum age (24 hours by default, so an upload that is still being attached is never touched).
 *
 * Safety rules, in the order they matter:
 *  - A dry run is the default; files are removed only with `--delete`.
 *  - Nothing outside the uploads directory is ever read or removed: symbolic links (files and directories) are not
 *    followed, hidden files are left alone, and every deletion re-checks the path and that the file did not change.
 *  - The references are read AFTER the directory walk, so a record created while it runs is seen.
 *  - A database with no upload reference at all while files exist is treated as "probably the wrong database": nothing is deleted.
 *  - Only the names (relative to the uploads directory) and sizes of files are reported; contents are never read.
 *
 * It inspects the local directory only. With S3 configured, files live in the bucket: use a lifecycle rule there.
 * Account deletion keeps stored files on purpose (documented decision); this does not change that: a file is kept as long
 * as any record, including an anonymised one, still refers to it.
 */
import fs from 'fs';
import path from 'path';
import prisma from '../config/database';

// ---------------------------------------------------------------------------
// Which columns hold uploaded-file references
// ---------------------------------------------------------------------------

export type UploadReferenceKind = 'string' | 'json';

export interface UploadReferenceField {
  /** Prisma model name (schema.prisma). */
  model: string;
  field: string;
  /** `json` columns (arrays of URLs, page-builder config) are searched as text. */
  kind: UploadReferenceKind;
}

/**
 * Every column that can hold the path of a file this application stored. Guarded by a test against the Prisma schema
 * (src/__tests__/services/uploadCleanupService.test.ts): a new `...Url`/`images`/JSON column fails it until it is either
 * listed here or declared "not an upload" there. Forgetting one would make the cleanup delete files still in use.
 */
export const UPLOAD_REFERENCE_FIELDS: readonly UploadReferenceField[] = [
  { model: 'User', field: 'profilePhotoUrl', kind: 'string' },
  { model: 'User', field: 'coverPhotoUrl', kind: 'string' },
  { model: 'Post', field: 'mediaUrls', kind: 'json' },
  { model: 'Post', field: 'videoUrl', kind: 'string' },
  { model: 'Post', field: 'thumbnailUrl', kind: 'string' },
  { model: 'Event', field: 'bannerUrl', kind: 'string' },
  { model: 'GalleryAlbum', field: 'coverPhotoUrl', kind: 'string' },
  { model: 'GalleryPhoto', field: 'url', kind: 'string' },
  { model: 'GalleryPhoto', field: 'thumbnailUrl', kind: 'string' },
  { model: 'NewsArticle', field: 'featuredImage', kind: 'string' },
  { model: 'Chapter', field: 'logoUrl', kind: 'string' },
  { model: 'MarketplaceListing', field: 'logoUrl', kind: 'string' },
  { model: 'MarketplaceListing', field: 'images', kind: 'json' },
  { model: 'Message', field: 'mediaUrl', kind: 'string' },
  { model: 'Transaction', field: 'receiptUrl', kind: 'string' },
  { model: 'CollegeVideo', field: 'videoUrl', kind: 'string' },
  { model: 'CollegeVideo', field: 'thumbnailUrl', kind: 'string' },
  { model: 'CollegeMagazine', field: 'coverImageUrl', kind: 'string' },
  { model: 'CollegeMagazine', field: 'fileUrl', kind: 'string' },
  { model: 'LandingBlock', field: 'config', kind: 'json' },
];

export const DEFAULT_MIN_AGE_HOURS = 24;
/** Deleting is refused for files younger than this: a file that young may be an upload still being attached. */
export const MIN_DELETE_AGE_MS = 60 * 60 * 1000;
export const REFERENCE_BATCH_SIZE = 1000;
const DEFAULT_SAMPLE = 20;
const MAX_DEPTH = 6;

/** Where utils/storage.ts writes local uploads (relative to the working directory, which is the server folder). */
export const defaultUploadsDir = (): string => path.resolve(process.cwd(), 'uploads');

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const UPLOAD_PATH = /\/uploads\/([^\s"'<>\\?#()]+)/g;

const decodeSafely = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Every `/uploads/<path>` mentioned anywhere in a value (a plain path, an absolute URL, a JSON array, nested JSON), as paths
 * relative to the uploads directory. Both the spelling found and its URL-decoded form are returned: keeping too much is
 * the safe direction.
 */
export const extractUploadPaths = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string') return [];
  const found = new Set<string>();
  for (const match of text.matchAll(UPLOAD_PATH)) {
    const raw = match[1].replace(/\/+$/, '');
    if (!raw) continue;
    found.add(raw);
    found.add(decodeSafely(raw));
  }
  return [...found];
};

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

/** All references held by the database, as paths relative to the uploads directory. Reads in bounded batches by id. */
export const collectReferencedUploads = async (options: { batchSize?: number } = {}): Promise<Set<string>> => {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? REFERENCE_BATCH_SIZE));
  const byModel = new Map<string, UploadReferenceField[]>();
  for (const field of UPLOAD_REFERENCE_FIELDS) byModel.set(field.model, [...(byModel.get(field.model) ?? []), field]);

  const references = new Set<string>();
  for (const [model, fields] of byModel) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (prisma as any)[delegateName(model)];
    const select: Record<string, true> = { id: true };
    for (const { field } of fields) select[field] = true;
    // A string-only model can skip rows with nothing in the columns; JSON columns are read as they are
    const where = fields.every((f) => f.kind === 'string') ? { OR: fields.map((f) => ({ [f.field]: { not: null } })) } : undefined;

    let cursor: string | undefined;
    for (;;) {
      const rows: Array<Record<string, unknown> & { id: string }> =
        (await delegate.findMany({
          ...(where ? { where } : {}),
          select,
          orderBy: { id: 'asc' },
          take: batchSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })) ?? [];
      for (const row of rows) {
        for (const { field } of fields) for (const found of extractUploadPaths(row[field])) references.add(found);
      }
      if (rows.length < batchSize) break;
      cursor = rows[rows.length - 1].id;
    }
  }
  return references;
};

// ---------------------------------------------------------------------------
// Walking the uploads directory
// ---------------------------------------------------------------------------

interface UploadFile {
  /** Path relative to the uploads directory, with forward slashes. */
  rel: string;
  size: number;
  mtimeMs: number;
  /** Last time the file or its metadata changed: the later of mtime and ctime. */
  changedMs: number;
}

interface Walked {
  files: UploadFile[];
  skipped: { hidden: number; symlinks: number; other: number };
}

const isInside = (parent: string, child: string) => child === parent || child.startsWith(parent + path.sep);

const walkUploads = async (root: string, realRoot: string): Promise<Walked> => {
  const files: UploadFile[] = [];
  const skipped = { hidden: 0, symlinks: 0, other: 0 };
  const pending: Array<{ abs: string; rel: string; depth: number }> = [{ abs: root, rel: '', depth: 0 }];

  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir.abs, { withFileTypes: true });
    } catch {
      skipped.other++;
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir.abs, entry.name);
      const rel = dir.rel ? `${dir.rel}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.')) {
        skipped.hidden++;
      } else if (entry.isSymbolicLink()) {
        skipped.symlinks++;
      } else if (entry.isDirectory()) {
        // A directory that resolves outside the uploads directory (a junction, a bind mount) is not entered
        let real: string;
        try {
          real = await fs.promises.realpath(abs);
        } catch {
          skipped.other++;
          continue;
        }
        if (dir.depth + 1 > MAX_DEPTH || !isInside(realRoot, real)) skipped.other++;
        else pending.push({ abs, rel, depth: dir.depth + 1 });
      } else if (entry.isFile()) {
        try {
          const stat = await fs.promises.lstat(abs);
          if (!stat.isFile()) {
            skipped.other++;
            continue;
          }
          files.push({ rel, size: stat.size, mtimeMs: stat.mtimeMs, changedMs: Math.max(stat.mtimeMs, stat.ctimeMs) });
        } catch {
          skipped.other++;
        }
      } else {
        skipped.other++;
      }
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { files, skipped };
};

// ---------------------------------------------------------------------------
// The cleanup
// ---------------------------------------------------------------------------

export interface CleanupOptions {
  /** The uploads directory to inspect. */
  uploadsDir: string;
  /** Files changed more recently than this are never candidates. Default 24 hours. */
  minAgeMs?: number;
  /** Remove the orphans. Without it nothing is changed. */
  delete?: boolean;
  /** How many orphan names to include in the report (default 20). */
  maxListed?: number;
  now?: () => number;
  batchSize?: number;
  /** Test seam: runs right after the directory walk, before the database is read. */
  afterScan?: () => void | Promise<void>;
}

interface Tally {
  files: number;
  bytes: number;
}

export interface CleanupReport {
  dryRun: boolean;
  directoryFound: boolean;
  minAgeHours: number;
  totals: Tally;
  /** Files something refers to. */
  referenced: Tally;
  /** Not referenced, but changed too recently to judge. */
  tooNew: Tally;
  /** Not referenced and old enough: the candidates. */
  orphaned: Tally;
  deleted: Tally;
  /** Candidates that were modified between the scan and the deletion and so were left alone. */
  changedSinceScan: number;
  /** Deletions that failed (permissions, file in use). */
  failed: number;
  skipped: Walked['skipped'];
  /** Distinct upload paths the database refers to. */
  referencesInDatabase: number;
  /** Relative names of (some of) the orphans. */
  sample: string[];
  /** Set when a requested deletion was not carried out. */
  refusedReason?: string;
}

const empty = (): Tally => ({ files: 0, bytes: 0 });
const add = (tally: Tally, file: UploadFile) => {
  tally.files++;
  tally.bytes += file.size;
};

export const cleanupOrphanUploads = async (options: CleanupOptions): Promise<CleanupReport> => {
  const now = options.now ?? Date.now;
  const minAgeMs = options.minAgeMs ?? DEFAULT_MIN_AGE_HOURS * 60 * 60 * 1000;
  const wantDelete = options.delete === true;
  if (!Number.isFinite(minAgeMs) || minAgeMs < 0) throw new Error('The minimum age must be zero or more.');
  if (wantDelete && minAgeMs < MIN_DELETE_AGE_MS) {
    throw new Error('Deleting needs a minimum age of at least 1 hour: a younger file may be an upload that is still being attached.');
  }

  const report: CleanupReport = {
    dryRun: !wantDelete,
    directoryFound: false,
    minAgeHours: minAgeMs / (60 * 60 * 1000),
    totals: empty(),
    referenced: empty(),
    tooNew: empty(),
    orphaned: empty(),
    deleted: empty(),
    changedSinceScan: 0,
    failed: 0,
    skipped: { hidden: 0, symlinks: 0, other: 0 },
    referencesInDatabase: 0,
    sample: [],
  };

  const root = path.resolve(options.uploadsDir);
  let rootStat: fs.Stats;
  try {
    rootStat = await fs.promises.lstat(root);
  } catch {
    return report; // nothing stored locally yet
  }
  if (rootStat.isSymbolicLink()) throw new Error('The uploads directory is a symbolic link; refusing to scan it.');
  if (!rootStat.isDirectory()) throw new Error('The uploads path is not a directory.');
  report.directoryFound = true;
  const realRoot = await fs.promises.realpath(root);

  const walked = await walkUploads(realRoot, realRoot);
  report.skipped = walked.skipped;
  await options.afterScan?.();

  // After the walk: a record created while it ran refers to a file the walk may already have listed
  const references = await collectReferencedUploads({ batchSize: options.batchSize });
  report.referencesInDatabase = references.size;

  const orphans: UploadFile[] = [];
  const at = now();
  for (const file of walked.files) {
    add(report.totals, file);
    if (references.has(file.rel)) {
      add(report.referenced, file);
    } else if (at - file.changedMs < minAgeMs) {
      add(report.tooNew, file);
    } else {
      add(report.orphaned, file);
      orphans.push(file);
    }
  }
  const listed = options.maxListed ?? DEFAULT_SAMPLE;
  report.sample = orphans.slice(0, listed).map((f) => f.rel);

  if (!wantDelete || orphans.length === 0) return report;

  if (references.size === 0) {
    report.refusedReason =
      'No upload references were found in the database although files exist. This looks like the wrong database (or an empty one), so nothing was deleted.';
    return report;
  }

  for (const file of orphans) {
    const abs = path.resolve(realRoot, ...file.rel.split('/'));
    try {
      if (!isInside(realRoot, abs) || abs === realRoot) throw new Error('outside');
      const stat = await fs.promises.lstat(abs);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('not a regular file');
      if (stat.mtimeMs !== file.mtimeMs || stat.size !== file.size) {
        report.changedSinceScan++;
        continue;
      }
      // The directory the file sits in must still resolve inside the uploads directory
      if (!isInside(realRoot, await fs.promises.realpath(path.dirname(abs)))) throw new Error('outside');
      await fs.promises.unlink(abs);
      add(report.deleted, file);
    } catch {
      report.failed++;
    }
  }
  return report;
};

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

export interface CleanupArgs {
  delete: boolean;
  minAgeHours: number;
  listAll: boolean;
  help: boolean;
}

export const CLEANUP_USAGE = [
  'Usage: npm run uploads:cleanup -w server -- [--delete] [--min-age-hours N] [--list]',
  '',
  '  (no options)        dry run: report the unreferenced files, change nothing',
  '  --delete            remove the unreferenced files that are old enough',
  `  --min-age-hours N   only files not changed for N hours are candidates (default ${DEFAULT_MIN_AGE_HOURS}; deleting needs at least 1)`,
  '  --list              name every candidate instead of the first 20',
  '  --help              this text',
].join('\n');

export const parseCleanupArgs = (argv: string[]): CleanupArgs => {
  const args: CleanupArgs = { delete: false, minAgeHours: DEFAULT_MIN_AGE_HOURS, listAll: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--delete') args.delete = true;
    else if (arg === '--list') args.listAll = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--min-age-hours' || arg.startsWith('--min-age-hours=')) {
      const raw = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i];
      const hours = raw !== undefined && raw.trim() !== '' ? Number(raw) : Number.NaN;
      if (!Number.isFinite(hours) || hours < 0) throw new Error('--min-age-hours needs a number of hours, zero or more.');
      args.minAgeHours = hours;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const line = (label: string, tally: Tally) => `  ${label.padEnd(34)} ${plural(tally.files, 'file')}, ${formatBytes(tally.bytes)}`;

/** The summary printed by the command: counts, sizes and relative names only. */
export const formatCleanupReport = (report: CleanupReport): string => {
  const out: string[] = [];
  out.push(report.dryRun ? 'Orphaned uploads: DRY RUN (nothing is deleted)' : 'Orphaned uploads: DELETE run');
  if (!report.directoryFound) {
    out.push('  There is no local uploads directory, so there is nothing to check.');
    return out.join('\n');
  }
  out.push(line('In the uploads directory', report.totals));
  out.push(line('Referenced by the database', report.referenced));
  out.push(line(`Unreferenced, newer than ${report.minAgeHours} h`, report.tooNew));
  out.push(line(`Unreferenced and old enough`, report.orphaned));
  if (!report.dryRun) out.push(line('Deleted', report.deleted));
  const notes: string[] = [];
  const skippedTotal = report.skipped.hidden + report.skipped.symlinks + report.skipped.other;
  if (skippedTotal > 0) {
    notes.push(`Left alone: ${report.skipped.hidden} hidden, ${report.skipped.symlinks} symbolic links, ${report.skipped.other} other entries.`);
  }
  if (report.changedSinceScan > 0) notes.push(`${plural(report.changedSinceScan, 'file')} changed while the command ran and were kept.`);
  if (report.failed > 0) notes.push(`${plural(report.failed, 'deletion')} failed.`);
  if (report.refusedReason) notes.push(report.refusedReason);
  if (notes.length > 0) out.push('', ...notes.map((n) => `  ${n}`));

  if (report.sample.length > 0) {
    out.push('', report.dryRun ? '  Would delete:' : '  Candidates were:');
    for (const name of report.sample) out.push(`    ${name}`);
    if (report.orphaned.files > report.sample.length) {
      out.push(`    ... and ${report.orphaned.files - report.sample.length} more (--list names them all)`);
    }
  }
  if (report.dryRun && report.orphaned.files > 0) {
    out.push('', '  Run again with --delete to remove these files.');
  }
  return out.join('\n');
};

/**
 * Runs the command: parses the arguments, runs the cleanup on the local uploads directory, prints the summary.
 * Returns the exit code (0 done, 1 something was refused or failed, 2 bad usage). Also reachable from the built image:
 *   docker compose exec api node -e "require('./dist/services/uploadCleanupService').runCleanupCli(process.argv.slice(1)).then(process.exit)" -- --min-age-hours 48
 */
export const runCleanupCli = async (argv: string[], print: (text: string) => void = (text) => void process.stdout.write(`${text}\n`)): Promise<number> => {
  let args: CleanupArgs;
  try {
    args = parseCleanupArgs(argv);
  } catch (error) {
    print(`${(error as Error).message}\n\n${CLEANUP_USAGE}`);
    return 2;
  }
  if (args.help) {
    print(CLEANUP_USAGE);
    return 0;
  }
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    print('Note: S3 storage is configured. This command only inspects the local uploads directory; use a bucket lifecycle rule for S3.\n');
  }
  try {
    const report = await cleanupOrphanUploads({
      uploadsDir: defaultUploadsDir(),
      minAgeMs: args.minAgeHours * 60 * 60 * 1000,
      delete: args.delete,
      maxListed: args.listAll ? Infinity : DEFAULT_SAMPLE,
    });
    print(formatCleanupReport(report));
    return report.refusedReason || report.failed > 0 ? 1 : 0;
  } catch (error) {
    print(`Cleanup stopped: ${(error as Error).message}`);
    return 1;
  }
};
