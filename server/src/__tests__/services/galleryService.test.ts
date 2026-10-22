jest.mock('../../utils/storage', () => ({
  __esModule: true,
  deleteFromStorage: jest.fn().mockResolvedValue(undefined),
  uploadToStorage: jest.fn(),
}));

import { galleryService } from '../../services/galleryService';
import { deleteFromStorage } from '../../utils/storage';
import { prismaMock } from '../../../tests/helpers';

const member = { id: 'u1', userRole: 'MEMBER' as const };
const admin = { id: 'a1', userRole: 'ADMIN' as const };

const album = (overrides: Record<string, unknown> = {}) => ({
  id: 'al1',
  title: 'Album',
  albumType: 'BATCH',
  batchYear: 2015,
  eventId: null,
  isPublic: true,
  coverPhotoUrl: null,
  photoCount: 0,
  ...overrides,
});

const photo = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  albumId: 'al1',
  url: '/uploads/gallery/p1.jpg',
  thumbnailUrl: '/uploads/gallery/p1.jpg',
  uploadedById: 'u1',
  album: { id: 'al1', coverPhotoUrl: '/uploads/gallery/other.jpg' },
  ...overrides,
});

beforeEach(() => {
  (deleteFromStorage as jest.Mock).mockReset().mockResolvedValue(undefined);
});

