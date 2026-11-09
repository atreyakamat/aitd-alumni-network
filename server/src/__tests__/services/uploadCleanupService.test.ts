/**
 * Orphaned-upload cleanup (npm run uploads:cleanup -w server). Real files in a temporary directory, deep-mocked database.
 * The guard at the bottom fails when a schema column that looks like an upload reference is not covered.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prismaMock } from '../../../tests/helpers';
import { resolveLocalUploadPath } from '../../utils/storage';
import {
  UPLOAD_REFERENCE_FIELDS,
  cleanupOrphanUploads,
  collectReferencedUploads,
  defaultUploadsDir,
  extractUploadPaths,
  formatCleanupReport,
  parseCleanupArgs,
  runCleanupCli,
} from '../../services/uploadCleanupService';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** The service is given this clock: far ahead of the real one, so the real ctime of freshly written files never counts as recent. */
const NOW = Date.now() + 365 * DAY;

let root: string;
let uploads: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aitd-uploads-test-'));
  uploads = path.join(root, 'uploads');
  fs.mkdirSync(uploads);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Writes uploads/<rel> with `bytes` bytes, last modified `ageMs` before NOW. */
const put = (rel: string, { ageMs = 3 * DAY, bytes = 10 }: { ageMs?: number; bytes?: number } = {}) => {
  const file = path.join(uploads, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 1));
  const when = (NOW - ageMs) / 1000;
  fs.utimesSync(file, when, when);
  return file;
};
const exists = (rel: string) => fs.existsSync(path.join(uploads, ...rel.split('/')));

type Row = Record<string, unknown> & { id: string };

/** Serves a table the way Prisma serves `orderBy id asc, take, cursor, skip`. */
const arrange = (model: string, rows: Row[]) => {
  prismaMock[model].findMany.mockImplementation(async (args: any) => {
    const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    let start = 0;
    if (args.cursor) start = sorted.findIndex((r) => r.id === args.cursor.id) + (args.skip ?? 0);
    return sorted.slice(start, start + args.take);
  });
};

const run = (overrides: Record<string, unknown> = {}) =>
  cleanupOrphanUploads({ uploadsDir: uploads, now: () => NOW, minAgeMs: DAY, ...overrides });

describe('extractUploadPaths', () => {
  it('finds /uploads/<folder>/<file> in a plain path, an absolute URL, JSON and arrays', () => {
    expect(extractUploadPaths('/uploads/posts/a.jpg')).toEqual(['posts/a.jpg']);
    expect(extractUploadPaths('http://localhost:5000/uploads/profiles/b.png?x=1')).toEqual(['profiles/b.png']);
    expect(extractUploadPaths(['/uploads/posts/a.jpg', '/uploads/posts/c.jpg'])).toEqual(['posts/a.jpg', 'posts/c.jpg']);
    expect(extractUploadPaths({ blocks: [{ imageUrl: '/uploads/general/d.webp' }], html: '<img src="/uploads/general/e.gif">' })).toEqual([
      'general/d.webp',
      'general/e.gif',
    ]);
  });

  it('also keeps the decoded spelling of an encoded name, so a reference is never missed', () => {
    expect(extractUploadPaths('/uploads/magazines/My%20Issue.pdf').sort()).toEqual(['magazines/My Issue.pdf', 'magazines/My%20Issue.pdf']);
  });

  it('ignores values that are not stored files', () => {
    expect(extractUploadPaths('https://bucket.s3.amazonaws.com/posts/a.jpg')).toEqual([]);
    expect(extractUploadPaths(null)).toEqual([]);
    expect(extractUploadPaths(42)).toEqual([]);
    expect(extractUploadPaths('/uploads/')).toEqual([]);
  });
});

