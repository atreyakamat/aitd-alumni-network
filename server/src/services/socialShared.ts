/**
 * Building blocks shared by the social services (see docs/SOCIAL_API.md): viewer context and
 * post visibility, cursor pagination, hashtag and mention parsing.
 */
import { Prisma, PostVisibility, ReactionType, ReportReason } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { isAdminRole } from '../config/permissions';

export const REACTION_TYPES: ReactionType[] = ['LIKE', 'CELEBRATE', 'SUPPORT', 'LOVE', 'INSIGHTFUL', 'FUNNY'];
export const POST_VISIBILITIES: PostVisibility[] = ['PUBLIC', 'CONNECTIONS'];
export const REPORT_REASONS: ReportReason[] = ['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'MISINFORMATION', 'OTHER'];

export const MAX_HASHTAGS_PER_POST = 30;
export const MAX_MENTIONS = 20;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export const authorLiteSelect = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
  currentDesignation: true,
  batchYear: true,
} as const satisfies Prisma.UserSelect;

export type AuthorLite = Prisma.UserGetPayload<{ select: typeof authorLiteSelect }>;

export const badRequest = (message: string, code = 'VALIDATION_ERROR') => new AppError(message, 400, code);
export const notFound = (message = 'Post not found') => new AppError(message, 404, 'NOT_FOUND');

// ---------------------------------------------------------------------------
// Viewer context
// ---------------------------------------------------------------------------

export interface ViewerInput {
  id: string;
  userRole?: string | null;
}

export interface ViewerContext {
  id: string;
  isAdmin: boolean;
  batchYear: number | null;
  connectionIds: Set<string>;
  followingIds: Set<string>;
}

/** Accepted connections (either direction), the people the viewer follows, and their batch. */
export async function loadViewerContext(viewer?: ViewerInput | null): Promise<ViewerContext | null> {
  if (!viewer?.id) return null;
  const [connections, follows, me] = await Promise.all([
    prisma.connection.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: viewer.id }, { addresseeId: viewer.id }] },
      select: { requesterId: true, addresseeId: true },
    }),
    prisma.follow.findMany({ where: { followerId: viewer.id }, select: { followingId: true } }),
    prisma.user.findUnique({ where: { id: viewer.id }, select: { batchYear: true } }),
  ]);
  return {
    id: viewer.id,
    isAdmin: isAdminRole(viewer.userRole),
    batchYear: me?.batchYear ?? null,
    connectionIds: new Set(
      (connections ?? []).map((c) => (c.requesterId === viewer.id ? c.addresseeId : c.requesterId))
    ),
    followingIds: new Set((follows ?? []).map((f) => f.followingId)),
  };
}

/**
 * Posts a viewer may see: published, by an active author, and PUBLIC unless the viewer wrote it,
 * is connected to the author, or is an admin.
 */
export function visiblePostWhere(ctx: ViewerContext | null): Prisma.PostWhereInput {
  const base: Prisma.PostWhereInput = { isPublished: true, user: { isActive: true } };
  if (ctx?.isAdmin) return base;
  if (!ctx) return { ...base, visibility: 'PUBLIC' };
  return {
    ...base,
    OR: [{ visibility: 'PUBLIC' }, { userId: ctx.id }, { userId: { in: [...ctx.connectionIds] } }],
  };
}

export interface VisibilityFields {
  userId: string;
  visibility: PostVisibility | string;
  isPublished: boolean;
  user?: { isActive?: boolean | null } | null;
}

export function canViewPost(post: VisibilityFields | null | undefined, ctx: ViewerContext | null): boolean {
  if (!post) return false;
  if (ctx && (ctx.isAdmin || post.userId === ctx.id)) return true;
  if (!post.isPublished || post.user?.isActive === false) return false;
  if (post.visibility === 'PUBLIC') return true;
  return !!ctx && ctx.connectionIds.has(post.userId);
}

// ---------------------------------------------------------------------------
// Cursor pagination: an opaque snapshot time + offset keeps pages stable while new rows arrive
// ---------------------------------------------------------------------------

export interface PageWindow {
  snapshot: Date;
  offset: number;
  limit: number;
}

