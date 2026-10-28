/**
 * Feeds of PostViews: the ranked "for you" feed, following/latest, reels, hashtag, profile
 * and saved lists (docs/SOCIAL_API.md, "Ranking").
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { isDeadPlainRepost, postInclude, PostRow, presentPosts, PostView } from './postPresenter';
import {
  badRequest,
  canViewPost,
  isUniqueViolation,
  loadViewerContext,
  normalizeTag,
  notFound,
  PageWindow,
  pageResult,
  parsePage,
  ViewerContext,
  ViewerInput,
  visiblePostWhere,
} from './socialShared';

export const FEED_TABS = ['for-you', 'following', 'latest'] as const;
export type FeedTab = (typeof FEED_TABS)[number];

/** How many recent posts the ranked feeds score (the newest visible ones). */
export const RANKING_CANDIDATES = 500;
const HOUR_MS = 60 * 60 * 1000;

interface PageQuery {
  cursor?: unknown;
  limit?: unknown;
}

/** Contract score: engagement × affinity, decayed by age. Exported for tests. */
export function scorePost(row: PostRow, ctx: ViewerContext | null, now: Date): number {
  const engagement =
    (row.likeCount ?? 0) + 2 * (row.commentCount ?? 0) + 3 * (row.repostCount ?? 0) + 0.05 * (row.viewCount ?? 0);
  let affinity = 1;
  if (ctx && row.userId !== ctx.id) {
    if (ctx.followingIds.has(row.userId)) affinity += 0.6;
    if (ctx.connectionIds.has(row.userId)) affinity += 0.6;
    if (ctx.batchYear !== null && row.user?.batchYear === ctx.batchYear) affinity += 0.3;
  }
  const hours = Math.max(0, (now.getTime() - new Date(row.createdAt).getTime()) / HOUR_MS);
  return ((1 + engagement) * affinity) / Math.pow(hours + 2, 1.3);
}

/** A plain repost and its original count as one story. */
const storyKey = (row: PostRow) => (row.isRepost && row.content === '' && row.repostOfId ? row.repostOfId : row.id);

const collapse = (rows: PostRow[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = storyKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const and = (...parts: Prisma.PostWhereInput[]): Prisma.PostWhereInput => ({ AND: parts });

export class FeedService {
  async getFeed(viewer: ViewerInput, query: PageQuery & { tab?: unknown }) {
    const tab = (query.tab === undefined || query.tab === '' ? 'for-you' : query.tab) as FeedTab;
    if (!FEED_TABS.includes(tab)) throw badRequest(`tab must be one of ${FEED_TABS.join(', ')}`, 'INVALID_TAB');
    const page = parsePage(query.cursor, query.limit);
    const ctx = (await loadViewerContext(viewer))!;

    if (tab === 'for-you') return this.ranked(ctx, page, {});
    const authorFilter: Prisma.PostWhereInput =
      tab === 'following' ? { userId: { in: [ctx.id, ...ctx.followingIds, ...ctx.connectionIds] } } : {};
    return this.chronological(ctx, page, authorFilter);
  }

  async getHashtagPosts(rawTag: unknown, viewer: ViewerInput | null | undefined, query: PageQuery) {
    const tag = normalizeTag(rawTag);
    if (!tag) throw badRequest('Invalid hashtag', 'INVALID_HASHTAG');
    const page = parsePage(query.cursor, query.limit);
    const ctx = await loadViewerContext(viewer);
    return this.chronological(ctx, page, { hashtags: { some: { hashtag: { tag } } } });
  }

  async getUserPosts(userId: string, viewer: ViewerInput | null | undefined, query: PageQuery & { reels?: unknown }) {
    const author = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
    const ctx = await loadViewerContext(viewer);
    if (!author || (!author.isActive && ctx?.id !== userId && !ctx?.isAdmin)) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    const page = parsePage(query.cursor, query.limit);
    const reels = query.reels === 'true' || query.reels === true;
    return this.chronological(ctx, page, { userId, ...(reels ? { isReel: true } : {}) });
  }

  async getSaved(viewer: ViewerInput, query: PageQuery) {
    const page = parsePage(query.cursor, query.limit);
    const ctx = await loadViewerContext(viewer);
    const rows = await prisma.savedPost.findMany({
      where: { userId: viewer.id, createdAt: { lte: page.snapshot } },
      include: { post: { include: postInclude } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit + 1,
    });
    const result = pageResult(rows ?? [], page);
    const posts = result.items.map((s) => s.post).filter((p) => canViewPost(p, ctx));
    return { items: await presentPosts(posts, ctx), nextCursor: result.nextCursor };
  }

  async toggleSave(viewer: ViewerInput, postId: string) {
    const [post, ctx] = await Promise.all([
      prisma.post.findUnique({ where: { id: postId }, include: { user: { select: { isActive: true } } } }),
      loadViewerContext(viewer),
    ]);
    if (!post || !canViewPost(post, ctx)) throw notFound();

    const removed = await prisma.savedPost.deleteMany({ where: { userId: viewer.id, postId } });
    if (removed?.count) return { saved: false };
    try {
      await prisma.savedPost.create({ data: { userId: viewer.id, postId } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    return { saved: true };
  }

  /** Newest first, visible to the viewer. */
  private async chronological(ctx: ViewerContext | null, page: PageWindow, filter: Prisma.PostWhereInput) {
    const rows = await prisma.post.findMany({
      where: and(visiblePostWhere(ctx), { createdAt: { lte: page.snapshot } }, filter),
      include: postInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit + 1,
    });
    const result = pageResult(rows ?? [], page);
    return { items: await this.present(collapse(result.items), ctx), nextCursor: result.nextCursor };
  }

  /** Scores the newest candidates, pinned posts first; the cursor's snapshot keeps paging stable. */
  private async ranked(ctx: ViewerContext, page: PageWindow, filter: Prisma.PostWhereInput) {
    const candidates = await prisma.post.findMany({
      where: and(visiblePostWhere(ctx), { createdAt: { lte: page.snapshot } }, filter),
      include: postInclude,
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: RANKING_CANDIDATES,
    });
    const scored = (candidates ?? []).map((row) => ({ row, score: scorePost(row, ctx, page.snapshot) }));
    scored.sort(
      (a, b) =>
        Number(b.row.isPinned) - Number(a.row.isPinned) ||
        b.score - a.score ||
        new Date(b.row.createdAt).getTime() - new Date(a.row.createdAt).getTime() ||
        (a.row.id < b.row.id ? 1 : -1)
    );
    const ordered = collapse(scored.map((s) => s.row));
    const result = pageResult(ordered.slice(page.offset, page.offset + page.limit + 1), page);
    return { items: await this.present(result.items, ctx), nextCursor: result.nextCursor };
  }

  private async present(rows: PostRow[], ctx: ViewerContext | null): Promise<PostView[]> {
    return (await presentPosts(rows, ctx)).filter((post) => !isDeadPlainRepost(post));
  }
}

export const feedService = new FeedService();
