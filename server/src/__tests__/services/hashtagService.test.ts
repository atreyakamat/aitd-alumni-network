import { hashtagService } from '../../services/hashtagService';
import { prismaMock } from '../../../tests/helpers';

describe('hashtagService', () => {
  describe('syncPostHashtags', () => {
    const at = new Date('2026-10-18T10:00:00Z');

    it('replaces the post’s tags with the ones in the content', async () => {
      prismaMock.hashtag.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);

      const tags = await hashtagService.syncPostHashtags(prismaMock, 'p1', '#Reunion and #batch2015', at);

      expect(tags).toEqual(['reunion', 'batch2015']);
      expect(prismaMock.postHashtag.deleteMany).toHaveBeenCalledWith({ where: { postId: 'p1' } });
      expect(prismaMock.hashtag.createMany).toHaveBeenCalledWith({ data: [{ tag: 'reunion' }, { tag: 'batch2015' }], skipDuplicates: true });
      expect(prismaMock.postHashtag.createMany).toHaveBeenCalledWith({
        data: [
          { postId: 'p1', hashtagId: 'h1', createdAt: at },
          { postId: 'p1', hashtagId: 'h2', createdAt: at },
        ],
        skipDuplicates: true,
      });
    });

    it('only clears tags when there are none', async () => {
      await expect(hashtagService.syncPostHashtags(prismaMock, 'p1', 'no tags', at)).resolves.toEqual([]);
      expect(prismaMock.postHashtag.deleteMany).toHaveBeenCalled();
      expect(prismaMock.hashtag.createMany).not.toHaveBeenCalled();
    });

    it('tolerates an empty tag lookup', async () => {
      prismaMock.hashtag.findMany.mockResolvedValue(undefined);
      await hashtagService.syncPostHashtags(prismaMock, 'p1', '#x1', at);
      expect(prismaMock.postHashtag.createMany).toHaveBeenCalledWith({ data: [], skipDuplicates: true });
    });
  });

  describe('getTrending', () => {
    const now = new Date('2026-10-19T00:00:00Z');

    it('counts tags on public posts in the window, most used first', async () => {
      prismaMock.postHashtag.groupBy.mockResolvedValue([
        { hashtagId: 'h2', _count: { _all: 3 } },
        { hashtagId: 'h1', _count: { _all: 5 } },
        { hashtagId: 'gone', _count: { _all: 9 } },
      ]);
      prismaMock.hashtag.findMany.mockResolvedValue([
        { id: 'h1', tag: 'placements' },
        { id: 'h2', tag: 'reunion' },
      ]);

      const result = await hashtagService.getTrending('3', '5', now);

      const args = prismaMock.postHashtag.groupBy.mock.calls[0][0];
      expect(args.where.createdAt).toEqual({ gte: new Date('2026-10-16T00:00:00Z') });
      expect(args.where.post).toEqual({ isPublished: true, user: { isActive: true }, visibility: 'PUBLIC' });
      expect(args.take).toBe(5);
      expect(result).toEqual([
        { tag: 'placements', postCount: 5 },
        { tag: 'reunion', postCount: 3 },
      ]);
    });

    it('clamps the window and limit, and returns [] when nothing is trending', async () => {
      prismaMock.postHashtag.groupBy.mockResolvedValue(undefined);
      await expect(hashtagService.getTrending(999, 'lots', now)).resolves.toEqual([]);
      const args = prismaMock.postHashtag.groupBy.mock.calls[0][0];
      expect(args.where.createdAt.gte).toEqual(new Date('2026-09-19T00:00:00Z'));
      expect(args.take).toBe(10);
      await hashtagService.getTrending(undefined, 0);
      expect(prismaMock.postHashtag.groupBy.mock.calls[1][0].take).toBe(1);
    });

    it('sorts ties alphabetically and tolerates a missing tag lookup', async () => {
      prismaMock.postHashtag.groupBy.mockResolvedValue([
        { hashtagId: 'b', _count: { _all: 2 } },
        { hashtagId: 'a', _count: { _all: 2 } },
      ]);
      prismaMock.hashtag.findMany.mockResolvedValue([
        { id: 'b', tag: 'beta' },
        { id: 'a', tag: 'alpha' },
      ]);
      expect((await hashtagService.getTrending()).map((t) => t.tag)).toEqual(['alpha', 'beta']);

      prismaMock.hashtag.findMany.mockResolvedValue(undefined);
      await expect(hashtagService.getTrending()).resolves.toEqual([]);
    });
  });
});
