import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { PostType, Prisma } from '@prisma/client';
import { clientLinks } from '../utils/clientLinks';
import { isManagedStorageUrl } from '../utils/storage';
import { hashtagService } from './hashtagService';
import { reactionService } from './reactionService';
import { actorName, notifyOnce, SocialNotice } from './socialNotifications';
import { commentInclude, CommentView, postInclude, presentComments, presentPosts, PostView } from './postPresenter';
import {
  badRequest,
  canViewPost,
  loadViewerContext,
  notFound,
  pageResult,
  parsePage,
  parseVisibility,
  resolveMentionIds,
  ViewerInput,
  visiblePostWhere,
} from './socialShared';

export const POST_CONTENT_MAX_LENGTH = 5000;
export const COMMENT_CONTENT_MAX_LENGTH = 2000;
export const MAX_MEDIA_URLS = 10;
const POST_TYPES: PostType[] = ['GENERAL', 'JOB', 'BUSINESS', 'ANNOUNCEMENT'];

interface CreatePostInput {
  type?: PostType;
  content?: string;
  mediaUrls?: string[];
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  isReel?: boolean;
  visibility?: string;
  linkUrl?: string;
  mentionIds?: string[];
}

interface UpdatePostInput {
  type?: PostType;
  content?: string;
  mediaUrls?: string[];
  linkUrl?: string | null;
  isPinned?: boolean;
  visibility?: string;
  mentionIds?: string[];
  [key: string]: unknown;
}

const commenterSelect = { id: true, fullName: true, profilePhotoUrl: true } as const;

const validateContent = (content: unknown, max: number, label = 'Content'): string => {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new AppError(`${label} is required`, 400, 'VALIDATION_ERROR');
  }
  const trimmed = content.trim();
  if (trimmed.length > max) {
    throw new AppError(`${label} must be at most ${max} characters`, 400, 'VALIDATION_ERROR');
  }
  return trimmed;
};

/** Optional post text: '' is allowed (media-only posts), but never longer than the limit. */
const optionalContent = (content: unknown): string => {
  if (content === undefined || content === null) return '';
  if (typeof content !== 'string') throw badRequest('content must be a string');
  const trimmed = content.trim();
  if (trimmed.length > POST_CONTENT_MAX_LENGTH) {
    throw badRequest(`Content must be at most ${POST_CONTENT_MAX_LENGTH} characters`);
  }
  return trimmed;
};

const validateMediaUrls = (mediaUrls: unknown): string[] => {
  if (mediaUrls === undefined || mediaUrls === null) return [];
  if (!Array.isArray(mediaUrls) || mediaUrls.some(u => typeof u !== 'string' || u.trim() === '')) {
    throw new AppError('mediaUrls must be an array of URLs', 400, 'VALIDATION_ERROR');
  }
  if (mediaUrls.length > MAX_MEDIA_URLS) {
    throw new AppError(`A post can have at most ${MAX_MEDIA_URLS} media items`, 400, 'VALIDATION_ERROR');
  }
  return mediaUrls as string[];
};

/** Video and poster URLs must be files uploaded through this API (no hot-linking arbitrary media). */
const validateUploadedUrl = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !isManagedStorageUrl(value)) {
    throw badRequest(`${field} must be a file uploaded through this site`, 'INVALID_MEDIA_URL');
  }
  return value;
};

const validateType = (type: unknown): PostType => {
  if (!POST_TYPES.includes(type as PostType)) {
    throw new AppError('Invalid post type', 400, 'VALIDATION_ERROR');
  }
  return type as PostType;
};

