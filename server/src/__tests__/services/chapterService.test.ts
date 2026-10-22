// updateChapter/assignAdmin scoping is covered in chapterScope.test.ts
import { chapterService } from '../../services/chapterService';
import { prismaMock } from '../../../tests/helpers';

const chapter = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Pune',
  region: 'West',
  adminUserId: null,
  isActive: true,
  memberCount: 3,
  ...overrides,
});

describe('chapterService', () => {
  describe('getChapters', () => {
    it('lists only active chapters, paginated', async () => {
      prismaMock.chapter.findMany.mockResolvedValue([chapter()]);
      prismaMock.chapter.count.mockResolvedValue(45);

      const result = await chapterService.getChapters(3, 20);

      const args = prismaMock.chapter.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ isActive: true });
      expect(args.skip).toBe(40);
      expect(args.take).toBe(20);
      expect(prismaMock.chapter.count).toHaveBeenCalledWith({ where: { isActive: true } });
      expect(result.pagination).toMatchObject({ page: 3, total: 45, totalPages: 3, hasNextPage: false });
    });

    it('uses normalised page/limit in the pagination block', async () => {
      prismaMock.chapter.findMany.mockResolvedValue([]);
      prismaMock.chapter.count.mockResolvedValue(0);
      const result = await chapterService.getChapters(0, -5);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBeGreaterThan(0);
    });

    it('filters by search (name/description) and region, counting with the same filter', async () => {
      prismaMock.chapter.findMany.mockResolvedValue([]);
      prismaMock.chapter.count.mockResolvedValue(0);

      await chapterService.getChapters(1, 20, { search: '  pune ', region: ' West ' });

      const where = prismaMock.chapter.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        isActive: true,
        region: 'West',
        OR: [{ name: { contains: 'pune', mode: 'insensitive' } }, { description: { contains: 'pune', mode: 'insensitive' } }],
      });
      expect(prismaMock.chapter.count).toHaveBeenCalledWith({ where });
    });

    it('caps the search term at 100 characters and ignores blank filters', async () => {
      prismaMock.chapter.findMany.mockResolvedValue([]);
      prismaMock.chapter.count.mockResolvedValue(0);

      await chapterService.getChapters(1, 20, { search: 'y'.repeat(300), region: '  ' });
      const where = prismaMock.chapter.findMany.mock.calls[0][0].where;
      expect(where.region).toBeUndefined();
      expect(where.OR[0].name.contains).toHaveLength(100);
    });

    it('returns the sorted distinct regions of active chapters (independent of filters)', async () => {
      prismaMock.chapter.findMany.mockImplementation((async (args: any) =>
        args?.distinct ? [{ region: 'North' }, { region: 'West' }] : [chapter()]) as any);
      prismaMock.chapter.count.mockResolvedValue(1);

      const result = await chapterService.getChapters(1, 20, { region: 'West' });

      const regionCall = prismaMock.chapter.findMany.mock.calls.find(c => (c[0] as any)?.distinct)![0] as any;
      expect(regionCall).toMatchObject({
        where: { isActive: true },
        distinct: ['region'],
        select: { region: true },
        orderBy: { region: 'asc' },
      });
      expect(result.regions).toEqual(['North', 'West']);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getChapter', () => {
    it('returns an active chapter without exposing member details', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter());
      await expect(chapterService.getChapter('c1')).resolves.toMatchObject({ id: 'c1' });
      const include = prismaMock.chapter.findUnique.mock.calls[0][0].include;
      expect(include.memberships).toBeUndefined();
      expect(include._count).toBeDefined();
    });

    it('404s for unknown or inactive chapters', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(null);
      await expect(chapterService.getChapter('x')).rejects.toMatchObject({ statusCode: 404 });
      prismaMock.chapter.findUnique.mockResolvedValue(chapter({ isActive: false }));
      await expect(chapterService.getChapter('c1')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('createChapter', () => {
    it('creates a chapter with trimmed name/region', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(null);
      prismaMock.chapter.create.mockResolvedValue(chapter());
      await chapterService.createChapter({ name: ' Pune ', region: ' West ', description: 'd' });
      expect(prismaMock.chapter.findUnique).toHaveBeenCalledWith({ where: { name: 'Pune' } });
      expect(prismaMock.chapter.create.mock.calls[0][0].data).toMatchObject({ name: 'Pune', region: 'West', description: 'd' });
    });

    it('409s on a duplicate name', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter());
      await expect(chapterService.createChapter({ name: 'Pune', region: 'West' })).rejects.toMatchObject({ statusCode: 409 });
      expect(prismaMock.chapter.create).not.toHaveBeenCalled();
    });

    it.each([[{ region: 'West' }], [{ name: ' ', region: 'West' }], [{ name: 'Pune' }], [{ name: 'Pune', region: '' }]])(
      'rejects invalid input %j',
      async input => {
        await expect(chapterService.createChapter(input as any)).rejects.toMatchObject({ statusCode: 400 });
      }
    );
  });

  describe('deleteChapter', () => {
    it('soft-deletes (deactivates) the chapter', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter());
      await expect(chapterService.deleteChapter('c1')).resolves.toEqual({ message: 'Chapter deactivated' });
      expect(prismaMock.chapter.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isActive: false } });
      expect(prismaMock.chapter.delete).not.toHaveBeenCalled();
    });

    it('404s for unknown chapters', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(null);
      await expect(chapterService.deleteChapter('x')).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.chapter.update).not.toHaveBeenCalled();
    });
  });

  describe('joinChapter', () => {
    it('creates the membership and increments memberCount in a transaction', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter());
      prismaMock.chapterMembership.findUnique.mockResolvedValue(null);

      await expect(chapterService.joinChapter('u1', 'c1')).resolves.toEqual({ message: 'Joined chapter successfully' });

      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.chapterMembership.create).toHaveBeenCalledWith({ data: { chapterId: 'c1', userId: 'u1' } });
      expect(prismaMock.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { memberCount: { increment: 1 } },
      });
    });

    it('404s for unknown or inactive chapters', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter({ isActive: false }));
      await expect(chapterService.joinChapter('u1', 'c1')).rejects.toMatchObject({ statusCode: 404 });
      prismaMock.chapter.findUnique.mockResolvedValue(null);
      await expect(chapterService.joinChapter('u1', 'x')).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.chapterMembership.create).not.toHaveBeenCalled();
    });

    it('409s when already a member', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter());
      prismaMock.chapterMembership.findUnique.mockResolvedValue({ id: 'm1' });
      await expect(chapterService.joinChapter('u1', 'c1')).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_MEMBER' });
      expect(prismaMock.chapterMembership.create).not.toHaveBeenCalled();
      expect(prismaMock.chapter.update).not.toHaveBeenCalled();
    });

    it('maps a concurrent unique-key violation to 409', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter());
      prismaMock.chapterMembership.findUnique.mockResolvedValue(null);
      prismaMock.chapterMembership.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
      await expect(chapterService.joinChapter('u1', 'c1')).rejects.toMatchObject({ statusCode: 409 });
      expect(prismaMock.chapter.update).not.toHaveBeenCalled();
    });

    it('rethrows other database errors', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter());
      prismaMock.chapterMembership.findUnique.mockResolvedValue(null);
      prismaMock.chapterMembership.create.mockRejectedValue(new Error('db down'));
      await expect(chapterService.joinChapter('u1', 'c1')).rejects.toThrow('db down');
    });
  });

  describe('leaveChapter', () => {
    it('removes the membership and decrements memberCount guarded against negatives', async () => {
      prismaMock.chapterMembership.findUnique.mockResolvedValue({ id: 'm1' });
      await expect(chapterService.leaveChapter('u1', 'c1')).resolves.toEqual({ message: 'Left chapter successfully' });
      expect(prismaMock.chapterMembership.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
      expect(prismaMock.chapter.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', memberCount: { gt: 0 } },
        data: { memberCount: { decrement: 1 } },
      });
      expect(prismaMock.chapter.update).not.toHaveBeenCalled();
    });

    it('400s when not a member', async () => {
      prismaMock.chapterMembership.findUnique.mockResolvedValue(null);
      await expect(chapterService.leaveChapter('u1', 'c1')).rejects.toMatchObject({ statusCode: 400, code: 'NOT_MEMBER' });
      expect(prismaMock.chapterMembership.delete).not.toHaveBeenCalled();
    });
  });

  describe('getChapterMembers', () => {
    it('returns a paginated, flattened member list', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter());
      const joinedAt = new Date('2026-02-01');
      prismaMock.chapterMembership.findMany.mockResolvedValue([{ joinedAt, user: { id: 'u1', fullName: 'A' } }]);
      prismaMock.chapterMembership.count.mockResolvedValue(21);

      const result = await chapterService.getChapterMembers('c1', 2, 20);

      const args = prismaMock.chapterMembership.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ chapterId: 'c1' });
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
      expect(args.include.user.select.email).toBeUndefined();
      expect(result.data).toEqual([{ id: 'u1', fullName: 'A', joinedAt }]);
      expect(result.pagination).toMatchObject({ page: 2, total: 21, totalPages: 2 });
    });

    it('404s for unknown or inactive chapters', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter({ isActive: false }));
      await expect(chapterService.getChapterMembers('c1')).rejects.toMatchObject({ statusCode: 404 });
      prismaMock.chapter.findUnique.mockResolvedValue(null);
      await expect(chapterService.getChapterMembers('x')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('getUserChapters', () => {
    it("returns the user's active chapters with joinedAt", async () => {
      const joinedAt = new Date();
      prismaMock.chapterMembership.findMany.mockResolvedValue([{ joinedAt, chapter: chapter() }]);
      const result = await chapterService.getUserChapters('u1');
      expect(prismaMock.chapterMembership.findMany.mock.calls[0][0].where).toEqual({
        userId: 'u1',
        chapter: { isActive: true },
      });
      expect(result).toEqual([{ ...chapter(), joinedAt }]);
    });
  });
});