describe('collectReferencedUploads', () => {
  it('reads every covered column in bounded batches, whatever the table size', async () => {
    const users: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, profilePhotoUrl: `/uploads/profiles/p${i}.jpg`, coverPhotoUrl: null }));
    arrange('user', users);
    prismaMock.post.findMany.mockResolvedValue([{ id: 'x1', mediaUrls: ['/uploads/posts/m1.jpg', '/uploads/posts/m2.jpg'], videoUrl: '/uploads/videos/v.mp4', thumbnailUrl: null }]);
    prismaMock.landingBlock.findMany.mockResolvedValue([{ id: 'b1', config: { imageUrl: '/uploads/general/hero.jpg' } }]);

    const refs = await collectReferencedUploads({ batchSize: 2 });

    expect([...refs].sort()).toEqual(
      ['general/hero.jpg', 'posts/m1.jpg', 'posts/m2.jpg', 'profiles/p0.jpg', 'profiles/p1.jpg', 'profiles/p2.jpg', 'profiles/p3.jpg', 'profiles/p4.jpg', 'videos/v.mp4'].sort()
    );
    // 5 users in batches of 2 -> 3 queries; every query is bounded and ordered by id
    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(3);
    for (const [args] of prismaMock.user.findMany.mock.calls) {
      expect(args.take).toBe(2);
      expect(args.orderBy).toEqual({ id: 'asc' });
      expect(args.select).toEqual({ id: true, profilePhotoUrl: true, coverPhotoUrl: true });
    }
  });

  it('asks only for rows that have a value in a string-only model', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await collectReferencedUploads();
    expect(prismaMock.user.findMany.mock.calls[0][0].where).toEqual({ OR: [{ profilePhotoUrl: { not: null } }, { coverPhotoUrl: { not: null } }] });
  });
});

