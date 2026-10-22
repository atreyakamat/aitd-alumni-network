import { ReactionType } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { clientLinks } from '../utils/clientLinks';
import { actorName, notifyOnce, reactionMessage } from './socialNotifications';
import {
  authorLiteSelect,
  canViewPost,
  isUniqueViolation,
  loadViewerContext,
  notFound,
  pageResult,
  parsePage,
  parseReaction,
  summarizeReactions,
  ViewerInput,
} from './socialShared';

export class ReactionService {
  /**
   * Set, change or (same type again) remove the viewer's reaction. Counters are re-derived
   * from the rows so duplicate or concurrent requests never drift them.
   */
  async reactToPost(viewer: ViewerInput, postId: string, rawType: unknown) {
    const type = parseReaction(rawType);
    const post = await prisma.post.findUnique({ where: { id: postId }, include: { user: { select: { isActive: true } } } });
    const ctx = await loadViewerContext(viewer);
    if (!post || !canViewPost(post, ctx)) throw notFound();

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.postLike.findUnique({ where: { postId_userId: { postId, userId: viewer.id } } });
      let reaction: ReactionType | null;
      let isNew = false;
      if (existing && existing.type === type) {
        await tx.postLike.deleteMany({ where: { postId, userId: viewer.id } });
        reaction = null;
      } else if (existing) {
        await tx.postLike.update({ where: { postId_userId: { postId, userId: viewer.id } }, data: { type } });
        reaction = type;
      } else {
        try {
          await tx.postLike.create({ data: { postId, userId: viewer.id, type } });
          isNew = true;
        } catch (err) {
          // A concurrent request created it first: make it this type
          if (!isUniqueViolation(err)) throw err;
          await tx.postLike.update({ where: { postId_userId: { postId, userId: viewer.id } }, data: { type } });
        }
        reaction = type;
      }

      const groups = await tx.postLike.groupBy({
        by: ['postId', 'type'],
        where: { postId },
        _count: { _all: true },
      });
      const rows = ((groups ?? []) as Array<{ type: ReactionType; _count?: { _all?: number } }>).map((g) => ({
        type: g.type,
        count: g._count?._all ?? 0,
      }));
      const total = rows.reduce((sum, r) => sum + r.count, 0);
      await tx.post.update({ where: { id: postId }, data: { likeCount: total } });
      return { reaction, isNew, total, ...summarizeReactions(rows) };
    });

    if (result.isNew && post.userId !== viewer.id) {
      await notifyOnce(viewer.id, [
        {
          userId: post.userId,
          type: 'POST_REACTED',
          title: 'New reaction',
          message: reactionMessage(await actorName(viewer.id), type, 'post'),
          link: clientLinks.post(postId),
          metadata: { postId, reactorId: viewer.id, reaction: type },
        },
      ]);
    }

    return {
      reaction: result.reaction,
      counts: { reactions: result.total },
      reactionSummary: result.reactionSummary,
      topReactions: result.topReactions,
    };
  }

  /** v1 like toggle: LIKE when the viewer has no reaction, otherwise removes whatever they had. */
  async toggleLike(viewer: ViewerInput, postId: string) {
    const existing = await prisma.postLike.findUnique({ where: { postId_userId: { postId, userId: viewer.id } } });
    const result = await this.reactToPost(viewer, postId, existing?.type ?? 'LIKE');
    return { liked: result.reaction !== null, likeCount: result.counts.reactions, reaction: result.reaction };
  }

  async listPostReactions(viewer: ViewerInput, postId: string, query: { type?: unknown; cursor?: unknown; limit?: unknown }) {
    const post = await prisma.post.findUnique({ where: { id: postId }, include: { user: { select: { isActive: true } } } });
    const ctx = await loadViewerContext(viewer);
    if (!post || !canViewPost(post, ctx)) throw notFound();
    const type = query.type === undefined || query.type === '' ? undefined : parseReaction(query.type);
    const page = parsePage(query.cursor, query.limit);

    const rows = await prisma.postLike.findMany({
      where: { postId, createdAt: { lte: page.snapshot }, ...(type ? { type } : {}) },
      select: { type: true, createdAt: true, user: { select: authorLiteSelect } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit + 1,
    });
    return pageResult(rows ?? [], page);
  }

  async reactToComment(viewer: ViewerInput, commentId: string, rawType: unknown) {
    const type = parseReaction(rawType);
    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
      include: { post: { include: { user: { select: { isActive: true } } } } },
    });
    const ctx = await loadViewerContext(viewer);
    if (!comment || !canViewPost(comment.post, ctx)) throw new AppError('Comment not found', 404, 'NOT_FOUND');

    const result = await prisma.$transaction(async (tx) => {
      const key = { commentId_userId: { commentId, userId: viewer.id } };
      const existing = await tx.commentReaction.findUnique({ where: key });
      let reaction: ReactionType | null = type;
      let isNew = false;
      if (existing && existing.type === type) {
        await tx.commentReaction.deleteMany({ where: { commentId, userId: viewer.id } });
        reaction = null;
      } else if (existing) {
        await tx.commentReaction.update({ where: key, data: { type } });
      } else {
        try {
          await tx.commentReaction.create({ data: { commentId, userId: viewer.id, type } });
          isNew = true;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          await tx.commentReaction.update({ where: key, data: { type } });
        }
      }
      const likeCount = await tx.commentReaction.count({ where: { commentId } });
      await tx.postComment.update({ where: { id: commentId }, data: { likeCount: likeCount ?? 0 } });
      return { reaction, isNew, likeCount: likeCount ?? 0 };
    });

    if (result.isNew && comment.userId !== viewer.id) {
      await notifyOnce(viewer.id, [
        {
          userId: comment.userId,
          type: 'COMMENT_REACTED',
          title: 'New reaction',
          message: reactionMessage(await actorName(viewer.id), type, 'comment'),
          link: clientLinks.post(comment.postId, commentId),
          metadata: { postId: comment.postId, commentId, reactorId: viewer.id, reaction: type },
        },
      ]);
    }

    return { reaction: result.reaction, likeCount: result.likeCount };
  }
}

export const reactionService = new ReactionService();
