import { landingService } from '../../services/landingService';
import { prismaMock } from '../../../tests/helpers';

describe('landingService', () => {
  describe('createBlock', () => {
    it('appends after the last block and defaults to published', async () => {
      prismaMock.landingBlock.findFirst.mockResolvedValue({ order: 4 });
      prismaMock.landingBlock.create.mockImplementation((args: any) => Promise.resolve({ id: 'b1', ...args.data }));
      const block = await landingService.createBlock({ type: 'HERO', config: { title: 'Welcome' } });
      expect(block).toMatchObject({ type: 'HERO', order: 5, isPublished: true });
    });
    it('rejects an unknown block type', async () => {
      await expect(landingService.createBlock({ type: 'MARQUEE', config: {} })).rejects.toMatchObject({ statusCode: 400 });
    });
    it('rejects a non-object config', async () => {
      await expect(landingService.createBlock({ type: 'TEXT', config: ['nope'] })).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('getBlocks', () => {
    it('filters to published for the public render', async () => {
      prismaMock.landingBlock.findMany.mockResolvedValue([]);
      await landingService.getBlocks(true);
      expect(prismaMock.landingBlock.findMany.mock.calls[0][0].where).toEqual({ isPublished: true });
    });
    it('returns everything for the admin editor', async () => {
      prismaMock.landingBlock.findMany.mockResolvedValue([]);
      await landingService.getBlocks(false);
      expect(prismaMock.landingBlock.findMany.mock.calls[0][0].where).toEqual({});
    });
  });

  describe('reorder', () => {
    it('writes order from the id array in one transaction', async () => {
      prismaMock.landingBlock.update.mockResolvedValue({});
      prismaMock.landingBlock.findMany.mockResolvedValue([]);
      await landingService.reorder(['x', 'y', 'z']);
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.landingBlock.update).toHaveBeenCalledWith({ where: { id: 'x' }, data: { order: 0 } });
      expect(prismaMock.landingBlock.update).toHaveBeenCalledWith({ where: { id: 'z' }, data: { order: 2 } });
    });
    it('rejects a non-array payload', async () => {
      await expect(landingService.reorder('nope')).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('updateBlock / deleteBlock', () => {
    it('404s an unknown block', async () => {
      prismaMock.landingBlock.findUnique.mockResolvedValue(null);
      await expect(landingService.updateBlock('missing', { config: {} })).rejects.toMatchObject({ statusCode: 404 });
      await expect(landingService.deleteBlock('missing')).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
