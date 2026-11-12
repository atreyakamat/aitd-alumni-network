import { ApprovalStatus, Prisma } from '@prisma/client';
import prisma from '../config/database';
import config from '../config';
import { AppError } from '../middleware/errorHandler';
import { Actor } from '../config/permissions';
import { buildPaginationResponse, paginationHelper, ilike } from '../utils/helpers';
import { logAuditAction } from './auditService';
import { publishNotificationEvent } from './notificationBus';
import { log } from '../utils/logger';
import { alumniRecordService, type ApprovalMatch, type MatchLevel } from './alumniRecordService';

/**
 * Alumni approval: the review queue an administrator works through.
 *
 * A registration is a claim ("I am an alumnus of the college"). Nobody gets a session (and nobody appears in the
 * directory, search or any list) until an administrator has checked the claim and approved it. Approving sets
 * `approvalStatus = APPROVED` together with `isVerified = true`: isVerified is what every listing filters on.
 */

export interface ApprovalRequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface ApprovalListFilters {
  status?: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
  /** Queue helpers: batch year, department, match level against the college list, and "waited more than N days". */
  batchYear?: number | string;
  department?: string;
  match?: string;
  waitingDays?: number | string;
}

export interface BulkDecisionResult {
  results: Array<{ id: string; ok: true } | { id: string; ok: false; code: string; message: string }>;
  succeeded: number;
  failed: number;
}

const STATUSES: readonly ApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const MAX_NOTE_LENGTH = 500;
const MIN_REASON_LENGTH = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** An application that has waited this long is overdue. */
export const OVERDUE_DAYS = 7;
export const MAX_BULK_IDS = 50;
const MATCH_LEVELS: readonly MatchLevel[] = ['exact', 'probable', 'none'];
/** Filtering by match level reads the queue in chunks (one list query each), up to this many registrations. */
const MATCH_SCAN_CHUNK = 500;
const MATCH_SCAN_MAX = 5000;
const MAX_DEPARTMENT_LENGTH = 100;

/** What the reviewer needs to decide. No password hash, no tokens, no phone number. */
const APPLICATION_SELECT = {
  id: true,
  fullName: true,
  email: true,
  batchYear: true,
  department: true,
  degree: true,
  roleType: true,
  enrollmentNumber: true,
  verificationNote: true,
  linkedinUrl: true,
  isActive: true,
  createdAt: true,
  emailVerifiedAt: true,
  approvalStatus: true,
  approvalReviewedAt: true,
  approvalNote: true,
  approvalReviewedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.UserSelect;

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const invalid = (message: string) => new AppError(message, 400, 'VALIDATION_ERROR');

/** An optional whole number filter: absent/blank is fine, anything else that is not a number in range is a 400 (never "everybody"). */
const optionalWholeNumber = (value: unknown, field: string, min: number, max: number): number | undefined => {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return undefined;
  const n = typeof value === 'string' ? (/^-?\d+$/u.test(value.trim()) ? Number(value) : NaN) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw invalid(`${field} must be a whole number between ${min} and ${max}`);
  }
  return n;
};

/** Whole days an application has waited. */
const waitedDays = (createdAt: Date, now: number) => Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / DAY_MS));

/**
 * The applicant's e-mail is an event on the notification bus (Kafka). The decision never waits for it and never fails
 * because of it: if the event cannot be published (and the in-process fallback fails too) it is logged.
 */
const announce = (type: 'registration.approved' | 'registration.rejected', data: { userId: string; reason?: string }) => {
  void publishNotificationEvent(type, data as never).catch((error: unknown) =>
    log.error(`Could not publish the ${type} event`, { userId: data.userId, err: error })
  );
};

/**
 * Once somebody has decided about a registration, the "New registration to review" notices that were sent to the
 * administrators are answered: mark them read, so the bell does not go on asking for a decision that was made. Best
 * effort: a failure here is logged and never undoes or fails the decision.
 */
const settleReviewNotices = async (applicantId: string) => {
  try {
    await prisma.notification.updateMany({
      where: { type: 'REGISTRATION_PENDING', isRead: false, metadata: { path: ['applicantId'], equals: applicantId } },
      data: { isRead: true },
    });
  } catch (error) {
    log.error('Could not settle the registration review notices', { applicantId, err: error });
  }
};

