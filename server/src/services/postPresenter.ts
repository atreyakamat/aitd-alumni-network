/**
 * Builds the PostView / CommentView shapes of docs/SOCIAL_API.md for a page of rows with a fixed
 * number of batched queries (never one query per post).
 */
import { Prisma, ReactionType } from '@prisma/client';
import prisma from '../config/database';
import { authorLiteSelect, AuthorLite, canViewPost, summarizeReactions, ViewerContext } from './socialShared';

export const postInclude = {
  user: {
    select: {
      ...authorLiteSelect,
      isActive: true,
      membershipTier: { select: { name: true, badgeColor: true } },
    },
  },
} satisfies Prisma.PostInclude;

export type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

export interface FeedReason {
  type: 'REPOST';
  user: AuthorLite;
}

export interface PostView {
  id: string;
  type: string;
  content: string;
  mediaUrls: string[];
  videoUrl: string | null;
  thumbnailUrl: string | null;
  isReel: boolean;
  isRepost: boolean;
  linkUrl: string | null;
  visibility: string;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  editedAt: Date | null;
  user: AuthorLite & { membershipTier: { name: string; badgeColor: string | null } | null };
  counts: { reactions: number; comments: number; reposts: number; views: number };
  reactionSummary: Partial<Record<ReactionType, number>>;
  topReactions: ReactionType[];
  hashtags: string[];
  mentions: Array<{ id: string; fullName: string }>;
  viewer: { reaction: ReactionType | null; saved: boolean; reposted: boolean; isAuthor: boolean; followsAuthor: boolean };
  repostOf: PostView | { id: string; unavailable: true } | null;
  reason: FeedReason | null;
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
  _count: { likes: number; comments: number };
}

const toUrlList = (value: Prisma.JsonValue | null | undefined): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const groupBy = <T, K>(rows: T[], key: (row: T) => K) => {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    map.set(k, [...(map.get(k) ?? []), row]);
  }
  return map;
};

/** Present a page of posts. Plain-repost originals are loaded in one extra query. */
export async function presentPosts(rows: PostRow[], ctx: ViewerContext | null): Promise<PostView[]> {
  if (!rows || rows.length === 0) return [];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const missingOriginals = [
    ...new Set(rows.filter((r) => r.isRepost && r.repostOfId && !byId.has(r.repostOfId)).map((r) => r.repostOfId!)),
  ];
  if (missingOriginals.length) {
    const originals = await prisma.post.findMany({ where: { id: { in: missingOriginals } }, include: postInclude });
    for (const o of originals ?? []) byId.set(o.id, o);
  }

  const ids = [...byId.keys()];
  const [reactionGroups, viewerReactions, saved, ownReposts, hashtags, mentions] = await Promise.all([
    prisma.postLike.groupBy({ by: ['postId', 'type'], where: { postId: { in: ids } }, _count: { _all: true } }),
    ctx
      ? prisma.postLike.findMany({ where: { userId: ctx.id, postId: { in: ids } }, select: { postId: true, type: true } })
      : [],
    ctx ? prisma.savedPost.findMany({ where: { userId: ctx.id, postId: { in: ids } }, select: { postId: true } }) : [],
    ctx
      ? prisma.post.findMany({
          where: { plainRepostKey: { in: ids.map((id) => `${ctx.id}:${id}`) } },
          select: { repostOfId: true },
        })
      : [],
    prisma.postHashtag.findMany({ where: { postId: { in: ids } }, select: { postId: true, hashtag: { select: { tag: true } } } }),
    prisma.postMention.findMany({
      where: { postId: { in: ids } },
      select: { postId: true, user: { select: { id: true, fullName: true } } },
    }),
  ]);

  const summaries = groupBy(
    ((reactionGroups ?? []) as Array<{ postId: string; type: ReactionType; _count: { _all: number } }>).map((g) => ({
      postId: g.postId,
      type: g.type,
      count: g._count?._all ?? 0,
    })),
    (g) => g.postId
  );
  const myReaction = new Map((viewerReactions ?? []).map((r) => [r.postId, r.type]));
  const savedIds = new Set((saved ?? []).map((s) => s.postId));
  const repostedIds = new Set((ownReposts ?? []).map((r) => r.repostOfId).filter(Boolean) as string[]);
  const tagsByPost = groupBy(hashtags ?? [], (h) => h.postId);
  const mentionsByPost = groupBy(mentions ?? [], (m) => m.postId);

  const view = (row: PostRow, withOriginal: boolean): PostView => {
    const { reactionSummary, topReactions } = summarizeReactions(summaries.get(row.id) ?? []);
    const reaction = myReaction.get(row.id) ?? null;
    const rootId = row.isRepost && row.repostOfId ? row.repostOfId : row.id;
    const { isActive: _active, ...author } = row.user; // eslint-disable-line @typescript-eslint/no-unused-vars

    let repostOf: PostView['repostOf'] = null;
    if (withOriginal && row.isRepost) {
      const original = row.repostOfId ? byId.get(row.repostOfId) : undefined;
      repostOf =
        original && canViewPost(original, ctx)
          ? view(original, false)
          : { id: row.repostOfId ?? '', unavailable: true as const };
    }

    return {
      id: row.id,
      type: row.type,
      content: row.content,
      mediaUrls: toUrlList(row.mediaUrls),
      videoUrl: row.videoUrl ?? null,
      thumbnailUrl: row.thumbnailUrl ?? null,
      isReel: !!row.isReel,
      isRepost: !!row.isRepost,
      linkUrl: row.linkUrl ?? null,
      visibility: row.visibility,
      isPinned: row.isPinned,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      editedAt: row.editedAt ?? null,
      user: { ...author, membershipTier: author.membershipTier ?? null },
      counts: {
        reactions: row.likeCount ?? 0,
        comments: row.commentCount ?? 0,
        reposts: row.repostCount ?? 0,
        views: row.viewCount ?? 0,
      },
      reactionSummary,
      topReactions,
      hashtags: (tagsByPost.get(row.id) ?? []).map((h) => h.hashtag.tag),
      mentions: (mentionsByPost.get(row.id) ?? []).map((m) => m.user),
      viewer: {
        reaction,
        saved: savedIds.has(row.id),
        reposted: repostedIds.has(rootId),
        isAuthor: !!ctx && ctx.id === row.userId,
        followsAuthor: !!ctx && ctx.followingIds.has(row.userId),
      },
      repostOf,
      reason: null,
      likeCount: row.likeCount ?? 0,
      commentCount: row.commentCount ?? 0,
      isLiked: reaction !== null,
      _count: { likes: row.likeCount ?? 0, comments: row.commentCount ?? 0 },
    };
  };

  return rows.map((row) => {
    const presented = view(row, true);
    // A plain repost reads as "<name> reposted" above the original
    if (row.isRepost && row.content === '') presented.reason = { type: 'REPOST', user: presented.user };
    return presented;
  });
}

