import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { Actor } from '../config/permissions';
import { buildPaginationResponse, paginationHelper, ilike } from '../utils/helpers';
import { normalizeEnrollment, normalizeName } from '../utils/alumniNormalize';
import { logAuditAction } from './auditService';

/**
 * The college alumni list: the people the college knows as alumni, imported by an administrator (the browser parses the
 * CSV and sends JSON, so there is no file upload surface), and what a registration is checked against in the review
 * queue.
 *
 * These rows are personal data of people who have NOT registered. Only administrators can reach them (the routes), the
 * review queue shows nothing but the match level, the reason and the matched record's batch and department, audit
 * entries carry counts and never names or numbers, and nothing here ever logs a row.
 */

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_ERRORS = 20;

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 100;
const MAX_DEPARTMENT_LENGTH = 100;
const MAX_ENROLLMENT_LENGTH = 50;
const MIN_BATCH_YEAR = 1950;
const MAX_BATCH_YEARS_AHEAD = 5;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export interface AlumniRequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export type MatchLevel = 'exact' | 'probable' | 'none';

/** What the review queue shows for one registration. Never anything of another person's record beyond batch and department. */
export interface ApprovalMatch {
  level: MatchLevel;
  reason: string;
  recordId?: string;
  record?: { batchYear: number; department: string | null };
}

export interface ApplicantForMatch {
  id: string;
  fullName: string;
  batchYear?: number | null;
  enrollmentNumber?: string | null;
}

interface CleanRow {
  fullName: string;
  nameKey: string;
  batchYear: number;
  department: string | null;
  enrollmentNumber: string | null;
}

const invalid = (message: string) => new AppError(message, 400, 'VALIDATION_ERROR');

/** One row of the import, or the reason it cannot be used. */
const cleanRow = (raw: unknown): CleanRow | string => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'The row is not an object';
  const row = raw as Record<string, unknown>;

  if (typeof row.fullName !== 'string') return 'The name is missing';
  const fullName = row.fullName.trim().replace(/\s+/gu, ' ');
  if (fullName.length < MIN_NAME_LENGTH) return `The name must be at least ${MIN_NAME_LENGTH} characters`;
  if (fullName.length > MAX_NAME_LENGTH) return `The name must be at most ${MAX_NAME_LENGTH} characters`;
  const nameKey = normalizeName(fullName);
  if (!nameKey) return 'The name is missing';

  const year = typeof row.batchYear === 'string' && /^\s*\d{4}\s*$/u.test(row.batchYear) ? Number(row.batchYear) : row.batchYear;
  const latest = new Date().getFullYear() + MAX_BATCH_YEARS_AHEAD;
  if (typeof year !== 'number' || !Number.isInteger(year)) return 'The batch year must be a four-digit year';
  if (year < MIN_BATCH_YEAR || year > latest) return `The batch year must be between ${MIN_BATCH_YEAR} and ${latest}`;

  let department: string | null = null;
  if (row.department !== undefined && row.department !== null) {
    if (typeof row.department !== 'string') return 'The department must be text';
    department = row.department.trim().replace(/\s+/gu, ' ') || null;
    if (department && department.length > MAX_DEPARTMENT_LENGTH) return `The department must be at most ${MAX_DEPARTMENT_LENGTH} characters`;
  }

  let enrollmentNumber: string | null = null;
  if (row.enrollmentNumber !== undefined && row.enrollmentNumber !== null) {
    if (typeof row.enrollmentNumber !== 'string') return 'The enrolment number must be text';
    enrollmentNumber = normalizeEnrollment(row.enrollmentNumber);
    if (enrollmentNumber && enrollmentNumber.length > MAX_ENROLLMENT_LENGTH) {
      return `The enrolment number must be at most ${MAX_ENROLLMENT_LENGTH} characters`;
    }
    if (enrollmentNumber && CONTROL_CHARACTERS.test(enrollmentNumber)) return 'The enrolment number contains characters that are not allowed';
  }

  return { fullName, nameKey, batchYear: year, department, enrollmentNumber };
};

/** Rows without an enrolment number are recognised again by who they are: name, batch and department. */
const personKey = (row: Pick<CleanRow, 'nameKey' | 'batchYear' | 'department'>) =>
  `${row.batchYear}|${row.nameKey}|${(row.department ?? '').toLowerCase()}`;

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export interface AlumniListFilters {
  search?: string;
  page?: number | string;
  limit?: number | string;
}

const LIST_SELECT = {
  id: true,
  fullName: true,
  batchYear: true,
  department: true,
  enrollmentNumber: true,
  createdAt: true,
} satisfies Prisma.AlumniRecordSelect;

