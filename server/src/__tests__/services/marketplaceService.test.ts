import { marketplaceService } from '../../services/marketplaceService';
import { prismaMock } from '../../../tests/helpers';

const owner = { id: 'u1', userRole: 'MEMBER' as const };
const stranger = { id: 'u2', userRole: 'MEMBER' as const };
const admin = { id: 'a1', userRole: 'ADMIN' as const };

const listing = (overrides: Record<string, unknown> = {}) => ({
  id: 'l1',
  userId: 'u1',
  type: 'BUSINESS',
  title: 'Cafe',
  category: 'Food',
  description: 'Coffee',
  isActive: true,
  isFeatured: false,
  viewCount: 7,
  ...overrides,
});

describe('marketplaceService', () => {
  describe('getListings', () => {
    beforeEach(() => {
      prismaMock.marketplaceListing.findMany.mockResolvedValue([listing()]);
      prismaMock.marketplaceListing.count.mockResolvedValue(13);
    });

    it('lists only active listings, featured first, paginated', async () => {
      const result = await marketplaceService.getListings({ page: 2, limit: 12 });
      const args = prismaMock.marketplaceListing.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ isActive: true });
      expect(args.orderBy).toEqual([{ isFeatured: 'desc' }, { createdAt: 'desc' }]);
      expect(args.skip).toBe(12);
      expect(args.take).toBe(12);
      expect(args.include.user.select.email).toBeUndefined();
      expect(result.pagination).toMatchObject({ page: 2, total: 13, totalPages: 2 });
    });

    it('applies type, category, location and search filters', async () => {
      await marketplaceService.getListings({ type: 'SERVICE', category: 'Food', location: 'Pune', search: 'cof' });
      expect(prismaMock.marketplaceListing.findMany.mock.calls[0][0].where).toEqual({
        isActive: true,
        type: 'SERVICE',
        category: 'Food',
        location: { contains: 'Pune', mode: 'insensitive' },
        OR: [{ title: { contains: 'cof', mode: 'insensitive' } }, { description: { contains: 'cof', mode: 'insensitive' } }],
      });
    });

    it('trims the search term, caps it at 100 characters and ignores blank searches', async () => {
      await marketplaceService.getListings({ search: `  ${'a'.repeat(150)}  ` });
      const where = prismaMock.marketplaceListing.findMany.mock.calls[0][0].where;
      expect(where.OR[0].title.contains).toBe('a'.repeat(100));
      expect(where.OR[1].description.contains).toBe('a'.repeat(100));

      await marketplaceService.getListings({ search: '   ', category: '  ' });
      expect(prismaMock.marketplaceListing.findMany.mock.calls[1][0].where).toEqual({ isActive: true });
    });

    it('rejects an unknown listing type', async () => {
      await expect(marketplaceService.getListings({ type: 'WEAPONS' as any })).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('getListing', () => {
    it('returns an active listing and counts a view', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      const result = await marketplaceService.getListing('l1');
      expect(prismaMock.marketplaceListing.update).toHaveBeenCalledWith({
        where: { id: 'l1' },
        data: { viewCount: { increment: 1 } },
      });
      expect(result.viewCount).toBe(8);
    });

    it("does not count the owner's own views", async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      const result = await marketplaceService.getListing('l1', owner);
      expect(prismaMock.marketplaceListing.update).not.toHaveBeenCalled();
      expect(result.viewCount).toBe(7);
    });

    it('hides inactive listings from the public and other members', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing({ isActive: false }));
      await expect(marketplaceService.getListing('l1')).rejects.toMatchObject({ statusCode: 404 });
      await expect(marketplaceService.getListing('l1', stranger)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('shows inactive listings to the owner and admins', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing({ isActive: false, viewCount: undefined }));
      await expect(marketplaceService.getListing('l1', owner)).resolves.toMatchObject({ id: 'l1' });
      await expect(marketplaceService.getListing('l1', admin)).resolves.toMatchObject({ viewCount: 1 });
    });

    it('404s for unknown listings', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(null);
      await expect(marketplaceService.getListing('x')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('createListing', () => {
    it('creates a listing owned by the caller with defaults', async () => {
      prismaMock.marketplaceListing.create.mockImplementation(async (a: any) => a.data);
      const result = await marketplaceService.createListing('u1', {
        title: ' Cafe ',
        category: ' Food ',
        description: 'Coffee',
        website: 'https://cafe.example',
        // mass-assignment attempts are ignored by construction
        ...({ isFeatured: true, userId: 'other', viewCount: 99 } as any),
      });
      expect(result).toEqual({
        userId: 'u1',
        type: 'BUSINESS',
        title: 'Cafe',
        category: 'Food',
        description: 'Coffee',
        location: undefined,
        website: 'https://cafe.example',
        contactInfo: undefined,
        priceRange: undefined,
        logoUrl: null,
        images: [],
      });
    });

    it.each([
      [{ category: 'c', description: 'd' }],
      [{ title: 't', description: 'd' }],
      [{ title: 't', category: 'c' }],
      [{ title: ' ', category: 'c', description: 'd' }],
      [{ title: 't', category: 'c', description: 'd', type: 'NOPE' }],
      [{ title: 't', category: 'c', description: 'd', website: 'javascript:alert(1)' }],
      [{ title: 't', category: 'c', description: 'd', website: 123 }],
    ])('rejects invalid input %j', async input => {
      await expect(marketplaceService.createListing('u1', input as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.marketplaceListing.create).not.toHaveBeenCalled();
    });

    it('accepts an empty website', async () => {
      prismaMock.marketplaceListing.create.mockResolvedValue(listing());
      await marketplaceService.createListing('u1', { title: 't', category: 'c', description: 'd', website: '', type: 'SERVICE' });
      expect(prismaMock.marketplaceListing.create.mock.calls[0][0].data.type).toBe('SERVICE');
    });
  });

  describe('updateListing', () => {
    it('lets the owner update whitelisted fields only', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      prismaMock.marketplaceListing.update.mockResolvedValue(listing());

      await marketplaceService.updateListing(owner, 'l1', {
        title: 'New',
        isActive: false,
        isFeatured: true,
        viewCount: 1e6,
        userId: 'u2',
        id: 'other',
      } as any);

      expect(prismaMock.marketplaceListing.update).toHaveBeenCalledWith({
        where: { id: 'l1' },
        data: { title: 'New', isActive: false },
      });
    });

    it('lets admins update any listing, including isFeatured, but never owner/viewCount', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      await marketplaceService.updateListing(admin, 'l1', { isFeatured: 'true', userId: 'x', viewCount: 0 } as any);
      expect(prismaMock.marketplaceListing.update.mock.calls[0][0].data).toEqual({ isFeatured: true });
    });

    it('coerces isActive strings', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      await marketplaceService.updateListing(owner, 'l1', { isActive: 'false' } as any);
      expect(prismaMock.marketplaceListing.update.mock.calls[0][0].data).toEqual({ isActive: false });
    });

    it("forbids updating someone else's listing", async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      await expect(marketplaceService.updateListing(stranger, 'l1', { title: 'x' })).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        marketplaceService.updateListing({ id: 'c1', userRole: 'CHAPTER_ADMIN' }, 'l1', { title: 'x' })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.marketplaceListing.update).not.toHaveBeenCalled();
    });

    it('validates changed fields', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      for (const bad of [{ title: '' }, { category: ' ' }, { description: '' }, { type: 'X' }, { website: 'ftp://x' }]) {
        await expect(marketplaceService.updateListing(owner, 'l1', bad as any)).rejects.toMatchObject({ statusCode: 400 });
      }
      expect(prismaMock.marketplaceListing.update).not.toHaveBeenCalled();
    });

    it('404s for unknown listings', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(null);
      await expect(marketplaceService.updateListing(owner, 'x', {})).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('deleteListing', () => {
    it('lets the owner delete', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      await expect(marketplaceService.deleteListing('u1', 'l1')).resolves.toEqual({ message: 'Listing deleted' });
      expect(prismaMock.marketplaceListing.delete).toHaveBeenCalledWith({ where: { id: 'l1' } });
    });

    it('lets admins delete any listing', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      await marketplaceService.deleteListing('a1', 'l1', true);
      expect(prismaMock.marketplaceListing.delete).toHaveBeenCalled();
    });

    it('forbids other members', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      await expect(marketplaceService.deleteListing('u2', 'l1')).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.marketplaceListing.delete).not.toHaveBeenCalled();
    });

    it('404s for unknown listings', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(null);
      await expect(marketplaceService.deleteListing('u1', 'x', true)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('getMyListings / getCategories / featureListing', () => {
    it("returns the caller's listings including inactive ones", async () => {
      prismaMock.marketplaceListing.findMany.mockResolvedValue([]);
      await marketplaceService.getMyListings('u1');
      expect(prismaMock.marketplaceListing.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns distinct categories of active listings with counts', async () => {
      prismaMock.marketplaceListing.groupBy.mockResolvedValue([
        { category: 'Food', _count: { category: 4 } },
        { category: 'Tech', _count: { category: 1 } },
      ]);
      await expect(marketplaceService.getCategories()).resolves.toEqual([
        { name: 'Food', count: 4 },
        { name: 'Tech', count: 1 },
      ]);
      const args = prismaMock.marketplaceListing.groupBy.mock.calls[0][0];
      expect(args.by).toEqual(['category']);
      expect(args.where).toEqual({ isActive: true });
    });

    it('features an existing listing and 404s otherwise', async () => {
      prismaMock.marketplaceListing.findUnique.mockResolvedValue(listing());
      await marketplaceService.featureListing('l1', true);
      expect(prismaMock.marketplaceListing.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { isFeatured: true } });

      prismaMock.marketplaceListing.findUnique.mockResolvedValue(null);
      await expect(marketplaceService.featureListing('x', true)).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