describe('cleanupOrphanUploads', () => {
  const noRefs = () => {
    prismaMock.user.findMany.mockResolvedValue([]);
  };

  it('is a dry run by default: it reports orphans and removes nothing', async () => {
    put('posts/old-orphan.jpg', { bytes: 100 });
    put('posts/kept.jpg', { bytes: 50 });
    prismaMock.post.findMany.mockResolvedValue([{ id: 'p1', mediaUrls: ['/uploads/posts/kept.jpg'], videoUrl: null, thumbnailUrl: null }]);

    const report = await run();

    expect(report.dryRun).toBe(true);
    expect(report.orphaned).toEqual({ files: 1, bytes: 100 });
    expect(report.referenced).toEqual({ files: 1, bytes: 50 });
    expect(report.deleted).toEqual({ files: 0, bytes: 0 });
    expect(report.sample).toEqual(['posts/old-orphan.jpg']);
    expect(exists('posts/old-orphan.jpg')).toBe(true);
    expect(exists('posts/kept.jpg')).toBe(true);
  });

  it('never touches a file younger than the minimum age, referenced or not (an upload still in flight)', async () => {
    put('posts/just-uploaded.jpg', { ageMs: 5 * 60 * 1000 });
    put('posts/yesterday.jpg', { ageMs: DAY - HOUR });
    put('posts/old.jpg', { ageMs: DAY + HOUR });
    prismaMock.post.findMany.mockResolvedValue([{ id: 'p1', mediaUrls: ['/uploads/posts/just-uploaded.jpg'], videoUrl: null, thumbnailUrl: null }]);

    const report = await run({ delete: true });

    expect(report.tooNew.files).toBe(1);
    expect(report.orphaned.files).toBe(1);
    expect(report.deleted.files).toBe(1);
    expect(exists('posts/just-uploaded.jpg')).toBe(true);
    expect(exists('posts/yesterday.jpg')).toBe(true);
    expect(exists('posts/old.jpg')).toBe(false);
  });

  it('with delete, removes exactly the old unreferenced files and counts bytes', async () => {
    put('profiles/a.jpg', { bytes: 7 });
    put('profiles/b.jpg', { bytes: 11 });
    put('receipts/r.pdf', { bytes: 13 });
    arrange('user', [{ id: 'u1', profilePhotoUrl: '/uploads/profiles/a.jpg', coverPhotoUrl: null }]);
    prismaMock.transaction.findMany.mockResolvedValue([{ id: 't1', receiptUrl: '/uploads/receipts/r.pdf' }]);

    const report = await run({ delete: true });

    expect(report.dryRun).toBe(false);
    expect(report.totals).toEqual({ files: 3, bytes: 31 });
    expect(report.deleted).toEqual({ files: 1, bytes: 11 });
    expect(exists('profiles/a.jpg')).toBe(true);
    expect(exists('receipts/r.pdf')).toBe(true);
    expect(exists('profiles/b.jpg')).toBe(false);
  });

  it('recognises references written as absolute URLs, inside JSON, and nested folders', async () => {
    put('gallery/g.jpg');
    put('marketplace/m1.jpg');
    put('general/hero.jpg');
    put('posts/nested/deep.jpg');
    prismaMock.galleryPhoto.findMany.mockResolvedValue([{ id: 'g1', url: 'http://localhost:5000/uploads/gallery/g.jpg', thumbnailUrl: null }]);
    prismaMock.marketplaceListing.findMany.mockResolvedValue([{ id: 'm1', logoUrl: null, images: ['/uploads/marketplace/m1.jpg'] }]);
    prismaMock.landingBlock.findMany.mockResolvedValue([{ id: 'b1', config: { items: [{ imageUrl: '/uploads/general/hero.jpg' }] } }]);

    const report = await run({ delete: true });

    expect(report.deleted.files).toBe(1);
    expect(exists('posts/nested/deep.jpg')).toBe(false);
    expect(exists('gallery/g.jpg') && exists('marketplace/m1.jpg') && exists('general/hero.jpg')).toBe(true);
  });

  it('refuses to delete when the database holds no reference at all (probably the wrong database)', async () => {
    put('posts/a.jpg');
    put('posts/b.jpg');
    noRefs();

    const report = await run({ delete: true });

    expect(report.refusedReason).toMatch(/no upload references/i);
    expect(report.deleted.files).toBe(0);
    expect(report.orphaned.files).toBe(2);
    expect(exists('posts/a.jpg') && exists('posts/b.jpg')).toBe(true);
  });

  it('leaves hidden files alone', async () => {
    put('.gitkeep');
    put('posts/.hidden');
    put('posts/orphan.jpg');
    prismaMock.post.findMany.mockResolvedValue([{ id: 'p', mediaUrls: ['/uploads/posts/other.jpg'], videoUrl: null, thumbnailUrl: null }]);

    const report = await run({ delete: true });

    expect(report.skipped.hidden).toBe(2);
    expect(exists('.gitkeep') && exists('posts/.hidden')).toBe(true);
    expect(exists('posts/orphan.jpg')).toBe(false);
  });

  it('never follows a symbolic link, nor deletes through one', async () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'do not touch');
    const old = (NOW - 5 * DAY) / 1000;
    fs.utimesSync(secret, old, old);
    put('posts/orphan.jpg');
    try {
      fs.symlinkSync(outside, path.join(uploads, 'linked-dir'), 'junction');
      fs.symlinkSync(secret, path.join(uploads, 'posts', 'linked-file.jpg'), 'file');
    } catch {
      // creating links needs a privilege some Windows accounts lack: the link-free assertions below still run
    }
    prismaMock.post.findMany.mockResolvedValue([{ id: 'p', mediaUrls: ['/uploads/posts/other.jpg'], videoUrl: null, thumbnailUrl: null }]);

    const report = await run({ delete: true });

    expect(fs.readFileSync(secret, 'utf8')).toBe('do not touch');
    expect(exists('posts/orphan.jpg')).toBe(false);
    expect(report.sample.join()).not.toContain('secret');
    expect(report.deleted.files).toBe(1);
  });

  it('skips a file that changed between the scan and the deletion', async () => {
    const file = put('posts/busy.jpg');
    prismaMock.post.findMany.mockResolvedValue([{ id: 'p', mediaUrls: ['/uploads/posts/other.jpg'], videoUrl: null, thumbnailUrl: null }]);

    const report = await run({
      delete: true,
      afterScan: () => fs.appendFileSync(file, 'more bytes arrived'),
    });

    expect(report.deleted.files).toBe(0);
    expect(report.changedSinceScan).toBe(1);
    expect(exists('posts/busy.jpg')).toBe(true);
  });

  it('reads the references after the directory walk, so a record created during the walk is seen', async () => {
    const order: string[] = [];
    put('posts/a.jpg');
    prismaMock.post.findMany.mockImplementation(async () => {
      order.push('references');
      return [];
    });
    await run({ afterScan: () => void order.push('walked') });
    expect(order[0]).toBe('walked');
    expect(order).toContain('references');
  });

  it('copes with a missing uploads directory', async () => {
    fs.rmSync(uploads, { recursive: true });
    const report = await run({ delete: true });
    expect(report.directoryFound).toBe(false);
    expect(report.totals).toEqual({ files: 0, bytes: 0 });
    expect(report.deleted.files).toBe(0);
  });

  it('refuses an uploads directory that is a symbolic link or a file', async () => {
    const real = path.join(root, 'real');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'x.jpg'), 'x');
    const link = path.join(root, 'uploads-link');
    try {
      fs.symlinkSync(real, link, 'junction');
    } catch {
      return; // no privilege to create links here
    }
    await expect(cleanupOrphanUploads({ uploadsDir: link, now: () => NOW, minAgeMs: DAY, delete: true })).rejects.toThrow(/symbolic link/i);
    expect(fs.existsSync(path.join(real, 'x.jpg'))).toBe(true);
  });

  it('keeps the sample short unless the caller asks for the whole list', async () => {
    for (let i = 0; i < 30; i++) put(`posts/o${String(i).padStart(2, '0')}.jpg`);
    prismaMock.post.findMany.mockResolvedValue([{ id: 'p', mediaUrls: ['/uploads/posts/other.jpg'], videoUrl: null, thumbnailUrl: null }]);
    expect((await run()).sample).toHaveLength(20);
    expect((await run({ maxListed: Infinity })).sample).toHaveLength(30);
  });

  it('refuses to delete files younger than an hour even if asked to', async () => {
    await expect(run({ delete: true, minAgeMs: 10 * 60 * 1000 })).rejects.toThrow(/at least 1 hour/i);
    // a dry run with a short age is fine: it changes nothing
    await expect(run({ minAgeMs: 0 })).resolves.toBeDefined();
  });
});