class AlumniRecordService {
  /**
   * Imports one request's worth of rows (at most MAX_IMPORT_ROWS). Upserts by enrolment number; rows without one are
   * recognised by name, batch and department so that importing the same file twice does not duplicate them. A bad row
   * never stops the others. `created + updated + skipped` always equals the number of rows sent.
   */
  async importRows(actor: Pick<Actor, 'id'>, rows: unknown, meta: AlumniRequestMeta = {}): Promise<ImportResult> {
    if (!Array.isArray(rows) || rows.length === 0) throw invalid('Send at least one row');
    if (rows.length > MAX_IMPORT_ROWS) throw invalid(`Send at most ${MAX_IMPORT_ROWS} rows per request`);

    const errors: ImportResult['errors'] = [];
    let skipped = 0;
    const reject = (row: number, message: string) => {
      skipped += 1;
      if (errors.length < MAX_IMPORT_ERRORS) errors.push({ row, message });
    };

    // 1. Validate, and drop what repeats inside the file itself
    const clean: Array<{ row: number; data: CleanRow }> = [];
    const firstSeen = new Map<string, number>();
    rows.forEach((raw, index) => {
      const row = index + 1;
      const data = cleanRow(raw);
      if (typeof data === 'string') return reject(row, data);
      const key = data.enrollmentNumber ? `n|${data.enrollmentNumber}` : `p|${personKey(data)}`;
      const earlier = firstSeen.get(key);
      if (earlier !== undefined) {
        return reject(row, data.enrollmentNumber ? `Same enrolment number as row ${earlier}` : `Same person as row ${earlier}`);
      }
      firstSeen.set(key, row);
      clean.push({ row, data });
    });

    // 2. What is stored already: one query for the whole request
    const numbers = clean.map((c) => c.data.enrollmentNumber).filter((n): n is string => !!n);
    const anonymous = clean.filter((c) => !c.data.enrollmentNumber);
    const wanted: Prisma.AlumniRecordWhereInput[] = [];
    if (numbers.length) wanted.push({ enrollmentNumber: { in: numbers } });
    if (anonymous.length) {
      wanted.push({
        enrollmentNumber: null,
        batchYear: { in: [...new Set(anonymous.map((c) => c.data.batchYear))] },
        nameKey: { in: [...new Set(anonymous.map((c) => c.data.nameKey))] },
      });
    }
    const existing = wanted.length
      ? await prisma.alumniRecord.findMany({
          where: { OR: wanted },
          select: { id: true, fullName: true, nameKey: true, batchYear: true, department: true, enrollmentNumber: true },
        })
      : [];
    const byNumber = new Map(existing.filter((r) => r.enrollmentNumber).map((r) => [r.enrollmentNumber as string, r]));
    const byPerson = new Set(existing.filter((r) => !r.enrollmentNumber).map((r) => personKey(r)));

    // 3. Decide per row
    const toCreate: Prisma.AlumniRecordCreateManyInput[] = [];
    const toUpdate: Array<{ id: string; data: Prisma.AlumniRecordUpdateManyMutationInput }> = [];
    for (const { data } of clean) {
      if (data.enrollmentNumber) {
        const found = byNumber.get(data.enrollmentNumber);
        if (!found) {
          toCreate.push({ ...data, importedById: actor.id });
        } else if (
          found.fullName !== data.fullName ||
          found.batchYear !== data.batchYear ||
          (data.department !== null && found.department !== data.department)
        ) {
          toUpdate.push({
            id: found.id,
            data: {
              fullName: data.fullName,
              nameKey: data.nameKey,
              batchYear: data.batchYear,
              ...(data.department !== null ? { department: data.department } : {}),
            },
          });
        } else {
          skipped += 1;
        }
      } else if (byPerson.has(personKey(data))) {
        skipped += 1;
      } else {
        toCreate.push({ ...data, importedById: actor.id });
      }
    }

    // 4. Write
    let created = 0;
    if (toCreate.length) {
      const result = await prisma.alumniRecord.createMany({ data: toCreate, skipDuplicates: true });
      created = result.count;
      // a row that lost a race against a concurrent import (the unique enrolment number) wrote nothing
      skipped += toCreate.length - created;
    }
    let updated = 0;
    if (toUpdate.length) {
      const results = await prisma.$transaction(
        toUpdate.map(({ id, data }) => prisma.alumniRecord.updateMany({ where: { id }, data: { ...data, importedById: actor.id } }))
      );
      updated = results.filter((r) => r.count > 0).length;
      skipped += toUpdate.length - updated;
    }

    // Counts only: the rows are personal data of people who have not registered and are never logged or audited
    await logAuditAction({
      userId: actor.id,
      action: 'IMPORT',
      entityType: 'ALUMNI_RECORD',
      newValues: { rows: rows.length, created, updated, skipped },
      ...meta,
    });

    return { created, updated, skipped, errors };
  }

