jest.mock('../../utils/storage', () => ({
  __esModule: true,
  uploadToStorage: jest.fn(),
  deleteFromStorage: jest.fn().mockResolvedValue(undefined),
  upload: { array: () => (_req: any, _res: any, next: any) => next(), single: () => (_req: any, _res: any, next: any) => next() },
  uploadBufferToStorage: jest.fn(),
}));

import {
  galleryController,
  newsController,
  chapterController,
  marketplaceController,
} from '../../controllers/contentController';
import { galleryService } from '../../services/galleryService';
import { newsService } from '../../services/newsService';
import { chapterService } from '../../services/chapterService';
import { marketplaceService } from '../../services/marketplaceService';
import { uploadToStorage } from '../../utils/storage';
import { mockReqRes, prismaMock, api, authAs, getApp } from '../../../tests/helpers';

const member = { id: 'u1', email: 'u1@aitd.test', fullName: 'U1', userRole: 'MEMBER' as const };
const admin = { id: 'a1', email: 'a1@aitd.test', fullName: 'A1', userRole: 'ADMIN' as const };
const memberActor = { id: 'u1', userRole: 'MEMBER' };
const adminActor = { id: 'a1', userRole: 'ADMIN' };

afterEach(() => {
  jest.restoreAllMocks();
  // keep console quiet again after restoreAllMocks
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

type Case = {
  name: string;
  handler: (req: any, res: any, next: any) => Promise<unknown>;
  service: any;
  method: string;
  req: Record<string, unknown>;
  args: unknown[];
  status?: number;
  spread?: boolean;
};

const ok = { foo: 'bar' };
const paged = { data: [1], pagination: { page: 1 } };

const cases: Case[] = [
  // Gallery
  { name: 'gallery.getAlbums', handler: (...a) => galleryController.getAlbums(...a), service: galleryService, method: 'getAlbums', req: { query: { page: '2', limit: '5', type: 'BATCH', search: ' reunion ' } }, args: [2, 5, 'BATCH', 'reunion'], spread: true },
  { name: 'gallery.getAlbums defaults', handler: (...a) => galleryController.getAlbums(...a), service: galleryService, method: 'getAlbums', req: { query: { page: 'x', search: ['a', 'b'] } }, args: [1, 12, undefined, undefined], spread: true },
  { name: 'gallery.getAlbum anon', handler: (...a) => galleryController.getAlbum(...a), service: galleryService, method: 'getAlbum', req: { params: { id: 'al1' } }, args: ['al1', null] },
  { name: 'gallery.getAlbum member', handler: (...a) => galleryController.getAlbum(...a), service: galleryService, method: 'getAlbum', req: { params: { id: 'al1' }, user: member }, args: ['al1', memberActor] },
  { name: 'gallery.createAlbum', handler: (...a) => galleryController.createAlbum(...a), service: galleryService, method: 'createAlbum', req: { body: { title: 't' }, user: admin }, args: [{ title: 't' }], status: 201 },
  { name: 'gallery.updateAlbum', handler: (...a) => galleryController.updateAlbum(...a), service: galleryService, method: 'updateAlbum', req: { params: { id: 'al1' }, body: { title: 't' }, user: admin }, args: ['al1', { title: 't' }] },
  { name: 'gallery.deleteAlbum', handler: (...a) => galleryController.deleteAlbum(...a), service: galleryService, method: 'deleteAlbum', req: { params: { id: 'al1' }, user: admin }, args: ['al1'] },
  { name: 'gallery.addPhoto (albumId in body)', handler: (...a) => galleryController.addPhoto(...a), service: galleryService, method: 'addPhoto', req: { body: { albumId: 'al1', url: '/u.jpg', thumbnailUrl: '/t.jpg', caption: 'c' }, user: admin }, args: ['al1', adminActor, '/u.jpg', '/t.jpg', 'c'], status: 201 },
  { name: 'gallery.addPhoto (albumId in params)', handler: (...a) => galleryController.addPhoto(...a), service: galleryService, method: 'addPhoto', req: { params: { albumId: 'al2' }, body: { url: '/u.jpg' }, user: admin }, args: ['al2', adminActor, '/u.jpg', undefined, undefined], status: 201 },
  { name: 'gallery.deletePhoto', handler: (...a) => galleryController.deletePhoto(...a), service: galleryService, method: 'deletePhoto', req: { params: { id: 'p1' }, user: admin }, args: ['p1', adminActor] },
  { name: 'gallery.userDeletePhoto', handler: (...a) => galleryController.userDeletePhoto(...a), service: galleryService, method: 'userDeletePhoto', req: { params: { id: 'p1' }, user: member }, args: ['p1', memberActor] },
  { name: 'gallery.getRecentPhotos', handler: (...a) => galleryController.getRecentPhotos(...a), service: galleryService, method: 'getRecentPhotos', req: { query: { limit: '3' } }, args: [3] },
  { name: 'gallery.getRecentPhotos default', handler: (...a) => galleryController.getRecentPhotos(...a), service: galleryService, method: 'getRecentPhotos', req: {}, args: [8] },
  // News
  { name: 'news.getArticles', handler: (...a) => newsController.getArticles(...a), service: newsService, method: 'getArticles', req: { query: { page: '2', limit: '4', category: 'ALUMNI_STORY', status: 'DRAFT', authorId: 'x', search: ' gala ' } }, args: [{ category: 'ALUMNI_STORY', status: 'DRAFT', search: 'gala', page: 2, limit: 4 }, null], spread: true },
  { name: 'news.getArticles admin defaults', handler: (...a) => newsController.getArticles(...a), service: newsService, method: 'getArticles', req: { user: admin }, args: [{ category: undefined, status: undefined, search: undefined, page: 1, limit: 12 }, adminActor], spread: true },
  { name: 'news.getArticle', handler: (...a) => newsController.getArticle(...a), service: newsService, method: 'getArticle', req: { params: { slug: 's' } }, args: ['s', null] },
  { name: 'news.createArticle', handler: (...a) => newsController.createArticle(...a), service: newsService, method: 'createArticle', req: { body: { title: 't' }, user: admin }, args: ['a1', { title: 't' }], status: 201 },
  { name: 'news.updateArticle', handler: (...a) => newsController.updateArticle(...a), service: newsService, method: 'updateArticle', req: { params: { id: 'n1' }, body: { title: 't' }, user: admin }, args: ['n1', { title: 't' }] },
  { name: 'news.publishArticle', handler: (...a) => newsController.publishArticle(...a), service: newsService, method: 'publishArticle', req: { params: { id: 'n1' }, user: admin }, args: ['n1'] },
  { name: 'news.unpublishArticle', handler: (...a) => newsController.unpublishArticle(...a), service: newsService, method: 'unpublishArticle', req: { params: { id: 'n1' }, user: admin }, args: ['n1'] },
  { name: 'news.deleteArticle', handler: (...a) => newsController.deleteArticle(...a), service: newsService, method: 'deleteArticle', req: { params: { id: 'n1' }, user: admin }, args: ['n1'] },
  { name: 'news.getLatestNews', handler: (...a) => newsController.getLatestNews(...a), service: newsService, method: 'getLatestNews', req: { query: { limit: '2' } }, args: [2] },
  { name: 'news.getLatestNews default', handler: (...a) => newsController.getLatestNews(...a), service: newsService, method: 'getLatestNews', req: {}, args: [5] },
  // Chapters
  { name: 'chapter.getChapters', handler: (...a) => chapterController.getChapters(...a), service: chapterService, method: 'getChapters', req: { query: { page: '3' } }, args: [3, 20, { search: undefined, region: undefined }], spread: true },
  { name: 'chapter.getChapters filters', handler: (...a) => chapterController.getChapters(...a), service: chapterService, method: 'getChapters', req: { query: { search: ' pune ', region: 'West' } }, args: [1, 20, { search: 'pune', region: 'West' }], spread: true },
  { name: 'chapter.getChapter', handler: (...a) => chapterController.getChapter(...a), service: chapterService, method: 'getChapter', req: { params: { id: 'c1' } }, args: ['c1'] },
  { name: 'chapter.createChapter', handler: (...a) => chapterController.createChapter(...a), service: chapterService, method: 'createChapter', req: { body: { name: 'n' }, user: admin }, args: [{ name: 'n' }], status: 201 },
  { name: 'chapter.updateChapter', handler: (...a) => chapterController.updateChapter(...a), service: chapterService, method: 'updateChapter', req: { params: { id: 'c1' }, body: { name: 'n' }, user: member }, args: [memberActor, 'c1', { name: 'n' }] },
  { name: 'chapter.deleteChapter', handler: (...a) => chapterController.deleteChapter(...a), service: chapterService, method: 'deleteChapter', req: { params: { id: 'c1' }, user: admin }, args: ['c1'] },
  { name: 'chapter.joinChapter', handler: (...a) => chapterController.joinChapter(...a), service: chapterService, method: 'joinChapter', req: { params: { id: 'c1' }, user: member }, args: ['u1', 'c1'] },
  { name: 'chapter.leaveChapter', handler: (...a) => chapterController.leaveChapter(...a), service: chapterService, method: 'leaveChapter', req: { params: { id: 'c1' }, user: member }, args: ['u1', 'c1'] },
  { name: 'chapter.getChapterMembers', handler: (...a) => chapterController.getChapterMembers(...a), service: chapterService, method: 'getChapterMembers', req: { params: { id: 'c1' }, query: { page: '2', limit: '10' }, user: member }, args: ['c1', 2, 10], spread: true },
  { name: 'chapter.getUserChapters', handler: (...a) => chapterController.getUserChapters(...a), service: chapterService, method: 'getUserChapters', req: { user: member }, args: ['u1'] },
  // Marketplace
  { name: 'market.getListings', handler: (...a) => marketplaceController.getListings(...a), service: marketplaceService, method: 'getListings', req: { query: { type: 'SERVICE', category: 'Food', location: ' Pune ', search: 'x', page: '2', limit: '6', isActive: 'false', userId: 'u9' } }, args: [{ type: 'SERVICE', category: 'Food', location: 'Pune', search: 'x', page: 2, limit: 6 }], spread: true },
  { name: 'market.getListing', handler: (...a) => marketplaceController.getListing(...a), service: marketplaceService, method: 'getListing', req: { params: { id: 'l1' }, user: member }, args: ['l1', memberActor] },
  { name: 'market.createListing', handler: (...a) => marketplaceController.createListing(...a), service: marketplaceService, method: 'createListing', req: { body: { title: 't' }, user: member }, args: ['u1', { title: 't' }], status: 201 },
  { name: 'market.updateListing', handler: (...a) => marketplaceController.updateListing(...a), service: marketplaceService, method: 'updateListing', req: { params: { id: 'l1' }, body: { title: 't' }, user: member }, args: [memberActor, 'l1', { title: 't' }] },
  { name: 'market.deleteListing member', handler: (...a) => marketplaceController.deleteListing(...a), service: marketplaceService, method: 'deleteListing', req: { params: { id: 'l1' }, user: member }, args: ['u1', 'l1', false] },
  { name: 'market.deleteListing admin', handler: (...a) => marketplaceController.deleteListing(...a), service: marketplaceService, method: 'deleteListing', req: { params: { id: 'l1' }, user: admin }, args: ['a1', 'l1', true] },
  { name: 'market.getMyListings', handler: (...a) => marketplaceController.getMyListings(...a), service: marketplaceService, method: 'getMyListings', req: { user: member }, args: ['u1'] },
  { name: 'market.getCategories', handler: (...a) => marketplaceController.getCategories(...a), service: marketplaceService, method: 'getCategories', req: {}, args: [] },
];

describe('content controllers (unit)', () => {
  describe.each(cases)('$name', c => {
    it('passes the right arguments and responds', async () => {
      const spy = jest.spyOn(c.service, c.method).mockResolvedValue(c.spread ? paged : ok);
      const { req, res, next } = mockReqRes(c.req);

      await c.handler(req, res, next);

      expect(spy).toHaveBeenCalledWith(...c.args);
      expect(next).not.toHaveBeenCalled();
      if (c.status) expect(res.status).toHaveBeenCalledWith(c.status);
      else expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(c.spread ? { success: true, ...paged } : { success: true, data: ok });
    });

    it('forwards service errors to next()', async () => {
      const err = Object.assign(new Error('boom'), { statusCode: 418 });
      jest.spyOn(c.service, c.method).mockRejectedValue(err);
      const { req, res, next } = mockReqRes(c.req);

      await c.handler(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('gallery.userAddPhoto', () => {
    const file = (name: string) => ({ originalname: name } as any);

    it('400s when no files are uploaded', async () => {
      const { req, res, next } = mockReqRes({ params: { albumId: 'al1' }, user: member });
      await galleryController.userAddPhoto(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      const r2 = mockReqRes({ params: { albumId: 'al1' }, user: member, files: [] });
      await galleryController.userAddPhoto(r2.req, r2.res, r2.next);
      expect(r2.res.status).toHaveBeenCalledWith(400);
    });

    it('checks permission before uploading anything', async () => {
      const err = Object.assign(new Error('nope'), { statusCode: 403 });
      jest.spyOn(galleryService, 'assertCanAddPhoto').mockRejectedValue(err);
      const { req, res, next } = mockReqRes({ params: { albumId: 'al1' }, user: member, files: [file('a')] });

      await galleryController.userAddPhoto(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(uploadToStorage).not.toHaveBeenCalled();
    });

    it('uploads each file and records it as the caller', async () => {
      jest.spyOn(galleryService, 'assertCanAddPhoto').mockResolvedValue({} as any);
      const add = jest.spyOn(galleryService, 'addPhoto').mockImplementation(async (_a, _u, url) => ({ url } as any));
      (uploadToStorage as jest.Mock).mockReset().mockResolvedValueOnce('/up/1.jpg').mockResolvedValueOnce('/up/2.jpg');
      const { req, res, next } = mockReqRes({
        params: { albumId: 'al1' },
        user: member,
        files: [file('a'), file('b')],
        body: { caption: 'reunion' },
      });

      await galleryController.userAddPhoto(req, res, next);

      expect(uploadToStorage).toHaveBeenCalledTimes(2);
      expect(uploadToStorage).toHaveBeenCalledWith(expect.anything(), 'gallery');
      expect(add).toHaveBeenNthCalledWith(1, 'al1', memberActor, '/up/1.jpg', '/up/1.jpg', 'reunion');
      expect(add).toHaveBeenNthCalledWith(2, 'al1', memberActor, '/up/2.jpg', '/up/2.jpg', 'reunion');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ url: '/up/1.jpg' }, { url: '/up/2.jpg' }] });
    });
  });
});

describe('content routes (HTTP)', () => {
  // Building the Express app is slow on a cold, heavily parallel run
  beforeAll(() => {
    getApp();
  }, 120000);

  it('GET /api/news ignores ?status=DRAFT from anonymous callers', async () => {
    prismaMock.newsArticle.findMany.mockResolvedValue([]);
    prismaMock.newsArticle.count.mockResolvedValue(0);
    const res = await api().get('/api/news?status=DRAFT');
    expect(res.status).toBe(200);
    expect(prismaMock.newsArticle.findMany.mock.calls[0][0].where.status).toBe('PUBLISHED');
  });

  it('GET /api/news/:slug of a draft is 404', async () => {
    prismaMock.newsArticle.findFirst.mockResolvedValue(null);
    const res = await api().get('/api/news/some-draft');
    expect(res.status).toBe(404);
  });

  it('GET /api/gallery/albums/:id of a private album is 404 anonymously', async () => {
    prismaMock.galleryAlbum.findUnique.mockResolvedValue({ id: 'al1', isPublic: false });
    const res = await api().get('/api/gallery/albums/al1');
    expect(res.status).toBe(404);
  });

  it('POST /api/chapters/:id/join twice is 409', async () => {
    const { header } = authAs('MEMBER');
    prismaMock.chapter.findUnique.mockResolvedValue({ id: 'c1', isActive: true });
    prismaMock.chapterMembership.findUnique.mockResolvedValue({ id: 'm1' });
    const res = await api().post('/api/chapters/c1/join').set('Authorization', header);
    expect(res.status).toBe(409);
  });

  it('PATCH /api/marketplace/:id by a non-owner is 403', async () => {
    const { header } = authAs('MEMBER');
    prismaMock.marketplaceListing.findUnique.mockResolvedValue({ id: 'l1', userId: 'someone-else' });
    const res = await api().patch('/api/marketplace/l1').set('Authorization', header).send({ title: 'New title' });
    expect(res.status).toBe(403);
    expect(prismaMock.marketplaceListing.update).not.toHaveBeenCalled();
  });

  describe('marketplace listing validation', () => {
    const validListing = {
      type: 'SERVICE',
      title: '  Tax filing help  ',
      category: ' Finance ',
      description: 'Personal and small-business tax filing by an alum CA.',
      location: 'Pune',
      website: 'https://tax.example.com',
      contactInfo: 'tax@example.com',
      priceRange: 'From INR 1,500',
    };

    it('POST /api/marketplace creates a listing from the validated body only (no mass assignment)', async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.marketplaceListing.create.mockImplementation((async (a: any) => ({ id: 'l1', ...a.data })) as any);
      const res = await api()
        .post('/api/marketplace')
        .set('Authorization', header)
        .send({ ...validListing, userId: 'someone-else', viewCount: 999, isFeatured: true, isActive: false });
      expect(res.status).toBe(201);
      const data = prismaMock.marketplaceListing.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ userId: user.id, type: 'SERVICE', title: 'Tax filing help', category: 'Finance' });
      expect(data).not.toHaveProperty('viewCount');
      expect(data).not.toHaveProperty('isFeatured');
      expect(data).not.toHaveProperty('isActive');
    });

    it('POST /api/marketplace stores blank optional fields as null', async () => {
      const { header } = authAs('MEMBER');
      prismaMock.marketplaceListing.create.mockImplementation((async (a: any) => ({ id: 'l1', ...a.data })) as any);
      const res = await api()
        .post('/api/marketplace')
        .set('Authorization', header)
        .send({ ...validListing, website: '', location: '  ', contactInfo: '', priceRange: '' });
      expect(res.status).toBe(201);
      expect(prismaMock.marketplaceListing.create.mock.calls[0][0].data).toMatchObject({
        website: null,
        location: null,
        contactInfo: null,
        priceRange: null,
      });
    });

    it.each([
      ['missing title', { title: undefined }],
      ['short title', { title: 'ab' }],
      ['long title', { title: 'x'.repeat(151) }],
      ['missing category', { category: '' }],
      ['short description', { description: 'too short' }],
      ['long description', { description: 'x'.repeat(5001) }],
      ['unknown type', { type: 'WEAPONS' }],
      ['javascript website', { website: 'javascript:alert(1)' }],
      ['ftp website', { website: 'ftp://files.example.com' }],
      ['long contact info', { contactInfo: 'x'.repeat(201) }],
      ['long price range', { priceRange: 'x'.repeat(101) }],
      ['non-string title', { title: 42 }],
    ])('POST /api/marketplace rejects %s with 400', async (_label, override) => {
      const { header } = authAs('MEMBER');
      const res = await api()
        .post('/api/marketplace')
        .set('Authorization', header)
        .send({ ...validListing, ...override });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(prismaMock.marketplaceListing.create).not.toHaveBeenCalled();
    });

    it('PATCH /api/marketplace/:id lets the owner pause a listing but strips server-controlled fields', async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.marketplaceListing.findUnique.mockResolvedValue({ id: 'l1', userId: user.id } as any);
      prismaMock.marketplaceListing.update.mockResolvedValue({ id: 'l1' } as any);
      const res = await api()
        .patch('/api/marketplace/l1')
        .set('Authorization', header)
        .send({ isActive: false, title: ' Renamed listing ', userId: 'x', viewCount: 0, isFeatured: true });
      expect(res.status).toBe(200);
      expect(prismaMock.marketplaceListing.update).toHaveBeenCalledWith({
        where: { id: 'l1' },
        data: { isActive: false, title: 'Renamed listing' },
      });
    });

    it.each([
      ['blank title', { title: '   ' }],
      ['bad website', { website: 'notaurl' }],
      ['string isActive', { isActive: 'nope' }],
      ['unknown type', { type: 'X' }],
    ])('PATCH /api/marketplace/:id rejects %s with 400', async (_label, body) => {
      const { header, user } = authAs('MEMBER');
      prismaMock.marketplaceListing.findUnique.mockResolvedValue({ id: 'l1', userId: user.id } as any);
      const res = await api().patch('/api/marketplace/l1').set('Authorization', header).send(body);
      expect(res.status).toBe(400);
      expect(prismaMock.marketplaceListing.update).not.toHaveBeenCalled();
    });

    it('DELETE /api/marketplace/:id by a non-owner member is 403', async () => {
      const { header } = authAs('MEMBER');
      prismaMock.marketplaceListing.findUnique.mockResolvedValue({ id: 'l1', userId: 'someone-else' } as any);
      const res = await api().delete('/api/marketplace/l1').set('Authorization', header);
      expect(res.status).toBe(403);
      expect(prismaMock.marketplaceListing.delete).not.toHaveBeenCalled();
    });
  });

  it('GET /api/gallery/albums passes the search term to the database query', async () => {
    prismaMock.galleryAlbum.findMany.mockResolvedValue([]);
    prismaMock.galleryAlbum.count.mockResolvedValue(0);
    const res = await api().get('/api/gallery/albums?search=%20reunion%20&page=2&limit=6');
    expect(res.status).toBe(200);
    const args = prismaMock.galleryAlbum.findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([{ title: { contains: 'reunion', mode: 'insensitive' } }, { description: { contains: 'reunion', mode: 'insensitive' } }]);
    expect(args.skip).toBe(6);
    expect(res.body.pagination).toMatchObject({ page: 2, limit: 6 });
  });

  it('POST /api/gallery/photos/admin uses albumId from the body', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.galleryAlbum.findUnique.mockResolvedValue({ id: 'al1', albumType: 'INSTITUTIONAL', coverPhotoUrl: null });
    prismaMock.galleryPhoto.create.mockResolvedValue({ id: 'p1' });
    const res = await api()
      .post('/api/gallery/photos/admin')
      .set('Authorization', header)
      .send({ albumId: 'al1', url: 'https://cdn.example/p.jpg' });
    expect(res.status).toBe(201);
    expect(prismaMock.galleryPhoto.create.mock.calls[0][0].data.albumId).toBe('al1');
  });
});