export function parsePage(cursor: unknown, limit: unknown, now: Date = new Date()): PageWindow {
  const rawLimit = typeof limit === 'string' ? parseInt(limit, 10) : typeof limit === 'number' ? limit : NaN;
  const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  if (cursor === undefined || cursor === null || cursor === '') {
    return { snapshot: now, offset: 0, limit: safeLimit };
  }
  if (typeof cursor !== 'string' || cursor.length > 200) throw badRequest('Invalid cursor', 'INVALID_CURSOR');
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const snapshot = new Date(decoded?.t);
    const offset = decoded?.o;
    if (Number.isNaN(snapshot.getTime()) || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
      throw new Error('bad cursor');
    }
    return { snapshot, offset, limit: safeLimit };
  } catch {
    throw badRequest('Invalid cursor', 'INVALID_CURSOR');
  }
}

export const encodeCursor = (snapshot: Date, offset: number) =>
  Buffer.from(JSON.stringify({ t: snapshot.toISOString(), o: offset })).toString('base64url');

/** `rows` fetched with take = limit + 1: trims the probe row and builds the next cursor. */
export function pageResult<T>(rows: T[], page: PageWindow): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > page.limit;
  const items = hasMore ? rows.slice(0, page.limit) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(page.snapshot, page.offset + page.limit) : null };
}

// ---------------------------------------------------------------------------
// Hashtags and mentions
// ---------------------------------------------------------------------------

const HASHTAG_PATTERN = /(^|[^A-Za-z0-9_&#/])#([A-Za-z0-9_]{1,50})(?![A-Za-z0-9_])/g;

/** Lower-cased, de-duplicated tags in order of appearance (must contain a letter; max 30). */
export function parseHashtags(content: unknown): string[] {
  if (typeof content !== 'string' || !content.includes('#')) return [];
  const tags: string[] = [];
  for (const match of content.matchAll(HASHTAG_PATTERN)) {
    const tag = match[2].toLowerCase();
    if (!/[a-z]/.test(tag) || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length === MAX_HASHTAGS_PER_POST) break;
  }
  return tags;
}

/** Normalises a tag from a URL or query (`#Placements` → `placements`); null when invalid. */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const tag = raw.trim().replace(/^#/, '').toLowerCase();
  return /^[a-z0-9_]{1,50}$/.test(tag) && /[a-z]/.test(tag) ? tag : null;
}

/** Validates `mentionIds` and keeps only active members (never the author). */
export async function resolveMentionIds(raw: unknown, authorId: string): Promise<string[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || id.trim() === '')) {
    throw badRequest('mentionIds must be an array of user ids');
  }
  const ids = [...new Set(raw.map((id: string) => id.trim()))].filter((id) => id !== authorId);
  if (ids.length > MAX_MENTIONS) throw badRequest(`You can mention at most ${MAX_MENTIONS} people`);
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  const found = new Set((users ?? []).map((u) => u.id));
  return ids.filter((id) => found.has(id));
}

export function parseReaction(raw: unknown): ReactionType {
  if (typeof raw !== 'string' || !REACTION_TYPES.includes(raw.toUpperCase() as ReactionType)) {
    throw badRequest(`type must be one of ${REACTION_TYPES.join(', ')}`, 'INVALID_REACTION');
  }
  return raw.toUpperCase() as ReactionType;
}

export function parseVisibility(raw: unknown, fallback: PostVisibility = 'PUBLIC'): PostVisibility {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'string' || !POST_VISIBILITIES.includes(raw.toUpperCase() as PostVisibility)) {
    throw badRequest('visibility must be PUBLIC or CONNECTIONS');
  }
  return raw.toUpperCase() as PostVisibility;
}

export const isUniqueViolation = (err: unknown) =>
  !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002';

/** Reaction counts by type → summary (non-zero only) and the top three types. */
export function summarizeReactions(rows: Array<{ type: ReactionType; count: number }>) {
  const summary: Partial<Record<ReactionType, number>> = {};
  for (const row of rows) {
    if (row.count > 0) summary[row.type] = (summary[row.type] ?? 0) + row.count;
  }
  const topReactions = (Object.entries(summary) as Array<[ReactionType, number]>)
    .sort((a, b) => b[1] - a[1] || REACTION_TYPES.indexOf(a[0]) - REACTION_TYPES.indexOf(b[0]))
    .slice(0, 3)
    .map(([type]) => type);
  return { reactionSummary: summary, topReactions };
}