  async list(filters: AlumniListFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const { skip, take } = paginationHelper(page, limit);

    const where: Prisma.AlumniRecordWhereInput = {};
    const search = trimmed(filters.search);
    if (search) {
      const number = normalizeEnrollment(search);
      where.OR = [{ fullName: ilike(search) }, { department: ilike(search) }];
      if (number) where.OR.push({ enrollmentNumber: { contains: number } });
      if (/^\d{4}$/u.test(search)) where.OR.push({ batchYear: Number(search) });
    }

    const [rows, total] = await Promise.all([
      prisma.alumniRecord.findMany({ where, select: LIST_SELECT, orderBy: [{ batchYear: 'desc' }, { fullName: 'asc' }], skip, take }),
      prisma.alumniRecord.count({ where }),
    ]);
    return buildPaginationResponse(rows, total, page, limit);
  }

  async count(): Promise<number> {
    return prisma.alumniRecord.count();
  }

  async remove(actor: Pick<Actor, 'id'>, id: string, meta: AlumniRequestMeta = {}) {
    const record = await prisma.alumniRecord.findUnique({ where: { id }, select: { id: true, batchYear: true } });
    if (!record) throw new AppError('Record not found', 404, 'NOT_FOUND');
    const removed = await prisma.alumniRecord.deleteMany({ where: { id } });
    if (removed.count !== 1) throw new AppError('Record not found', 404, 'NOT_FOUND');

    // No name and no number: the audit trail outlives the list
    await logAuditAction({
      userId: actor.id,
      action: 'DELETE',
      entityType: 'ALUMNI_RECORD',
      entityId: id,
      oldValues: { batchYear: record.batchYear },
      ...meta,
    });
    return { id };
  }

  /**
   * Matches a whole page of registrations against the list with ONE query. The result says how likely each person is on
   * the college list, and never more than the matched record's batch and department.
   *
   *  - exact: the enrolment number is on the list (normalised the same way), the batch year is the same AND the name is
   *    the same. Somebody who types another alumnus' number must not be waved through, so a number whose name differs is
   *    only "probable".
   *  - probable: same name (case, spaces and accents ignored) and same batch year.
   *  - none: anything else.
   */
  async matchApplicants(applicants: ApplicantForMatch[]): Promise<Map<string, ApprovalMatch>> {
    const result = new Map<string, ApprovalMatch>();
    if (applicants.length === 0) return result;

    const prepared = applicants.map((a) => ({
      id: a.id,
      batchYear: typeof a.batchYear === 'number' ? a.batchYear : null,
      number: normalizeEnrollment(a.enrollmentNumber),
      key: normalizeName(a.fullName),
    }));

    const numbers = [...new Set(prepared.map((p) => p.number).filter((n): n is string => !!n))];
    const keysByYear = new Map<number, Set<string>>();
    for (const p of prepared) {
      if (p.batchYear === null || !p.key) continue;
      if (!keysByYear.has(p.batchYear)) keysByYear.set(p.batchYear, new Set());
      keysByYear.get(p.batchYear)!.add(p.key);
    }

    const wanted: Prisma.AlumniRecordWhereInput[] = [];
    if (numbers.length) wanted.push({ enrollmentNumber: { in: numbers } });
    for (const [batchYear, keys] of keysByYear) wanted.push({ batchYear, nameKey: { in: [...keys] } });

    const records = wanted.length
      ? await prisma.alumniRecord.findMany({
          where: { OR: wanted },
          select: { id: true, nameKey: true, batchYear: true, department: true, enrollmentNumber: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const byNumber = new Map(records.filter((r) => r.enrollmentNumber).map((r) => [r.enrollmentNumber as string, r]));
    const byPerson = new Map<string, (typeof records)[number]>();
    for (const r of records) {
      const key = `${r.batchYear}|${r.nameKey}`;
      if (!byPerson.has(key)) byPerson.set(key, r);
    }

    const shown = (r: (typeof records)[number]) => ({ recordId: r.id, record: { batchYear: r.batchYear, department: r.department } });

    for (const p of prepared) {
      const numbered = p.number ? byNumber.get(p.number) : undefined;
      if (numbered && p.batchYear === numbered.batchYear) {
        result.set(
          p.id,
          numbered.nameKey === p.key
            ? { level: 'exact', reason: 'The enrolment number, batch year and name are on the college list', ...shown(numbered) }
            : { level: 'probable', reason: 'The enrolment number and batch year are on the college list, but the name differs', ...shown(numbered) }
        );
        continue;
      }
      const named = p.batchYear !== null && p.key ? byPerson.get(`${p.batchYear}|${p.key}`) : undefined;
      if (named) {
        result.set(p.id, { level: 'probable', reason: 'The name and batch year are on the college list', ...shown(named) });
        continue;
      }
      result.set(p.id, {
        level: 'none',
        reason: numbered
          ? 'The enrolment number is on the college list, but with a different batch year'
          : 'Not found on the college list',
      });
    }
    return result;
  }
}

export const alumniRecordService = new AlumniRecordService();