/** True when a presented plain repost points at nothing the viewer can see (hide it from feeds). */
export const isDeadPlainRepost = (post: PostView) =>
  post.isRepost && post.content === '' && (!post.repostOf || 'unavailable' in post.repostOf);

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const commentInclude = {
  user: { select: authorLiteSelect },
  mentions: { select: { user: { select: { id: true, fullName: true } } } },
  _count: { select: { replies: true } },
} satisfies Prisma.PostCommentInclude;

export type CommentRow = Prisma.PostCommentGetPayload<{ include: typeof commentInclude }>;

export interface CommentView {
  id: string;
  postId: string;
  parentId: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  editedAt: Date | null;
  user: AuthorLite;
  mentions: Array<{ id: string; fullName: string }>;
  likeCount: number;
  replyCount: number;
  viewer: { reaction: ReactionType | null; isAuthor: boolean };
  previewReplies?: CommentView[];
}

/** Present comments (and any `replies` preloaded on them) with one viewer-reaction query. */
export async function presentComments(
  rows: Array<CommentRow & { replies?: CommentRow[] }>,
  ctx: ViewerContext | null
): Promise<CommentView[]> {
  if (!rows || rows.length === 0) return [];
  const all = rows.flatMap((r) => [r, ...(r.replies ?? [])]);
  const mine = ctx
    ? await prisma.commentReaction.findMany({
        where: { userId: ctx.id, commentId: { in: all.map((c) => c.id) } },
        select: { commentId: true, type: true },
      })
    : [];
  const myReaction = new Map((mine ?? []).map((r) => [r.commentId, r.type]));

  const view = (row: CommentRow): CommentView => ({
    id: row.id,
    postId: row.postId,
    parentId: row.parentId ?? null,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    editedAt: row.editedAt ?? null,
    user: row.user,
    mentions: (row.mentions ?? []).map((m) => m.user),
    likeCount: row.likeCount ?? 0,
    replyCount: row.parentId ? 0 : row._count?.replies ?? 0,
    viewer: { reaction: myReaction.get(row.id) ?? null, isAuthor: !!ctx && ctx.id === row.userId },
  });

  return rows.map((row) => {
    const presented = view(row);
    if (row.replies) presented.previewReplies = row.replies.map(view);
    return presented;
  });
}
