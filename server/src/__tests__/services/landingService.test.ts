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

    describe('links and images in a block (rendered for every visitor, so only safe targets are stored)', () => {
      beforeEach(() => {
        prismaMock.landingBlock.findFirst.mockResolvedValue(null);
        prismaMock.landingBlock.create.mockImplementation((args: any) => Promise.resolve({ id: 'b1', ...args.data }));
      });

      it.each([
        ['a site path', { ctaHref: '/register' }],
        ['an https link', { buttonHref: 'https://example.edu/apply' }],
        ['no link at all', { ctaHref: '' }],
        ['an uploaded image', { imageUrl: '/uploads/landing/hero.png' }],
        ['an https image', { imageUrl: 'https://cdn.example.edu/hero.png' }],
      ])('accepts %s', async (_label, config) => {
        await expect(landingService.createBlock({ type: 'CTA', config })).resolves.toBeDefined();
      });

      it.each([
        ['a javascript: link', { ctaHref: 'javascript:alert(1)' }],
        ['a data: link', { buttonHref: 'data:text/html,<script>alert(1)</script>' }],
        ['a protocol-relative link', { ctaHref: '//evil.example/x' }],
        ['a backslash link', { ctaHref: '/\\evil.example' }],
        ['a link with credentials', { buttonHref: 'https://good.example@evil.example/' }],
        ['a link with a space', { ctaHref: '/a b' }],
        ['a non-string link', { ctaHref: { toString: 'x' } }],
        ['a javascript: image', { imageUrl: 'javascript:alert(1)' }],
        ['an image outside uploads', { imageUrl: '/etc/passwd' }],
      ])('rejects %s', async (_label, config) => {
        await expect(landingService.createBlock({ type: 'CTA', config })).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
        expect(prismaMock.landingBlock.create).not.toHaveBeenCalled();
      });

      it('applies the same checks when a block is updated', async () => {
        prismaMock.landingBlock.findUnique.mockResolvedValue({ id: 'b1' });
        await expect(landingService.updateBlock('b1', { config: { ctaHref: 'javascript:alert(1)' } })).rejects.toMatchObject({ statusCode: 400 });
        expect(prismaMock.landingBlock.update).not.toHaveBeenCalled();
      });
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