export class PostService {
  /** v1 paginated feed (kept for older screens); visibility rules now apply. */
  async getFeed(userId?: string, page: number = 1, limit: number = 20, viewer?: ViewerInput) {
    const { skip, take, page: safePage, limit: safeLimit } = paginationHelper(page, limit);
    const ctx = await loadViewerContext(viewer ?? (userId ? { id: userId } : null));
    const where = visiblePostWhere(ctx);

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: postInclude,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      prisma.post.count({ where }),
    ]);

    return buildPaginationResponse(await presentPosts(posts ?? [], ctx), total, safePage, safeLimit);
  }

  /** PostView plus the v1 `comments` tree (top-level comments with their replies). */
  async getPost(id: string, viewer?: ViewerInput | null) {
    const [post, ctx] = await Promise.all([
      prisma.post.findUnique({ where: { id }, include: postInclude }),
      loadViewerContext(viewer),
    ]);
    if (!post || !canViewPost(post, ctx)) throw notFound();

    const [view] = await presentPosts([post], ctx);
    const comments = await prisma.postComment.findMany({
      where: { postId: id, parentId: null },
      include: {
        user: { select: commenterSelect },
        replies: { include: { user: { select: commenterSelect } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { ...view, comments: comments ?? [] };
  }

  async createPost(userId: string, data: CreatePostInput): Promise<PostView> {
    const input = data || {};
    const mediaUrls = validateMediaUrls(input.mediaUrls);
    const videoUrl = validateUploadedUrl(input.videoUrl, 'videoUrl');
    const thumbnailUrl = validateUploadedUrl(input.thumbnailUrl, 'thumbnailUrl');
    const content = optionalContent(input.content);
    const isReel = input.isReel === true;
    if (!content && mediaUrls.length === 0 && !videoUrl) {
      throw badRequest('A post needs text, an image or a video');
    }
    if (isReel && !videoUrl) throw badRequest('A reel needs a video (videoUrl)');
    const type = input.type === undefined ? 'GENERAL' : validateType(input.type);
    const visibility = parseVisibility(input.visibility);
    const mentionIds = await resolveMentionIds(input.mentionIds, userId);

    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: { userId, type, content, mediaUrls, videoUrl, thumbnailUrl, isReel, visibility, linkUrl: input.linkUrl },
        include: postInclude,
      });
      await hashtagService.syncPostHashtags(tx, created.id, content, created.createdAt);
      if (mentionIds.length) {
        await tx.postMention.createMany({ data: mentionIds.map((id) => ({ postId: created.id, userId: id })), skipDuplicates: true });
      }
      return created;
    });

    await this.notifyMentions(userId, post.id, mentionIds);
    const ctx = await loadViewerContext({ id: userId });
    const [view] = await presentPosts([post], ctx);
    return view;
  }

  async updatePost(userId: string, postId: string, data: UpdatePostInput, isAdmin: boolean = false): Promise<PostView> {
    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new AppError('Post not found', 404, 'NOT_FOUND');
    }

    const isOwner = post.userId === userId;
    if (!isOwner && !isAdmin) {
      throw new AppError('Not authorized to update this post', 403, 'FORBIDDEN');
    }

    // Whitelist editable fields; counters, ownership and publish state are never client-writable.
    const input = data || {};
    // Admins moderate other people's posts by pinning or deleting, never by rewriting them
    const contentFields = ['content', 'mediaUrls', 'linkUrl', 'type', 'visibility', 'mentionIds'] as const;
    if (!isOwner && contentFields.some((field) => input[field] !== undefined)) {
      throw new AppError("Only the author can edit a post's content", 403, 'FORBIDDEN');
    }
    const update: Prisma.PostUpdateInput = {};
    if (input.content !== undefined) {
      // A repost or media post may be text-free; a plain text post may not
      const hasMedia = !!post.videoUrl || (Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0);
      update.content =
        post.isRepost || hasMedia ? optionalContent(input.content) : validateContent(input.content, POST_CONTENT_MAX_LENGTH);
      if (post.isRepost && post.content === '' && update.content !== '') {
        throw badRequest('A plain repost has no text; quote the post instead', 'NOT_EDITABLE');
      }
    }
    if (input.mediaUrls !== undefined) update.mediaUrls = validateMediaUrls(input.mediaUrls);
    if (input.linkUrl !== undefined) {
      if (input.linkUrl !== null && typeof input.linkUrl !== 'string') {
        throw new AppError('linkUrl must be a string', 400, 'VALIDATION_ERROR');
      }
      update.linkUrl = input.linkUrl;
    }
    if (input.type !== undefined) update.type = validateType(input.type);
    if (input.visibility !== undefined) update.visibility = parseVisibility(input.visibility);
    const mentionIds = input.mentionIds !== undefined ? await resolveMentionIds(input.mentionIds, post.userId) : undefined;
    // Only admins can pin posts
    if (input.isPinned !== undefined && isAdmin) {
      update.isPinned = Boolean(input.isPinned);
    }

    if (Object.keys(update).length === 0 && mentionIds === undefined) {
      throw new AppError('No updatable fields provided', 400, 'VALIDATION_ERROR');
    }
    const editsContent = contentFields.some((field) => input[field] !== undefined);
    if (editsContent) update.editedAt = new Date();

    let newlyMentioned: string[] = [];
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.post.update({ where: { id: postId }, data: update, include: postInclude });
      if (typeof update.content === 'string') {
        await hashtagService.syncPostHashtags(tx, postId, update.content, post.createdAt);
      }
      if (mentionIds !== undefined) {
        const before = await tx.postMention.findMany({ where: { postId }, select: { userId: true } });
        const had = new Set((before ?? []).map((m) => m.userId));
        newlyMentioned = mentionIds.filter((id) => !had.has(id));
        await tx.postMention.deleteMany({ where: { postId, userId: { notIn: mentionIds } } });
        if (newlyMentioned.length) {
          await tx.postMention.createMany({ data: newlyMentioned.map((id) => ({ postId, userId: id })), skipDuplicates: true });
        }
      }
      return saved;
    });

    await this.notifyMentions(post.userId, postId, newlyMentioned);
    const ctx = await loadViewerContext({ id: userId, userRole: isAdmin ? 'ADMIN' : 'MEMBER' });
    const [view] = await presentPosts([updated], ctx);
    return view;
  }

  /**
   * Deleting a post removes plain reposts of it too; quote posts keep their text and show the
   * original as unavailable (repostOfId is set to NULL by the foreign key).
   */
  async deletePost(userId: string, postId: string, isAdmin: boolean = false) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new AppError('Post not found', 404, 'NOT_FOUND');
    }

    if (post.userId !== userId && !isAdmin) {
      throw new AppError('Not authorized to delete this post', 403, 'FORBIDDEN');
    }

    await prisma.$transaction(async (tx) => {
      await tx.post.deleteMany({ where: { repostOfId: postId, isRepost: true, content: '' } });
      await tx.post.delete({ where: { id: postId } });
      if (post.isRepost && post.repostOfId) {
        const reposts = await tx.post.count({ where: { repostOfId: post.repostOfId, isRepost: true } });
        await tx.post.updateMany({ where: { id: post.repostOfId }, data: { repostCount: reposts ?? 0 } });
      }
    });
    return { message: 'Post deleted successfully' };
  }

  /** v1 like toggle (see reactionService.toggleLike). */
  async likePost(userId: string, postId: string) {
    return reactionService.toggleLike({ id: userId }, postId);
  }

  /** One view per signed-in member per post (the author's own views are not counted). */
  async recordView(postId: string, viewer?: ViewerInput | null) {
    const [post, ctx] = await Promise.all([
      prisma.post.findUnique({ where: { id: postId }, include: { user: { select: { isActive: true } } } }),
      loadViewerContext(viewer),
    ]);
    if (!post || !canViewPost(post, ctx)) throw notFound();
    if (!ctx || ctx.id === post.userId) return { views: post.viewCount ?? 0 };

    // Insert the impression and bump the counter in one transaction: otherwise a crash
    // between them leaves the impression written (blocking any future increment) while
    // viewCount stays behind, so the post permanently under-counts that view.
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.postImpression.createMany({ data: [{ postId, userId: ctx.id }], skipDuplicates: true });
      if (!created?.count) return { counted: false as const, viewCount: undefined as number | undefined };
      const updated = await tx.post.update({ where: { id: postId }, data: { viewCount: { increment: 1 } }, select: { viewCount: true } });
      return { counted: true as const, viewCount: updated?.viewCount };
    });
    if (!result.counted) return { views: post.viewCount ?? 0 }; // this viewer was already counted
    return { views: result.viewCount ?? (post.viewCount ?? 0) + 1 };
  }

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  async listComments(postId: string, viewer: ViewerInput | null | undefined, query: { sort?: unknown; cursor?: unknown; limit?: unknown }) {
    const [post, ctx] = await Promise.all([
      prisma.post.findUnique({ where: { id: postId }, include: { user: { select: { isActive: true } } } }),
      loadViewerContext(viewer),
    ]);
    if (!post || !canViewPost(post, ctx)) throw notFound();
    const sort = query.sort === undefined || query.sort === '' ? 'top' : query.sort;
    if (sort !== 'top' && sort !== 'newest') throw badRequest('sort must be top or newest');
    const page = parsePage(query.cursor, query.limit);

    const rows = await prisma.postComment.findMany({
      where: { postId, parentId: null, createdAt: { lte: page.snapshot } },
      include: {
        ...commentInclude,
        replies: { include: commentInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 2 },
      },
      orderBy:
        sort === 'top'
          ? [{ likeCount: 'desc' }, { replies: { _count: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit + 1,
    });
    const result = pageResult(rows ?? [], page);
    return { items: await presentComments(result.items, ctx), nextCursor: result.nextCursor };
  }

  async listReplies(commentId: string, viewer: ViewerInput | null | undefined, query: { cursor?: unknown; limit?: unknown }) {
    const [parent, ctx] = await Promise.all([
      prisma.postComment.findUnique({
        where: { id: commentId },
        include: { post: { include: { user: { select: { isActive: true } } } } },
      }),
      loadViewerContext(viewer),
    ]);
    if (!parent || !canViewPost(parent.post, ctx)) throw new AppError('Comment not found', 404, 'NOT_FOUND');
    const page = parsePage(query.cursor, query.limit);

    const rows = await prisma.postComment.findMany({
      where: { parentId: commentId, createdAt: { lte: page.snapshot } },
      include: commentInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: page.offset,
      take: page.limit + 1,
    });
    const result = pageResult(rows ?? [], page);
    return { items: await presentComments(result.items, ctx), nextCursor: result.nextCursor };
  }

  async addComment(userId: string, postId: string, content: string, parentId?: string, rawMentionIds?: unknown): Promise<CommentView> {
    const text = validateContent(content, COMMENT_CONTENT_MAX_LENGTH, 'Comment');

    const [post, ctx] = await Promise.all([
      prisma.post.findUnique({ where: { id: postId }, include: { user: { select: { isActive: true } } } }),
      loadViewerContext({ id: userId }),
    ]);

    if (!post || !post.isPublished || !canViewPost(post, ctx)) {
      throw new AppError('Post not found', 404, 'NOT_FOUND');
    }

    // Replies are one level deep: a reply to a reply hangs off the top-level comment
    let parent: { id: string; userId: string; parentId: string | null } | null = null;
    if (parentId) {
      const parentComment = await prisma.postComment.findUnique({ where: { id: parentId } });
      if (!parentComment || parentComment.postId !== postId) {
        throw new AppError('Parent comment not found', 404, 'NOT_FOUND');
      }
      parent = parentComment;
    }
    const topLevelId = parent ? parent.parentId ?? parent.id : null;
    const mentionIds = await resolveMentionIds(rawMentionIds, userId);

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.postComment.create({
        data: { postId, userId, content: text, parentId: topLevelId },
        include: commentInclude,
      });
      if (mentionIds.length) {
        await tx.commentMention.createMany({ data: mentionIds.map((id) => ({ commentId: created.id, userId: id })), skipDuplicates: true });
      }
      const total = await tx.postComment.count({ where: { postId } });
      await tx.post.update({ where: { id: postId }, data: { commentCount: total ?? 0 } });
      return created;
    });

    const name = await actorName(userId);
    const link = clientLinks.post(postId, comment.id);
    const metadata = { postId, commentId: comment.id, commenterId: userId };
    const notices: SocialNotice[] = [];
    if (parent) {
      notices.push({ userId: parent.userId, type: 'COMMENT_REPLIED', title: 'New reply', message: `${name} replied to your comment`, link, metadata });
    }
    notices.push({ userId: post.userId, type: 'POST_COMMENTED', title: 'New Comment', message: `${name} commented on your post`, link, metadata });
    for (const id of mentionIds) {
      notices.push({ userId: id, type: 'MENTION', title: 'You were mentioned', message: `${name} mentioned you in a comment`, link, metadata });
    }
    await notifyOnce(userId, notices);

    const [view] = await presentComments([{ ...comment, mentions: comment.mentions ?? [] }], ctx);
    return view;
  }

  /**
   * Only the author may edit a comment. Admins can moderate by deleting, but never
   * rewrite someone else's words, so there is intentionally no isAdmin override.
   */
  async updateComment(userId: string, commentId: string, content: string, rawMentionIds?: unknown): Promise<CommentView> {
    const text = validateContent(content, COMMENT_CONTENT_MAX_LENGTH, 'Comment');

    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new AppError('Comment not found', 404, 'NOT_FOUND');
    }

    if (comment.userId !== userId) {
      throw new AppError('Not authorized to edit this comment', 403, 'FORBIDDEN');
    }

    const mentionIds = rawMentionIds === undefined ? undefined : await resolveMentionIds(rawMentionIds, userId);
    let newlyMentioned: string[] = [];
    const updated = await prisma.$transaction(async (tx) => {
      if (mentionIds !== undefined) {
        const before = await tx.commentMention.findMany({ where: { commentId }, select: { userId: true } });
        const had = new Set((before ?? []).map((m) => m.userId));
        newlyMentioned = mentionIds.filter((id) => !had.has(id));
        await tx.commentMention.deleteMany({ where: { commentId, userId: { notIn: mentionIds } } });
        if (newlyMentioned.length) {
          await tx.commentMention.createMany({ data: newlyMentioned.map((id) => ({ commentId, userId: id })), skipDuplicates: true });
        }
      }
      return tx.postComment.update({
        where: { id: commentId },
        data: { content: text, editedAt: new Date() },
        include: commentInclude,
      });
    });

    if (newlyMentioned.length) {
      const name = await actorName(userId);
      await notifyOnce(
        userId,
        newlyMentioned.map((id) => ({
          userId: id,
          type: 'MENTION' as const,
          title: 'You were mentioned',
          message: `${name} mentioned you in a comment`,
          link: clientLinks.post(comment.postId, commentId),
          metadata: { postId: comment.postId, commentId, commenterId: userId },
        }))
      );
    }

    const ctx = await loadViewerContext({ id: userId });
    const [view] = await presentComments([{ ...updated, mentions: updated.mentions ?? [] }], ctx);
    return view;
  }

  /** The comment's author, the post's author, or an admin may remove a comment (and its replies). */
  async deleteComment(userId: string, commentId: string, isAdmin: boolean = false) {
    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
      include: { post: { select: { userId: true } } },
    });

    if (!comment) {
      throw new AppError('Comment not found', 404, 'NOT_FOUND');
    }

    const isPostAuthor = comment.post?.userId === userId;
    if (comment.userId !== userId && !isPostAuthor && !isAdmin) {
      throw new AppError('Not authorized to delete this comment', 403, 'FORBIDDEN');
    }

    await prisma.$transaction(async (tx) => {
      // Replies cascade in the database; deleteMany covers rows written before that constraint
      await tx.postComment.deleteMany({ where: { parentId: commentId } });
      await tx.postComment.deleteMany({ where: { id: commentId } });

      // Re-derive the counter so it can never drift or go negative.
      const remaining = await tx.postComment.count({ where: { postId: comment.postId } });
      await tx.post.update({
        where: { id: comment.postId },
        data: { commentCount: Math.max(0, remaining || 0) },
      });
    });

    return { message: 'Comment deleted successfully' };
  }

  private async notifyMentions(authorId: string, postId: string, mentionIds: string[]) {
    if (mentionIds.length === 0) return;
    const name = await actorName(authorId);
    await notifyOnce(
      authorId,
      mentionIds.map((id) => ({
        userId: id,
        type: 'MENTION' as const,
        title: 'You were mentioned',
        message: `${name} mentioned you in a post`,
        link: clientLinks.post(postId),
        metadata: { postId, authorId },
      }))
    );
  }
}

export const postService = new PostService();