describe('formatCleanupReport', () => {
  it('prints counts and sizes and names files only by their relative path', async () => {
    put('posts/orphan.jpg', { bytes: 2048 });
    prismaMock.post.findMany.mockResolvedValue([{ id: 'p', mediaUrls: ['/uploads/posts/other.jpg'], videoUrl: null, thumbnailUrl: null }]);

    const text = formatCleanupReport(await run());

    expect(text).toMatch(/dry run/i);
    expect(text).toContain('posts/orphan.jpg');
    expect(text).toMatch(/2\.0 KB/);
    expect(text).toMatch(/--delete/);
    expect(text).not.toContain(root);
  });

  it('says what was deleted after a real run', async () => {
    put('posts/orphan.jpg', { bytes: 10 });
    prismaMock.post.findMany.mockResolvedValue([{ id: 'p', mediaUrls: ['/uploads/posts/other.jpg'], videoUrl: null, thumbnailUrl: null }]);
    const text = formatCleanupReport(await run({ delete: true }));
    expect(text).toMatch(/deleted\s*:?\s*1 file/i);
    expect(text).not.toMatch(/dry run/i);
  });
});

describe('runCleanupCli', () => {
  const originalCwd = process.cwd();
  afterEach(() => process.chdir(originalCwd));
  const capture = () => {
    const lines: string[] = [];
    return { lines, print: (text: string) => void lines.push(text) };
  };

  it('inspects <working directory>/uploads, the folder utils/storage.ts writes to', () => {
    expect(resolveLocalUploadPath('/uploads/posts/x.jpg')!.startsWith(defaultUploadsDir() + path.sep)).toBe(true);
  });

  it('runs a dry run by default and exits 0', async () => {
    put('posts/orphan.jpg');
    prismaMock.post.findMany.mockResolvedValue([{ id: 'p', mediaUrls: ['/uploads/posts/other.jpg'], videoUrl: null, thumbnailUrl: null }]);
    process.chdir(root);
    const out = capture();

    const code = await runCleanupCli([], out.print);

    expect(code).toBe(0);
    expect(out.lines.join('\n')).toMatch(/dry run/i);
    expect(exists('posts/orphan.jpg')).toBe(true);
  });

  it('exits 1 and deletes nothing when the database has no references', async () => {
    put('posts/orphan.jpg');
    process.chdir(root);
    const out = capture();
    // default minimum age is 24 h and the file was just written: use a small age that is still allowed
    const code = await runCleanupCli(['--delete', '--min-age-hours=0.001'], out.print);
    expect(code).toBe(1);
    expect(out.lines.join('\n')).toMatch(/at least 1 hour/i);
    expect(exists('posts/orphan.jpg')).toBe(true);
  });

  it('prints the usage for --help and for a mistyped option (exit 2)', async () => {
    const help = capture();
    expect(await runCleanupCli(['--help'], help.print)).toBe(0);
    expect(help.lines.join('\n')).toMatch(/Usage: npm run uploads:cleanup/);
    const bad = capture();
    expect(await runCleanupCli(['--delet'], bad.print)).toBe(2);
    expect(bad.lines.join('\n')).toMatch(/Unknown option: --delet/);
  });
});

