import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { parseHashtags, visiblePostWhere } from './socialShared';

type Tx = Prisma.TransactionClient;

export const TRENDING_MAX_DAYS = 30;
export const TRENDING_MAX_LIMIT = 50;

export class HashtagService {
  /** Replace a post's hashtags with the ones in `content` (inside the caller's transaction). */
  async syncPostHashtags(tx: Tx, postId: string, content: string, taggedAt: Date): Promise<string[]> {
    const tags = parseHashtags(content);
    await tx.postHashtag.deleteMany({ where: { postId } });
    if (tags.length === 0) return [];

    await tx.hashtag.createMany({ data: tags.map((tag) => ({ tag })), skipDuplicates: true });
    const rows = await tx.hashtag.findMany({ where: { tag: { in: tags } }, select: { id: true } });
    await tx.postHashtag.createMany({
      data: (rows ?? []).map((h) => ({ postId, hashtagId: h.id, createdAt: taggedAt })),
      skipDuplicates: true,
    });
    return tags;
  }

  /** Most used tags on public posts in the last `days` days. */
  async getTrending(rawDays: unknown = 7, rawLimit: unknown = 10, now: Date = new Date()) {
    const days = clamp(rawDays, 7, 1, TRENDING_MAX_DAYS);
    const limit = clamp(rawLimit, 10, 1, TRENDING_MAX_LIMIT);
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const groups = await prisma.postHashtag.groupBy({
      by: ['hashtagId'],
      where: { createdAt: { gte: since }, post: visiblePostWhere(null) },
      _count: { _all: true },
      orderBy: { _count: { postId: 'desc' } },
      take: limit,
    });
    const list = (groups ?? []) as Array<{ hashtagId: string; _count: { _all: number } }>;
    if (list.length === 0) return [];

    const tags = await prisma.hashtag.findMany({ where: { id: { in: list.map((g) => g.hashtagId) } } });
    const tagById = new Map((tags ?? []).map((t) => [t.id, t.tag]));
    return list
      .filter((g) => tagById.has(g.hashtagId))
      .map((g) => ({ tag: tagById.get(g.hashtagId)!, postCount: g._count._all }))
      .sort((a, b) => b.postCount - a.postCount || a.tag.localeCompare(b.tag));
  }
}

const clamp = (raw: unknown, fallback: number, min: number, max: number) => {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

export const hashtagService = new HashtagService();
