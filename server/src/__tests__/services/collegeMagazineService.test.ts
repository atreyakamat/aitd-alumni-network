jest.mock('../../services/broadcastService', () => ({ broadcastNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/storage', () => ({ deleteFromStorage: jest.fn().mockResolvedValue(undefined) }));

import { collegeMagazineService } from '../../services/collegeMagazineService';
import { broadcastNotification } from '../../services/broadcastService';
import { deleteFromStorage } from '../../utils/storage';
import { prismaMock } from '../../../tests/helpers';

const broadcast = broadcastNotification as jest.Mock;
const delStorage = deleteFromStorage as jest.Mock;

const magazine = (o: Record<string, unknown> = {}) => ({
  id: 'm1',
  title: 'Agnelite',
  edition: 'Vol 12 • 2026',
  fileUrl: '/uploads/magazines/m.pdf',
  coverImageUrl: '/uploads/magazine-covers/c.jpg',
  isPublished: true,
  uploadedById: 'admin1',
  ...o,
});

describe('collegeMagazineService', () => {
  beforeEach(() => {
    broadcast.mockClear();
    delStorage.mockClear();
  });

  describe('getMagazines', () => {
    beforeEach(() => {
      prismaMock.collegeMagazine.findMany.mockResolvedValue([]);
      prismaMock.collegeMagazine.count.mockResolvedValue(0);
    });

    it('returns published editions only by default', async () => {
      await collegeMagazineService.getMagazines({});
      expect(prismaMock.collegeMagazine.findMany.mock.calls[0][0].where).toEqual({ isPublished: true });
    });

    it('includes drafts when asked (admin)', async () => {
      await collegeMagazineService.getMagazines({ includeUnpublished: true });
      expect(prismaMock.collegeMagazine.findMany.mock.calls[0][0].where).toEqual({});
    });
  });

  describe('getMagazine', () => {
    it('404s an unpublished edition for the public', async () => {
      prismaMock.collegeMagazine.findUnique.mockResolvedValue(magazine({ isPublished: false }));
      await expect(collegeMagazineService.getMagazine('m1', false)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('shows an unpublished edition to an admin', async () => {
      prismaMock.collegeMagazine.findUnique.mockResolvedValue(magazine({ isPublished: false }));
      await expect(collegeMagazineService.getMagazine('m1', true)).resolves.toMatchObject({ id: 'm1' });
    });
  });

  describe('createMagazine', () => {
    it('requires a title and a PDF', async () => {
      await expect(collegeMagazineService.createMagazine('admin1', { title: '', fileUrl: '/m.pdf' } as any)).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(collegeMagazineService.createMagazine('admin1', { title: 'T' } as any)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('broadcasts when the new edition is published', async () => {
      prismaMock.collegeMagazine.create.mockResolvedValue(magazine({ isPublished: true }));
      await collegeMagazineService.createMagazine('admin1', { title: 'Agnelite', fileUrl: '/uploads/magazines/m.pdf' });
      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ excludeUserId: 'admin1', link: '/magazine' }));
    });
  });

  describe('deleteMagazine', () => {
    it('deletes the row and cleans up the PDF + cover', async () => {
      prismaMock.collegeMagazine.findUnique.mockResolvedValue(magazine());
      prismaMock.collegeMagazine.delete.mockResolvedValue({});
      await collegeMagazineService.deleteMagazine('m1');
      expect(prismaMock.collegeMagazine.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
      expect(delStorage).toHaveBeenCalledWith('/uploads/magazines/m.pdf');
      expect(delStorage).toHaveBeenCalledWith('/uploads/magazine-covers/c.jpg');
    });
  });
});