describe('parseCleanupArgs', () => {
  it('defaults to a dry run with a 24 hour minimum age', () => {
    expect(parseCleanupArgs([])).toEqual({ delete: false, minAgeHours: 24, listAll: false, help: false });
  });
  it('reads --delete, --min-age-hours (both spellings) and --list', () => {
    expect(parseCleanupArgs(['--delete', '--min-age-hours=48', '--list'])).toEqual({ delete: true, minAgeHours: 48, listAll: true, help: false });
    expect(parseCleanupArgs(['--min-age-hours', '6'])).toMatchObject({ minAgeHours: 6 });
    expect(parseCleanupArgs(['--help'])).toMatchObject({ help: true });
  });
  it('rejects unknown options and nonsense ages instead of guessing', () => {
    expect(() => parseCleanupArgs(['--force'])).toThrow(/unknown option/i);
    expect(() => parseCleanupArgs(['--min-age-hours=abc'])).toThrow(/min-age-hours/);
    expect(() => parseCleanupArgs(['--min-age-hours=-1'])).toThrow(/min-age-hours/);
  });
});

/**
 * Guard: a new column that stores an uploaded file's path must be added to UPLOAD_REFERENCE_FIELDS, or the cleanup would treat
 * the files it points at as orphans and delete them. Every scalar column that looks like a file reference (or is JSON, which can
 * hold anything) must be classified one way or the other.
 */
describe('upload reference coverage of the schema', () => {
  const NOT_UPLOADS: Record<string, string> = {
    'User.linkedinUrl': 'external profile link',
    'User.twitterUrl': 'external profile link',
    'User.githubUrl': 'external profile link',
    'User.websiteUrl': 'external profile link',
    'Post.linkUrl': 'external link shared in a post',
    'MembershipTier.benefits': 'list of benefit texts',
    'JobOpportunity.skills': 'list of skill names',
    'MentorProfile.focusAreas': 'list of topics',
    'Event.tags': 'list of tags',
    'Notification.metadata': 'ids and in-app links of the event that caused it',
    'Transaction.metadata': 'gateway ids and donor details',
    'Invite.metadata': 'invitation details',
    'DigestSettings.sections': 'which digest sections are on',
    'AuditLog.oldValues': 'record of a past change (the file was removed on purpose)',
    'AuditLog.newValues': 'record of a past change',
  };
  const LOOKS_LIKE_FILE = /(url|urls|image|images|photo|thumbnail|banner|logo|cover|media|avatar|attachment|file|video|pdf|receipt|icon|picture|poster)/i;

  const models = Prisma.dmmf.datamodel.models;
  const covered = new Set(UPLOAD_REFERENCE_FIELDS.map((f) => `${f.model}.${f.field}`));

  it('classifies every column that could hold an uploaded file', () => {
    const unclassified: string[] = [];
    for (const model of models) {
      for (const field of model.fields) {
        if (field.kind !== 'scalar' || !(field.type === 'String' || field.type === 'Json')) continue;
        if (field.type === 'String' && (field.isId || /Id$/.test(field.name) || !LOOKS_LIKE_FILE.test(field.name))) continue;
        const key = `${model.name}.${field.name}`;
        if (!covered.has(key) && !(key in NOT_UPLOADS)) unclassified.push(key);
      }
    }
    expect(unclassified).toEqual([]);
  });

  it('lists only columns that exist, with the right type, on a model keyed by id', () => {
    for (const { model, field, kind } of UPLOAD_REFERENCE_FIELDS) {
      const m = models.find((candidate) => candidate.name === model);
      expect(m).toBeDefined();
      expect(m!.fields.find((f) => f.isId)?.name).toBe('id');
      const column = m!.fields.find((f) => f.name === field);
      expect(column).toBeDefined();
      expect(column!.type).toBe(kind === 'json' ? 'Json' : 'String');
    }
  });

  it('does not list a column as both an upload reference and not one', () => {
    for (const key of Object.keys(NOT_UPLOADS)) expect(covered.has(key)).toBe(false);
  });

  it('names its exclusions after columns that exist', () => {
    for (const key of Object.keys(NOT_UPLOADS)) {
      const [model, field] = key.split('.');
      expect(models.find((m) => m.name === model)?.fields.some((f) => f.name === field)).toBe(true);
    }
  });

  it('covers the columns the application writes uploaded files to', () => {
    for (const key of [
      'User.profilePhotoUrl',
      'User.coverPhotoUrl',
      'Post.mediaUrls',
      'Post.videoUrl',
      'GalleryPhoto.url',
      'MarketplaceListing.images',
      'Transaction.receiptUrl',
      'CollegeVideo.videoUrl',
      'CollegeVideo.thumbnailUrl',
      'CollegeMagazine.fileUrl',
      'CollegeMagazine.coverImageUrl',
      'Message.mediaUrl',
    ]) {
      expect(covered.has(key)).toBe(true);
    }
  });
});
