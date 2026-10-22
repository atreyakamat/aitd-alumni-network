import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { clientLinks } from '../utils/clientLinks';
import { ilike } from '../utils/helpers';
import { actorName, notifyOnce } from './socialNotifications';
import { authorLiteSelect, badRequest, isUniqueViolation, loadViewerContext, pageResult, parsePage, ViewerInput } from './socialShared';

export const MENTION_SEARCH_MAX = 10;
const userNotFound = () => new AppError('User not found', 404, 'USER_NOT_FOUND');

export class FollowService {
  async follow(viewer: ViewerInput, targetId: string) {
    if (viewer.id === targetId) throw badRequest('You cannot follow yourself', 'CANNOT_FOLLOW_SELF');
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } });
    if (!target || !target.isActive) throw userNotFound();

    let isNew = false;
    try {
      await prisma.follow.create({ data: { followerId: viewer.id, followingId: targetId } });
      isNew = true;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }

    if (isNew) {
      await notifyOnce(viewer.id, [
        {
          userId: targetId,
          type: 'NEW_FOLLOWER',
          title: 'New follower',
          message: `${await actorName(viewer.id)} started following you`,
          link: clientLinks.profile(viewer.id),
          metadata: { followerId: viewer.id },
        },
      ]);
    }
    return { following: true, followerCount: await this.followerCount(targetId) };
  }

  async unfollow(viewer: ViewerInput, targetId: string) {
    await prisma.follow.deleteMany({ where: { followerId: viewer.id, followingId: targetId } });
    return { following: false, followerCount: await this.followerCount(targetId) };
  }

  async listFollowers(viewer: ViewerInput, userId: string, query: { cursor?: unknown; limit?: unknown }) {
    return this.list(viewer, userId, 'followers', query);
  }

  async listFollowing(viewer: ViewerInput, userId: string, query: { cursor?: unknown; limit?: unknown }) {
    return this.list(viewer, userId, 'following', query);
  }

  /** Counts and the viewer's follow state for a profile header. */
  async profileStats(userId: string, viewerId?: string) {
    const [followerCount, followingCount, mine] = await Promise.all([
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.count({ where: { followerId: userId } }),
      viewerId && viewerId !== userId
        ? prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: userId } } })
        : null,
    ]);
    return { followerCount: followerCount ?? 0, followingCount: followingCount ?? 0, isFollowing: !!mine };
  }

  /** Active, verified members by name for @-mentions; connections and followed people first. */
  async mentionSearch(viewer: ViewerInput, rawQuery: unknown, rawLimit?: unknown) {
    const q = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 100) : '';
    if (!q) throw badRequest('q is required');
    const limitNum = typeof rawLimit === 'string' ? parseInt(rawLimit, 10) : NaN;
    const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(limitNum, MENTION_SEARCH_MAX) : MENTION_SEARCH_MAX;

    const [ctx, users] = await Promise.all([
      loadViewerContext(viewer),
      prisma.user.findMany({
        where: { isActive: true, isVerified: true, id: { not: viewer.id }, fullName: ilike(q) },
        select: authorLiteSelect,
        orderBy: { fullName: 'asc' },
        take: 50,
      }),
    ]);
    const close = (id: string) => (ctx?.connectionIds.has(id) || ctx?.followingIds.has(id) ? 0 : 1);
    return (users ?? [])
      .map((u, i) => ({ u, i }))
      .sort((a, b) => close(a.u.id) - close(b.u.id) || a.i - b.i)
      .slice(0, limit)
      .map(({ u }) => u);
  }

  private async list(viewer: ViewerInput, userId: string, direction: 'followers' | 'following', query: { cursor?: unknown; limit?: unknown }) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
    if (!user || !user.isActive) throw userNotFound();
    const page = parsePage(query.cursor, query.limit);

    const rows = await prisma.follow.findMany({
      where: {
        ...(direction === 'followers' ? { followingId: userId } : { followerId: userId }),
        createdAt: { lte: page.snapshot },
      },
      select: {
        follower: { select: { ...authorLiteSelect, isActive: true } },
        following: { select: { ...authorLiteSelect, isActive: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit + 1,
    });
    const result = pageResult(rows ?? [], page);
    const people = result.items
      .map((r) => (direction === 'followers' ? r.follower : r.following))
      .filter((p) => p && p.isActive);

    const mine = await prisma.follow.findMany({
      where: { followerId: viewer.id, followingId: { in: people.map((p) => p.id) } },
      select: { followingId: true },
    });
    const followed = new Set((mine ?? []).map((f) => f.followingId));
    return {
      items: people.map(({ isActive: _active, ...p }) => ({ ...p, viewerFollows: followed.has(p.id) })), // eslint-disable-line @typescript-eslint/no-unused-vars
      nextCursor: result.nextCursor,
    };
  }

  private async followerCount(userId: string) {
    return (await prisma.follow.count({ where: { followingId: userId } })) ?? 0;
  }
}

export const followService = new FollowService();
