/**
 * Member reports on posts and comments, and the admin moderation queue.
 */
import { Prisma, ReportReason, ReportStatus } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { clientLinks } from '../utils/clientLinks';
import { logAuditAction } from './auditService';
import { commentInclude, postInclude, presentComments, presentPosts } from './postPresenter';
import { postService } from './postService';
import { notifyOnce } from './socialNotifications';
import {
  authorLiteSelect,
  badRequest,
  canViewPost,
  loadViewerContext,
  pageResult,
  parsePage,
  REPORT_REASONS,
  ViewerInput,
} from './socialShared';

export const REPORT_DETAILS_MAX = 500;
const REPORT_STATUSES: ReportStatus[] = ['OPEN', 'RESOLVED', 'DISMISSED'];
export const REPORT_ACTIONS = ['DISMISS', 'REMOVE_CONTENT'] as const;
/** Admins notified about a newly reported item (the first open report on it). */
const MAX_ADMINS_NOTIFIED = 50;
/** Open reports are grouped per item in memory; the queue is never this long in practice. */
const OPEN_QUEUE_SCAN = 1000;

type Target = { kind: 'post'; id: string } | { kind: 'comment'; id: string };

const reportInclude = {
  reporter: { select: authorLiteSelect },
  resolvedBy: { select: authorLiteSelect },
} satisfies Prisma.ContentReportInclude;

type ReportRow = Prisma.ContentReportGetPayload<{ include: typeof reportInclude }>;

const itemKey = (r: { postId: string | null; commentId: string | null }) =>
  r.commentId ? `comment:${r.commentId}` : `post:${r.postId}`;

export class ReportService {
  async report(viewer: ViewerInput, target: Target, body: { reason?: unknown; details?: unknown }) {
    const reason = typeof body?.reason === 'string' ? (body.reason.toUpperCase() as ReportReason) : undefined;
    if (!reason || !REPORT_REASONS.includes(reason)) {
      throw badRequest(`reason must be one of ${REPORT_REASONS.join(', ')}`, 'INVALID_REASON');
    }
    if (body.details !== undefined && body.details !== null && typeof body.details !== 'string') {
      throw badRequest('details must be text');
    }
    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (details.length > REPORT_DETAILS_MAX) throw badRequest(`details must be at most ${REPORT_DETAILS_MAX} characters`);

    const ctx = await loadViewerContext(viewer);
    let authorId: string;
    let snapshot: string;
    if (target.kind === 'post') {
      const post = await prisma.post.findUnique({ where: { id: target.id }, include: { user: { select: { isActive: true } } } });
      if (!post || !canViewPost(post, ctx)) throw new AppError('Post not found', 404, 'NOT_FOUND');
      authorId = post.userId;
      snapshot = post.content;
    } else {
      const comment = await prisma.postComment.findUnique({
        where: { id: target.id },
        include: { post: { include: { user: { select: { isActive: true } } } } },
      });
      if (!comment || !canViewPost(comment.post, ctx)) throw new AppError('Comment not found', 404, 'NOT_FOUND');
      authorId = comment.userId;
      snapshot = comment.content;
    }
    if (authorId === viewer.id) throw badRequest('You cannot report your own content', 'CANNOT_REPORT_OWN');

    const ref = target.kind === 'post' ? { postId: target.id } : { commentId: target.id };
    const [mine, openOnItem] = await Promise.all([
      prisma.contentReport.findFirst({ where: { ...ref, reporterId: viewer.id, status: 'OPEN' }, select: { id: true } }),
      prisma.contentReport.count({ where: { ...ref, status: 'OPEN' } }),
    ]);
    if (mine) throw new AppError('You already reported this', 409, 'ALREADY_REPORTED');

    const report = await prisma.contentReport.create({
      data: { ...ref, reporterId: viewer.id, reason, details: details || null, contentSnapshot: snapshot },
      select: { id: true, status: true },
    });

    if (!openOnItem) {
      const admins = await prisma.user.findMany({
        where: { isActive: true, userRole: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        select: { id: true },
        take: MAX_ADMINS_NOTIFIED,
      });
      await notifyOnce(
        viewer.id,
        (admins ?? []).map((a) => ({
          userId: a.id,
          type: 'CONTENT_REPORTED' as const,
          title: 'Content reported',
          message: `A ${target.kind} was reported for ${reason.toLowerCase()}`,
          link: clientLinks.adminReports(),
          metadata: { reportId: report.id, ...ref, reason },
        }))
      );
    }
    return report;
  }

  /** Admin queue. OPEN reports are grouped per reported item (newest report first, with a count). */
  async list(admin: ViewerInput, query: { status?: unknown; cursor?: unknown; limit?: unknown }) {
    const status = (typeof query.status === 'string' && query.status ? query.status.toUpperCase() : 'OPEN') as ReportStatus;
    if (!REPORT_STATUSES.includes(status)) throw badRequest('status must be OPEN, RESOLVED or DISMISSED');
    const page = parsePage(query.cursor, query.limit);

    let rows: Array<ReportRow & { reportCount: number }>;
    let nextCursor: string | null;
    if (status === 'OPEN') {
      const open = await prisma.contentReport.findMany({
        where: { status, createdAt: { lte: page.snapshot } },
        include: reportInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: OPEN_QUEUE_SCAN,
      });
      const groups = new Map<string, ReportRow & { reportCount: number }>();
      for (const r of open ?? []) {
        const key = itemKey(r);
        const existing = groups.get(key);
        if (existing) existing.reportCount++;
        else groups.set(key, { ...r, reportCount: 1 });
      }
      const result = pageResult([...groups.values()].slice(page.offset, page.offset + page.limit + 1), page);
      rows = result.items;
      nextCursor = result.nextCursor;
    } else {
      const closed = await prisma.contentReport.findMany({
        where: { status, createdAt: { lte: page.snapshot } },
        include: reportInclude,
        orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }],
        skip: page.offset,
        take: page.limit + 1,
      });
      const result = pageResult(closed ?? [], page);
      rows = result.items.map((r) => ({ ...r, reportCount: 1 }));
      nextCursor = result.nextCursor;
    }

