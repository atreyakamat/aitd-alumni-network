import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { clientLinks } from '../utils/clientLinks';
import { hashtagService } from './hashtagService';
import { postInclude, presentPosts } from './postPresenter';
import { POST_CONTENT_MAX_LENGTH } from './postService';
import { actorName, notifyOnce } from './socialNotifications';
import {
  badRequest,
  canViewPost,
  isUniqueViolation,
  loadViewerContext,
  notFound,
  parseVisibility,
  ViewerInput,
} from './socialShared';

const notRepostable = (message: string) => new AppError(message, 403, 'NOT_REPOSTABLE');
export const plainRepostKey = (userId: string, originalId: string) => `${userId}:${originalId}`;

type Tx = Prisma.TransactionClient;

/** Reposts (plain and quote) that still point at the original. */
const recountReposts = async (tx: Tx, originalId: string) => {
  const total = await tx.post.count({ where: { repostOfId: originalId, isRepost: true } });
  await tx.post.update({ where: { id: originalId }, data: { repostCount: total ?? 0 } });
  return total ?? 0;
};

export class RepostService {
  /** Plain repost (no content) or quote post (with content) of the root original. */
  async repost(viewer: ViewerInput, postId: string, body: { content?: unknown; visibility?: unknown } = {}) {
    const ctx = await loadViewerContext(viewer);
    const target = await prisma.post.findUnique({ where: { id: postId }, include: postInclude });
    if (!target || !canViewPost(target, ctx)) throw notFound();

    // Reposting a repost always targets the original
    let original = target;
    if (target.isRepost) {
      const root = target.repostOfId
        ? await prisma.post.findUnique({ where: { id: target.repostOfId }, include: postInclude })
        : null;
      if (!root || !canViewPost(root, ctx)) throw notRepostable('The original post is no longer available');
      original = root;
    }
    if (!original.isPublished || original.visibility !== 'PUBLIC') {
      throw notRepostable('Only public posts can be reposted');
    }

    if (body.content !== undefined && body.content !== null && typeof body.content !== 'string') {
      throw badRequest('content must be a string');
    }
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (content.length > POST_CONTENT_MAX_LENGTH) {
      throw badRequest(`Content must be at most ${POST_CONTENT_MAX_LENGTH} characters`);
    }
    const isPlain = content === '';
    if (isPlain && original.userId === viewer.id) {
      throw notRepostable('Quote your own post to share it again');
    }
    const visibility = isPlain ? 'PUBLIC' : parseVisibility(body.visibility);

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const post = await tx.post.create({
          data: {
            userId: viewer.id,
            content,
            visibility,
            isRepost: true,
            repostOfId: original.id,
            plainRepostKey: isPlain ? plainRepostKey(viewer.id, original.id) : null,
          },
          include: postInclude,
        });
        if (!isPlain) await hashtagService.syncPostHashtags(tx, post.id, content, post.createdAt);
        await recountReposts(tx, original.id);
        return post;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('You already reposted this post', 409, 'ALREADY_REPOSTED');
      throw err;
    }

    if (original.userId !== viewer.id) {
      const name = await actorName(viewer.id);
      await notifyOnce(viewer.id, [
        {
          userId: original.userId,
          type: 'POST_REPOSTED',
          title: 'Your post was reposted',
          message: isPlain ? `${name} reposted your post` : `${name} shared your post with their thoughts`,
          link: clientLinks.post(isPlain ? original.id : created.id),
          metadata: { postId: original.id, repostId: created.id, reposterId: viewer.id },
        },
      ]);
    }

    const [view] = await presentPosts([created], ctx);
    return view;
  }

  /** Undo the viewer's plain repost of `postId` (or of the original it reposts). */
  async undoRepost(viewer: ViewerInput, postId: string) {
    const target = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, isRepost: true, repostOfId: true } });
    if (!target) throw notFound();
    const originalId = target.isRepost && target.repostOfId ? target.repostOfId : target.id;

    const reposts = await prisma.$transaction(async (tx) => {
      const removed = await tx.post.deleteMany({ where: { plainRepostKey: plainRepostKey(viewer.id, originalId) } });
      if (!removed?.count) throw new AppError('You have not reposted this post', 404, 'NOT_REPOSTED');
      return recountReposts(tx, originalId);
    });
    return { reposted: false, counts: { reposts } };
  }
}

export const repostService = new RepostService();