describe('galleryService', () => {
  describe('getAlbums', () => {
    it('lists only public albums, paginated', async () => {
      prismaMock.galleryAlbum.findMany.mockResolvedValue([album()]);
      prismaMock.galleryAlbum.count.mockResolvedValue(25);

      const result = await galleryService.getAlbums(2, 12);

      const args = prismaMock.galleryAlbum.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ isPublic: true });
      expect(args.skip).toBe(12);
      expect(args.take).toBe(12);
      expect(prismaMock.galleryAlbum.count).toHaveBeenCalledWith({ where: { isPublic: true } });
      expect(result.pagination).toMatchObject({ page: 2, limit: 12, total: 25, totalPages: 3 });
    });

    it('filters by album type', async () => {
      prismaMock.galleryAlbum.findMany.mockResolvedValue([]);
      prismaMock.galleryAlbum.count.mockResolvedValue(0);
      await galleryService.getAlbums(1, 12, 'EVENT');
      expect(prismaMock.galleryAlbum.findMany.mock.calls[0][0].where).toEqual({ isPublic: true, albumType: 'EVENT' });
    });

    it('rejects an unknown album type', async () => {
      await expect(galleryService.getAlbums(1, 12, 'SECRET' as any)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('searches title and description server-side, trimmed and capped at 100 characters', async () => {
      prismaMock.galleryAlbum.findMany.mockResolvedValue([]);
      prismaMock.galleryAlbum.count.mockResolvedValue(0);

      await galleryService.getAlbums(1, 12, 'BATCH', `  ${'r'.repeat(120)} `);

      const where = prismaMock.galleryAlbum.findMany.mock.calls[0][0].where;
      const term = 'r'.repeat(100);
      expect(where).toEqual({
        isPublic: true,
        albumType: 'BATCH',
        OR: [{ title: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }],
      });
      expect(prismaMock.galleryAlbum.count).toHaveBeenCalledWith({ where });
    });

    it('ignores a blank search', async () => {
      prismaMock.galleryAlbum.findMany.mockResolvedValue([]);
      prismaMock.galleryAlbum.count.mockResolvedValue(0);
      await galleryService.getAlbums(1, 12, undefined, '   ');
      expect(prismaMock.galleryAlbum.findMany.mock.calls[0][0].where).toEqual({ isPublic: true });
    });

    it('normalises silly pagination values', async () => {
      prismaMock.galleryAlbum.findMany.mockResolvedValue([]);
      prismaMock.galleryAlbum.count.mockResolvedValue(0);
      const result = await galleryService.getAlbums(-3, 0);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getAlbum', () => {
    it('returns a public album to anyone', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album());
      await expect(galleryService.getAlbum('al1')).resolves.toMatchObject({ id: 'al1' });
    });

    it('hides a private album from anonymous viewers', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album({ isPublic: false }));
      await expect(galleryService.getAlbum('al1')).rejects.toMatchObject({ statusCode: 404 });
      await expect(galleryService.getAlbum('al1', null)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('shows a private album to signed-in members', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album({ isPublic: false }));
      await expect(galleryService.getAlbum('al1', member)).resolves.toMatchObject({ id: 'al1' });
    });

    it('404s for unknown albums', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(null);
      await expect(galleryService.getAlbum('x', admin)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('createAlbum', () => {
    it('creates an institutional, public album by default', async () => {
      prismaMock.galleryAlbum.create.mockResolvedValue(album());
      await galleryService.createAlbum({ title: '  Convocation  ' });
      expect(prismaMock.galleryAlbum.create.mock.calls[0][0].data).toMatchObject({
        title: 'Convocation',
        albumType: 'INSTITUTIONAL',
        isPublic: true,
      });
    });

    it('creates batch and event albums with their keys', async () => {
      prismaMock.galleryAlbum.create.mockResolvedValue(album());
      await galleryService.createAlbum({ title: 'B', albumType: 'BATCH', batchYear: 2015, isPublic: false });
      expect(prismaMock.galleryAlbum.create.mock.calls[0][0].data).toMatchObject({
        albumType: 'BATCH',
        batchYear: 2015,
        isPublic: false,
      });
      await galleryService.createAlbum({ title: 'E', albumType: 'EVENT', eventId: 'ev1' });
      expect(prismaMock.galleryAlbum.create.mock.calls[1][0].data).toMatchObject({ albumType: 'EVENT', eventId: 'ev1' });
    });

    it.each([
      [{ title: '' }],
      [{ title: '   ' }],
      [{}],
      [{ title: 'x', albumType: 'NOPE' }],
      [{ title: 'x', albumType: 'BATCH' }],
      [{ title: 'x', albumType: 'EVENT' }],
    ])('rejects invalid input %j', async input => {
      await expect(galleryService.createAlbum(input as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.galleryAlbum.create).not.toHaveBeenCalled();
    });
  });

  describe('updateAlbum', () => {
    it('applies only whitelisted fields', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album());
      prismaMock.galleryAlbum.update.mockResolvedValue(album());
      await galleryService.updateAlbum('al1', {
        title: 'New',
        isPublic: false,
        photoCount: 999,
        id: 'hijack',
        createdAt: new Date(0),
      } as any);
      expect(prismaMock.galleryAlbum.update).toHaveBeenCalledWith({
        where: { id: 'al1' },
        data: { title: 'New', isPublic: false },
      });
    });

    it('404s for unknown albums', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(null);
      await expect(galleryService.updateAlbum('x', { title: 'y' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects a blank title or bad type', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album());
      await expect(galleryService.updateAlbum('al1', { title: ' ' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(galleryService.updateAlbum('al1', { albumType: 'X' as any })).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.galleryAlbum.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteAlbum', () => {
    it('deletes photos and album together and removes stored files', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(
        album({
          photos: [
            { url: '/uploads/a.jpg', thumbnailUrl: '/uploads/a.jpg' },
            { url: '/uploads/b.jpg', thumbnailUrl: '/uploads/b-thumb.jpg' },
          ],
        })
      );

      const result = await galleryService.deleteAlbum('al1');

      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.galleryPhoto.deleteMany).toHaveBeenCalledWith({ where: { albumId: 'al1' } });
      expect(prismaMock.galleryAlbum.delete).toHaveBeenCalledWith({ where: { id: 'al1' } });
      expect(deleteFromStorage).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ message: 'Album deleted', photosDeleted: 2 });
    });

    it('still succeeds when storage cleanup fails', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album({ photos: [{ url: '/uploads/a.jpg', thumbnailUrl: null }] }));
      (deleteFromStorage as jest.Mock).mockRejectedValue(new Error('s3 down'));
      await expect(galleryService.deleteAlbum('al1')).resolves.toMatchObject({ photosDeleted: 1 });
    });

    it('404s for unknown albums', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(null);
      await expect(galleryService.deleteAlbum('x')).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.galleryAlbum.delete).not.toHaveBeenCalled();
    });
  });

  describe('assertCanAddPhoto / addPhoto', () => {
    it('lets a member add to their own batch album, increments count and sets cover', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album());
      prismaMock.user.findUnique.mockResolvedValue({ batchYear: 2015 });
      prismaMock.galleryPhoto.create.mockResolvedValue(photo());

      const result = await galleryService.addPhoto('al1', member, '/uploads/x.jpg', '/uploads/x-t.jpg', 'hi');

      expect(result).toMatchObject({ id: 'p1' });
      expect(prismaMock.galleryPhoto.create).toHaveBeenCalledWith({
        data: {
          albumId: 'al1',
          url: '/uploads/x.jpg',
          thumbnailUrl: '/uploads/x-t.jpg',
          caption: 'hi',
          uploadedById: 'u1',
        },
      });
      expect(prismaMock.galleryAlbum.update).toHaveBeenCalledWith({
        where: { id: 'al1' },
        data: { photoCount: { increment: 1 }, coverPhotoUrl: '/uploads/x.jpg' },
      });
    });

    it('keeps an existing cover photo', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album({ coverPhotoUrl: '/uploads/cover.jpg' }));
      prismaMock.user.findUnique.mockResolvedValue({ batchYear: 2015 });
      prismaMock.galleryPhoto.create.mockResolvedValue(photo());
      await galleryService.addPhoto('al1', member, '/uploads/x.jpg');
      expect(prismaMock.galleryAlbum.update.mock.calls[0][0].data.coverPhotoUrl).toBe('/uploads/cover.jpg');
    });

    it("forbids adding to another batch's album", async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album());
      prismaMock.user.findUnique.mockResolvedValue({ batchYear: 2016 });
      await expect(galleryService.addPhoto('al1', member, '/u.jpg')).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.galleryPhoto.create).not.toHaveBeenCalled();
    });

    it('forbids a batch album without a batch year, or an unknown user', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album({ batchYear: null }));
      prismaMock.user.findUnique.mockResolvedValue({ batchYear: 2015 });
      await expect(galleryService.assertCanAddPhoto('al1', member)).rejects.toMatchObject({ statusCode: 403 });

      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album());
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(galleryService.assertCanAddPhoto('al1', member)).rejects.toMatchObject({ statusCode: 403 });
    });

    it("lets a member who RSVP'd add to the event album", async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album({ albumType: 'EVENT', batchYear: null, eventId: 'ev1' }));
      prismaMock.eventRSVP.findUnique.mockResolvedValue({ id: 'r1' });
      await expect(galleryService.assertCanAddPhoto('al1', member)).resolves.toMatchObject({ id: 'al1' });
      expect(prismaMock.eventRSVP.findUnique).toHaveBeenCalledWith({
        where: { eventId_userId: { eventId: 'ev1', userId: 'u1' } },
      });
    });

    it("forbids event albums to members who didn't RSVP, or with no event", async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album({ albumType: 'EVENT', eventId: 'ev1' }));
      prismaMock.eventRSVP.findUnique.mockResolvedValue(null);
      await expect(galleryService.assertCanAddPhoto('al1', member)).rejects.toMatchObject({ statusCode: 403 });

      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album({ albumType: 'EVENT', eventId: null }));
      await expect(galleryService.assertCanAddPhoto('al1', member)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('forbids members from institutional albums', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album({ albumType: 'INSTITUTIONAL' }));
      await expect(galleryService.assertCanAddPhoto('al1', member)).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        galleryService.assertCanAddPhoto('al1', { id: 'c1', userRole: 'CHAPTER_ADMIN' })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('lets admins add to any album, including institutional', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(album({ albumType: 'INSTITUTIONAL' }));
      prismaMock.galleryPhoto.create.mockResolvedValue(photo({ uploadedById: 'a1' }));
      await galleryService.addPhoto('al1', admin, '/u.jpg');
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.galleryPhoto.create.mock.calls[0][0].data.uploadedById).toBe('a1');
    });

    it('404s for unknown albums', async () => {
      prismaMock.galleryAlbum.findUnique.mockResolvedValue(null);
      await expect(galleryService.addPhoto('x', admin, '/u.jpg')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('requires an album id and a url', async () => {
      await expect(galleryService.addPhoto('', admin, '/u.jpg')).rejects.toMatchObject({ statusCode: 400 });
      await expect(galleryService.addPhoto('al1', admin, '')).rejects.toMatchObject({ statusCode: 400 });
      await expect(galleryService.addPhoto('al1', admin, undefined as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.galleryAlbum.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('deletePhoto / userDeletePhoto', () => {
    it('lets the uploader delete their photo; count is decremented with a >0 guard', async () => {
      prismaMock.galleryPhoto.findUnique.mockResolvedValue(photo());

      await expect(galleryService.userDeletePhoto('p1', member)).resolves.toEqual({ message: 'Photo deleted' });

      expect(prismaMock.galleryPhoto.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
      expect(prismaMock.galleryAlbum.updateMany).toHaveBeenCalledWith({
        where: { id: 'al1', photoCount: { gt: 0 } },
        data: { photoCount: { decrement: 1 } },
      });
      // not the cover -> cover untouched
      expect(prismaMock.galleryAlbum.update).not.toHaveBeenCalled();
      expect(deleteFromStorage).toHaveBeenCalledTimes(1);
      expect(deleteFromStorage).toHaveBeenCalledWith('/uploads/gallery/p1.jpg');
    });

    it("forbids deleting someone else's photo", async () => {
      prismaMock.galleryPhoto.findUnique.mockResolvedValue(photo({ uploadedById: 'other' }));
      await expect(galleryService.userDeletePhoto('p1', member)).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.galleryPhoto.delete).not.toHaveBeenCalled();
      expect(prismaMock.galleryAlbum.updateMany).not.toHaveBeenCalled();
    });

    it("lets admins delete anyone's photo", async () => {
      prismaMock.galleryPhoto.findUnique.mockResolvedValue(photo({ uploadedById: 'other' }));
      await galleryService.userDeletePhoto('p1', admin);
      await galleryService.deletePhoto('p1', { id: 's', userRole: 'SUPER_ADMIN' });
      await galleryService.deletePhoto('p1');
      expect(prismaMock.galleryPhoto.delete).toHaveBeenCalledTimes(3);
    });

    it('resets the album cover when the cover photo is deleted', async () => {
      prismaMock.galleryPhoto.findUnique.mockResolvedValue(
        photo({ album: { id: 'al1', coverPhotoUrl: '/uploads/gallery/p1.jpg' } })
      );
      prismaMock.galleryPhoto.findFirst.mockResolvedValue({ url: '/uploads/gallery/p0.jpg' });
      await galleryService.deletePhoto('p1', member);
      expect(prismaMock.galleryAlbum.update).toHaveBeenCalledWith({
        where: { id: 'al1' },
        data: { coverPhotoUrl: '/uploads/gallery/p0.jpg' },
      });
    });

    it('clears the cover when the last photo is deleted', async () => {
      prismaMock.galleryPhoto.findUnique.mockResolvedValue(
        photo({ album: { id: 'al1', coverPhotoUrl: '/uploads/gallery/p1.jpg' } })
      );
      prismaMock.galleryPhoto.findFirst.mockResolvedValue(null);
      await galleryService.deletePhoto('p1', member);
      expect(prismaMock.galleryAlbum.update.mock.calls[0][0].data).toEqual({ coverPhotoUrl: null });
    });

    it('404s for unknown photos', async () => {
      prismaMock.galleryPhoto.findUnique.mockResolvedValue(null);
      await expect(galleryService.userDeletePhoto('x', member)).rejects.toMatchObject({ statusCode: 404 });
      await expect(galleryService.deletePhoto('x')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('does not fail when storage removal fails', async () => {
      prismaMock.galleryPhoto.findUnique.mockResolvedValue(photo({ thumbnailUrl: '/t.jpg' }));
      (deleteFromStorage as jest.Mock).mockRejectedValue(new Error('gone'));
      await expect(galleryService.deletePhoto('p1', member)).resolves.toEqual({ message: 'Photo deleted' });
      expect(deleteFromStorage).toHaveBeenCalledTimes(2);
    });
  });

  describe('getRecentPhotos', () => {
    it('returns photos from public albums only', async () => {
      prismaMock.galleryPhoto.findMany.mockResolvedValue([]);
      await galleryService.getRecentPhotos(4);
      const args = prismaMock.galleryPhoto.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ album: { isPublic: true } });
      expect(args.take).toBe(4);
    });

    it('caps and normalises the limit', async () => {
      prismaMock.galleryPhoto.findMany.mockResolvedValue([]);
      await galleryService.getRecentPhotos(10_000);
      await galleryService.getRecentPhotos(NaN);
      await galleryService.getRecentPhotos(0);
      await galleryService.getRecentPhotos();
      const takes = prismaMock.galleryPhoto.findMany.mock.calls.map((c: any[]) => c[0].take);
      expect(takes).toEqual([50, 8, 1, 8]);
    });
  });
});