    const ctx = await loadViewerContext(admin);
    const postIds = rows.map((r) => r.postId).filter(Boolean) as string[];
    const commentIds = rows.map((r) => r.commentId).filter(Boolean) as string[];
    const [posts, comments] = await Promise.all([
      postIds.length ? prisma.post.findMany({ where: { id: { in: postIds } }, include: postInclude }) : [],
      commentIds.length ? prisma.postComment.findMany({ where: { id: { in: commentIds } }, include: commentInclude }) : [],
    ]);
    const postViews = new Map((await presentPosts(posts ?? [], ctx)).map((p) => [p.id, p]));
    const commentViews = new Map((await presentComments(comments ?? [], ctx)).map((c) => [c.id, c]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt,
        reportCount: r.reportCount,
        contentSnapshot: r.contentSnapshot,
        reporter: r.reporter,
        post: r.postId ? postViews.get(r.postId) ?? null : null,
        comment: r.commentId ? commentViews.get(r.commentId) ?? null : null,
        resolvedBy: r.resolvedBy ?? null,
        resolvedAt: r.resolvedAt ?? null,
        resolution: r.resolution ?? null,
      })),
      nextCursor,
    };
  }

  /** DISMISS closes every open report on the item; REMOVE_CONTENT deletes the item and resolves them. */
  async resolve(admin: ViewerInput, reportId: string, body: { action?: unknown; note?: unknown }) {
    const action = body?.action;
    if (typeof action !== 'string' || !(REPORT_ACTIONS as readonly string[]).includes(action)) {
      throw badRequest('action must be DISMISS or REMOVE_CONTENT', 'INVALID_ACTION');
    }
    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') throw badRequest('note must be text');
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, REPORT_DETAILS_MAX) : '';

    const report = await prisma.contentReport.findUnique({ where: { id: reportId } });
    if (!report) throw new AppError('Report not found', 404, 'NOT_FOUND');
    if (report.status !== 'OPEN') throw new AppError('This report is already closed', 409, 'REPORT_CLOSED');
    if (!report.postId && !report.commentId) {
      throw new AppError('The reported content no longer exists', 409, 'CONTENT_GONE');
    }

    const ref = report.commentId ? { commentId: report.commentId } : { postId: report.postId! };
    const entityType = report.commentId ? 'COMMENT' : 'POST';
    const entityId = (report.commentId ?? report.postId)!;
    const status: ReportStatus = action === 'DISMISS' ? 'DISMISSED' : 'RESOLVED';

    // Close the reports first: deleting the content nulls their postId/commentId
    const closed = await prisma.contentReport.updateMany({
      where: { ...ref, status: 'OPEN' },
      data: { status, resolvedById: admin.id, resolvedAt: new Date(), resolution: note || null },
    });

    if (action === 'REMOVE_CONTENT') {
      if (report.commentId) await postService.deleteComment(admin.id, report.commentId, true);
      else await postService.deletePost(admin.id, report.postId!, true);
    }

    await logAuditAction({
      userId: admin.id,
      action: action === 'DISMISS' ? 'REPORT_DISMISSED' : 'CONTENT_REMOVED',
      entityType,
      entityId,
      oldValues: { content: report.contentSnapshot ?? null, reason: report.reason },
      newValues: { reportsClosed: closed?.count ?? 0, note: note || null },
    });

    return { id: report.id, status, reportsClosed: closed?.count ?? 0 };
  }
}

export const reportService = new ReportService();