const NO_MATCH: ApprovalMatch = { level: 'none', reason: 'Not found on the college list' };

type Decorate = <T extends { createdAt: Date; approvalStatus: ApprovalStatus }>(row: T, match: ApprovalMatch) => T & { match: ApprovalMatch; waitingDays: number | null };

class MemberApprovalService {
  /**
   * The queue. Every item also carries `match` (how well the registration fits the college list) and `waitingDays`
   * (whole days a PENDING application has waited; null once decided). The match of a page costs one query.
   */
  async list(filters: ApprovalListFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
    const { skip, take } = paginationHelper(page, limit);

    // A filter that cannot be read is refused: silently ignoring it would show everybody
    const batchYear = optionalWholeNumber(filters.batchYear, 'batchYear', 1950, 2200);
    const waitingDays = optionalWholeNumber(filters.waitingDays, 'waitingDays', 0, 3650);
    const department = trimmed(filters.department);
    if (department.length > MAX_DEPARTMENT_LENGTH) throw invalid(`department must be at most ${MAX_DEPARTMENT_LENGTH} characters`);
    const matchFilter = trimmed(filters.match);
    if (matchFilter && !MATCH_LEVELS.includes(matchFilter as MatchLevel)) throw invalid('match must be exact, probable or none');

    const status = STATUSES.includes(filters.status as ApprovalStatus) ? (filters.status as ApprovalStatus) : 'PENDING';
    const where: Prisma.UserWhereInput = { approvalStatus: status };
    const search = trimmed(filters.search);
    if (search) {
      where.OR = [{ fullName: ilike(search) }, { email: ilike(search) }, { enrollmentNumber: ilike(search) }];
    }
    if (batchYear !== undefined) where.batchYear = batchYear;
    if (department) where.department = { equals: department, mode: 'insensitive' };
    const now = Date.now();
    // "Waited more than N days": created before now minus N days
    if (waitingDays !== undefined) where.createdAt = { lt: new Date(now - waitingDays * DAY_MS) };

    // The queue is worked oldest first; what was decided is read newest first
    const orderBy: Prisma.UserOrderByWithRelationInput =
      status === 'PENDING' ? { createdAt: 'asc' } : { approvalReviewedAt: { sort: 'desc', nulls: 'last' } };

    const decorate: Decorate = (row, match) => ({
      ...row,
      match,
      waitingDays: row.approvalStatus === 'PENDING' ? waitedDays(row.createdAt, now) : null,
    });

    if (matchFilter) return this.listByMatch(where, orderBy, matchFilter as MatchLevel, page, limit, decorate);

    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, select: APPLICATION_SELECT, orderBy, skip, take }),
      prisma.user.count({ where }),
    ]);
    const matches = await alumniRecordService.matchApplicants(rows);
    return buildPaginationResponse(
      rows.map((row) => decorate(row, matches.get(row.id) ?? NO_MATCH)),
      total,
      page,
      limit
    );
  }

  /**
   * The match level is not a column: it is computed against the college list. To page over "the exact matches" the queue
   * is read in chunks (id, name, batch and number only), each chunk is matched with one query, and the matching ids are
   * paged; only the page itself is then loaded in full. Bounded by MATCH_SCAN_MAX registrations.
   */
  private async listByMatch(
    where: Prisma.UserWhereInput,
    orderBy: Prisma.UserOrderByWithRelationInput,
    level: MatchLevel,
    page: number,
    limit: number,
    decorate: Decorate
  ) {
    const found: Array<{ id: string; match: ApprovalMatch }> = [];
    for (let scanned = 0; scanned < MATCH_SCAN_MAX; scanned += MATCH_SCAN_CHUNK) {
      const chunk = await prisma.user.findMany({
        where,
        select: { id: true, fullName: true, batchYear: true, enrollmentNumber: true },
        orderBy,
        skip: scanned,
        take: MATCH_SCAN_CHUNK,
      });
      const matches = await alumniRecordService.matchApplicants(chunk);
      for (const person of chunk) {
        const match = matches.get(person.id) ?? NO_MATCH;
        if (match.level === level) found.push({ id: person.id, match });
      }
      if (chunk.length < MATCH_SCAN_CHUNK) break;
    }

    const pageItems = found.slice((page - 1) * limit, page * limit);
    const rows = pageItems.length
      ? await prisma.user.findMany({ where: { id: { in: pageItems.map((p) => p.id) } }, select: APPLICATION_SELECT })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const data = pageItems.flatMap(({ id, match }) => {
      const row = byId.get(id);
      return row ? [decorate(row, match)] : [];
    });
    return buildPaginationResponse(data, found.length, page, limit);
  }

  async summary() {
    const overdueBefore = new Date(Date.now() - OVERDUE_DAYS * DAY_MS);
    const [groups, overdue, alumniRecords] = await Promise.all([
      prisma.user.groupBy({ by: ['approvalStatus'], _count: { _all: true } }),
      // waiting 7 days or more
      prisma.user.count({ where: { approvalStatus: 'PENDING', createdAt: { lte: overdueBefore } } }),
      alumniRecordService.count(),
    ]);
    const count = (status: ApprovalStatus) => groups.find((g) => g.approvalStatus === status)?._count._all ?? 0;
    return { pending: count('PENDING'), approved: count('APPROVED'), rejected: count('REJECTED'), overdue, alumniRecords };
  }

  private async load(targetId: string) {
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, fullName: true, email: true, approvalStatus: true, emailVerifiedAt: true },
    });
    if (!target) throw new AppError('User not found', 404, 'NOT_FOUND');
    return target;
  }

  async approve(actor: Pick<Actor, 'id'>, targetId: string, note: unknown, meta: ApprovalRequestMeta = {}) {
    const noteText = this.checkNote(note);
    await this.approveOne(actor, targetId, noteText, meta);
    return prisma.user.findUnique({ where: { id: targetId }, select: APPLICATION_SELECT });
  }

  private checkNote(note: unknown): string {
    const noteText = trimmed(note);
    if (noteText.length > MAX_NOTE_LENGTH) {
      throw new AppError(`The note can be at most ${MAX_NOTE_LENGTH} characters`, 400, 'VALIDATION_ERROR');
    }
    return noteText;
  }

  /** The decision itself, shared by the single and the bulk approval: the same rules, race safety, audit entry and event. */
  private async approveOne(actor: Pick<Actor, 'id'>, targetId: string, noteText: string, meta: ApprovalRequestMeta) {
    const target = await this.load(targetId);
    if (target.approvalStatus === 'APPROVED') {
      throw new AppError('This person is already approved', 409, 'ALREADY_APPROVED');
    }
    // Anyone can register an address that is not theirs. While verification is required, approving an address nobody has
    // proven to own would hand a member account to whoever typed it.
    if (config.auth.requireEmailVerification && !target.emailVerifiedAt) {
      throw new AppError(
        'This person has not verified their e-mail address yet. Approve after they have used the link we mailed to them.',
        409,
        'EMAIL_NOT_VERIFIED'
      );
    }

    // Conditional update: of two administrators acting at the same moment only one claims the change
    const claimed = await prisma.user.updateMany({
      where: { id: targetId, approvalStatus: { not: 'APPROVED' } },
      data: {
        approvalStatus: 'APPROVED',
        isVerified: true,
        approvalReviewedAt: new Date(),
        approvalReviewedById: actor.id,
        approvalNote: noteText || null,
      },
    });
    if (claimed.count !== 1) {
      throw new AppError('This person is already approved', 409, 'ALREADY_APPROVED');
    }

    await logAuditAction({
      userId: actor.id,
      action: 'APPROVE',
      entityType: 'USER',
      entityId: targetId,
      oldValues: { approvalStatus: target.approvalStatus },
      newValues: { approvalStatus: 'APPROVED', ...(noteText ? { note: noteText } : {}) },
      ...meta,
    });

    await settleReviewNotices(targetId);
    announce('registration.approved', { userId: targetId });
  }

  async reject(actor: Pick<Actor, 'id'>, targetId: string, reason: unknown, meta: ApprovalRequestMeta = {}) {
    const reasonText = this.checkReason(reason);
    await this.rejectOne(actor, targetId, reasonText, meta);
    return prisma.user.findUnique({ where: { id: targetId }, select: APPLICATION_SELECT });
  }

  private checkReason(reason: unknown): string {
    const reasonText = trimmed(reason);
    if (reasonText.length < MIN_REASON_LENGTH || reasonText.length > MAX_NOTE_LENGTH) {
      throw new AppError(
        `Give the reason (${MIN_REASON_LENGTH} to ${MAX_NOTE_LENGTH} characters): the person is told why`,
        400,
        'VALIDATION_ERROR'
      );
    }
    return reasonText;
  }

  private async rejectOne(actor: Pick<Actor, 'id'>, targetId: string, reasonText: string, meta: ApprovalRequestMeta) {
    const target = await this.load(targetId);
    // A member who is already approved is deactivated (admin users page), not "rejected"
    if (target.approvalStatus !== 'PENDING') {
      throw new AppError('Only a registration that is waiting for approval can be rejected', 409, 'NOT_PENDING');
    }

    const claimed = await prisma.user.updateMany({
      where: { id: targetId, approvalStatus: 'PENDING' },
      data: {
        approvalStatus: 'REJECTED',
        isVerified: false,
        approvalReviewedAt: new Date(),
        approvalReviewedById: actor.id,
        approvalNote: reasonText,
      },
    });
    if (claimed.count !== 1) {
      throw new AppError('Only a registration that is waiting for approval can be rejected', 409, 'NOT_PENDING');
    }

    await logAuditAction({
      userId: actor.id,
      action: 'REJECT',
      entityType: 'USER',
      entityId: targetId,
      oldValues: { approvalStatus: 'PENDING' },
      newValues: { approvalStatus: 'REJECTED', reason: reasonText },
      ...meta,
    });

    await settleReviewNotices(targetId);
    announce('registration.rejected', { userId: targetId, reason: reasonText });
  }

  /** Up to MAX_BULK_IDS distinct, non-blank ids; anything else is a 400 before a single decision is made. */
  private checkIds(ids: unknown): string[] {
    if (!Array.isArray(ids) || ids.length === 0) throw invalid('Choose at least one registration');
    if (ids.length > MAX_BULK_IDS) throw invalid(`Choose at most ${MAX_BULK_IDS} registrations at a time`);
    const distinct = new Set<string>();
    for (const id of ids) {
      if (typeof id !== 'string' || id.trim() === '' || id.length > 128) throw invalid('Every id must be a valid id');
      distinct.add(id.trim());
    }
    return [...distinct];
  }

  /**
   * Runs one decision per id, in order, each through exactly the rules of the single decision (e-mail not verified, race
   * safety, one audit entry per person, events). A failure of one id never stops the others. It is reported with a code
   * and the generic message of the rule, never with anybody's data; an unexpected error is logged and reported as such.
   */
  private async decideEach(ids: string[], decide: (id: string) => Promise<void>): Promise<BulkDecisionResult> {
    const results: BulkDecisionResult['results'] = [];
    for (const id of ids) {
      try {
        await decide(id);
        results.push({ id, ok: true });
      } catch (error) {
        if (error instanceof AppError) {
          results.push({ id, ok: false, code: error.code ?? 'ERROR', message: error.message });
        } else {
          log.error('A bulk decision failed unexpectedly', { applicantId: id, err: error });
          results.push({ id, ok: false, code: 'INTERNAL_ERROR', message: 'This registration could not be processed. Try it again on its own.' });
        }
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { results, succeeded, failed: results.length - succeeded };
  }

  async bulkApprove(actor: Pick<Actor, 'id'>, ids: unknown, note: unknown, meta: ApprovalRequestMeta = {}) {
    const wanted = this.checkIds(ids);
    const noteText = this.checkNote(note);
    return this.decideEach(wanted, (id) => this.approveOne(actor, id, noteText, meta));
  }

  /** The reason is always required: every person is told why by e-mail. */
  async bulkReject(actor: Pick<Actor, 'id'>, ids: unknown, reason: unknown, meta: ApprovalRequestMeta = {}) {
    const wanted = this.checkIds(ids);
    const reasonText = this.checkReason(reason);
    return this.decideEach(wanted, (id) => this.rejectOne(actor, id, reasonText, meta));
  }
}

export const memberApprovalService = new MemberApprovalService();
