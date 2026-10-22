import { newsService } from '../../services/newsService';
import { prismaMock } from '../../../tests/helpers';

const admin = { id: 'a1', userRole: 'ADMIN' as const };
const member = { id: 'u1', userRole: 'MEMBER' as const };

const article = (overrides: Record<string, unknown> = {}) => ({
  id: 'n1',
  title: 'Hello World',
  slug: 'hello-world',
  content: 'body',
  status: 'PUBLISHED',
  category: 'ALUMNI_STORY',
  viewCount: 4,
  publishedAt: new Date('2026-01-01'),
  ...overrides,
});

describe('newsService', () => {
  describe('getArticles', () => {
    beforeEach(() => {
      prismaMock.newsArticle.findMany.mockResolvedValue([article()]);
      prismaMock.newsArticle.count.mockResolvedValue(30);
    });

    it('lists only published articles publicly, newest first, paginated', async () => {
      const result = await newsService.getArticles({ page: 3, limit: 10 });
      const args = prismaMock.newsArticle.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ status: 'PUBLISHED' });
      expect(args.orderBy).toEqual({ publishedAt: 'desc' });
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
      expect(result.pagination).toMatchObject({ page: 3, limit: 10, total: 30, totalPages: 3 });
    });

    it('ignores a status filter from anonymous users and members', async () => {
      await newsService.getArticles({ status: 'DRAFT' });
      await newsService.getArticles({ status: 'DRAFT' }, member);
      for (const call of prismaMock.newsArticle.findMany.mock.calls) {
        expect(call[0].where.status).toBe('PUBLISHED');
      }
    });

    it('honours a status filter for admins', async () => {
      await newsService.getArticles({ status: 'DRAFT' }, admin);
      const args = prismaMock.newsArticle.findMany.mock.calls[0][0];
      expect(args.where.status).toBe('DRAFT');
      expect(args.orderBy).toEqual({ updatedAt: 'desc' });
    });

    it('rejects an invalid status from admins', async () => {
      await expect(newsService.getArticles({ status: 'BOGUS' as any }, admin)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('filters by category and rejects unknown categories', async () => {
      await newsService.getArticles({ category: 'ALUMNI_STORY' });
      expect(prismaMock.newsArticle.findMany.mock.calls[0][0].where).toEqual({ status: 'PUBLISHED', category: 'ALUMNI_STORY' });
      await expect(newsService.getArticles({ category: 'GOSSIP' as any })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('works with no filters at all', async () => {
      await newsService.getArticles();
      expect(prismaMock.newsArticle.findMany).toHaveBeenCalled();
    });

    it('searches title, excerpt and content with a trimmed term (count uses the same filter)', async () => {
      await newsService.getArticles({ search: '  reunion ', category: 'ALUMNI_STORY' });
      const where = prismaMock.newsArticle.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        status: 'PUBLISHED',
        category: 'ALUMNI_STORY',
        OR: [
          { title: { contains: 'reunion', mode: 'insensitive' } },
          { excerpt: { contains: 'reunion', mode: 'insensitive' } },
          { content: { contains: 'reunion', mode: 'insensitive' } },
        ],
      });
      expect(prismaMock.newsArticle.count).toHaveBeenCalledWith({ where });
    });

    it('caps the search term at 100 characters and ignores blank terms', async () => {
      await newsService.getArticles({ search: 'x'.repeat(250) });
      const where = prismaMock.newsArticle.findMany.mock.calls[0][0].where;
      expect(where.OR[0].title.contains).toHaveLength(100);

      await newsService.getArticles({ search: '   ' });
      expect(prismaMock.newsArticle.findMany.mock.calls[1][0].where).toEqual({ status: 'PUBLISHED' });
    });
  });

  describe('getArticle', () => {
    it('returns a published article by slug and increments the view count', async () => {
      prismaMock.newsArticle.findFirst.mockResolvedValue(article());

      const result = await newsService.getArticle('hello-world');

      const args = prismaMock.newsArticle.findFirst.mock.calls[0][0];
      expect(args.where).toEqual({ OR: [{ slug: 'hello-world' }, { id: 'hello-world' }], status: 'PUBLISHED' });
      expect(prismaMock.newsArticle.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { viewCount: { increment: 1 } },
      });
      expect(result.viewCount).toBe(5);
    });

    it('404s for drafts (the published-only query finds nothing)', async () => {
      prismaMock.newsArticle.findFirst.mockResolvedValue(null);
      await expect(newsService.getArticle('draft-slug')).rejects.toMatchObject({ statusCode: 404 });
      await expect(newsService.getArticle('draft-slug', member)).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.newsArticle.update).not.toHaveBeenCalled();
    });

    it('lets admins preview drafts without counting a view', async () => {
      prismaMock.newsArticle.findFirst.mockResolvedValue(article({ status: 'DRAFT' }));
      const result = await newsService.getArticle('n1', admin);
      expect(prismaMock.newsArticle.findFirst.mock.calls[0][0].where.status).toBeUndefined();
      expect(prismaMock.newsArticle.update).not.toHaveBeenCalled();
      expect(result.viewCount).toBe(4);
    });

    it('counts admin views of published articles', async () => {
      prismaMock.newsArticle.findFirst.mockResolvedValue(article({ viewCount: undefined }));
      const result = await newsService.getArticle('n1', admin);
      expect(result.viewCount).toBe(1);
    });
  });

  describe('generateUniqueSlug', () => {
    it('uses the bare slug when free', async () => {
      prismaMock.newsArticle.findMany.mockResolvedValue([]);
      await expect(newsService.generateUniqueSlug('Hello, World!')).resolves.toBe('hello-world');
    });

    it('appends the first free numeric suffix on collision', async () => {
      prismaMock.newsArticle.findMany.mockResolvedValue([
        { slug: 'hello-world' },
        { slug: 'hello-world-2' },
        { slug: 'hello-world-again' },
      ]);
      await expect(newsService.generateUniqueSlug('Hello World')).resolves.toBe('hello-world-3');
    });

    it('excludes the article being renamed and falls back for empty slugs', async () => {
      prismaMock.newsArticle.findMany.mockResolvedValue([]);
      await expect(newsService.generateUniqueSlug('!!!', 'n1')).resolves.toBe('article');
      expect(prismaMock.newsArticle.findMany.mock.calls[0][0].where).toEqual({
        slug: { startsWith: 'article' },
        id: { not: 'n1' },
      });
    });

    it('caps very long slugs', async () => {
      prismaMock.newsArticle.findMany.mockResolvedValue([]);
      const slug = await newsService.generateUniqueSlug('word '.repeat(200));
      expect(slug.length).toBeLessThanOrEqual(180);
    });
  });

  describe('createArticle', () => {
    it('creates a draft with unique slug, reading time and excerpt', async () => {
      prismaMock.newsArticle.findMany.mockResolvedValue([{ slug: 'big-news' }]);
      prismaMock.newsArticle.create.mockImplementation(async (args: any) => args.data);
      const content = '<p>' + 'word '.repeat(450) + '</p>';

      const result = await newsService.createArticle('a1', { title: ' Big News ', content });

      expect(result).toMatchObject({
        title: 'Big News',
        slug: 'big-news-2',
        status: 'DRAFT',
        authorId: 'a1',
        category: 'INSTITUTE_UPDATE',
        readingTime: 3,
      });
      expect(result.excerpt).not.toContain('<p>');
      expect(result.excerpt.endsWith('...')).toBe(true);
      expect(result.excerpt.length).toBeLessThanOrEqual(203);
    });

    it('does not add an ellipsis to short content and keeps a given excerpt', async () => {
      prismaMock.newsArticle.findMany.mockResolvedValue([]);
      prismaMock.newsArticle.create.mockImplementation(async (args: any) => args.data);
      const short = await newsService.createArticle('a1', { title: 'T', content: 'Short body' });
      expect(short.excerpt).toBe('Short body');
      expect(short.readingTime).toBe(1);

      const given = await newsService.createArticle('a1', { title: 'T', content: 'x', excerpt: 'Mine', category: 'EVENT_RECAP' });
      expect(given.excerpt).toBe('Mine');
      expect(given.category).toBe('EVENT_RECAP');
    });

    it.each([
      [{ content: 'x' }],
      [{ title: '  ', content: 'x' }],
      [{ title: 'T' }],
      [{ title: 'T', content: '   ' }],
      [{ title: 'T', content: 'x', category: 'NOPE' }],
    ])('rejects invalid input %j', async input => {
      prismaMock.newsArticle.findMany.mockResolvedValue([]);
      await expect(newsService.createArticle('a1', input as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.newsArticle.create).not.toHaveBeenCalled();
    });
  });

  describe('updateArticle', () => {
    it('whitelists fields and recomputes reading time', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(article());
      prismaMock.newsArticle.update.mockResolvedValue(article());

      await newsService.updateArticle('n1', {
        content: 'word '.repeat(401),
        viewCount: 1e6,
        status: 'PUBLISHED',
        authorId: 'hijack',
        slug: 'evil',
        publishedAt: new Date(0),
      } as any);

      expect(prismaMock.newsArticle.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { content: 'word '.repeat(401), readingTime: 3 },
      });
    });

    it('re-slugs a draft when its title changes', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(article({ status: 'DRAFT' }));
      prismaMock.newsArticle.findMany.mockResolvedValue([]);
      await newsService.updateArticle('n1', { title: ' Brand New ' });
      expect(prismaMock.newsArticle.update.mock.calls[0][0].data).toEqual({ title: 'Brand New', slug: 'brand-new' });
    });

    it('keeps the slug of a published article stable', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(article());
      await newsService.updateArticle('n1', { title: 'Renamed' });
      expect(prismaMock.newsArticle.update.mock.calls[0][0].data).toEqual({ title: 'Renamed' });
      expect(prismaMock.newsArticle.findMany).not.toHaveBeenCalled();
    });

    it('does not re-slug a draft when the title is unchanged', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(article({ status: 'DRAFT' }));
      await newsService.updateArticle('n1', { title: 'Hello World', category: 'EVENT_RECAP' });
      expect(prismaMock.newsArticle.update.mock.calls[0][0].data).toEqual({ title: 'Hello World', category: 'EVENT_RECAP' });
    });

    it('rejects blank title/content and unknown categories', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(article());
      await expect(newsService.updateArticle('n1', { title: '' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(newsService.updateArticle('n1', { content: ' ' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(newsService.updateArticle('n1', { category: 'X' as any })).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.newsArticle.update).not.toHaveBeenCalled();
    });

    it('404s for unknown articles', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(null);
      await expect(newsService.updateArticle('x', { title: 'y' })).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('publish / unpublish / delete', () => {
    it('publishing a draft sets status and publishedAt', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(article({ status: 'DRAFT', publishedAt: null }));
      prismaMock.newsArticle.update.mockResolvedValue(article());
      await newsService.publishArticle('n1');
      const { data } = prismaMock.newsArticle.update.mock.calls[0][0];
      expect(data.status).toBe('PUBLISHED');
      expect(data.publishedAt).toBeInstanceOf(Date);
    });

    it('publishing an already published article is a no-op', async () => {
      const existing = article();
      prismaMock.newsArticle.findUnique.mockResolvedValue(existing);
      await expect(newsService.publishArticle('n1')).resolves.toBe(existing);
      expect(prismaMock.newsArticle.update).not.toHaveBeenCalled();
    });

    it('unpublishing returns the article to draft', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(article());
      await newsService.unpublishArticle('n1');
      expect(prismaMock.newsArticle.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { status: 'DRAFT' } });
    });

    it('deletes an existing article', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(article());
      await expect(newsService.deleteArticle('n1')).resolves.toEqual({ message: 'Article deleted' });
      expect(prismaMock.newsArticle.delete).toHaveBeenCalledWith({ where: { id: 'n1' } });
    });

    it.each(['publishArticle', 'unpublishArticle', 'deleteArticle'] as const)('%s 404s for unknown ids', async method => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(null);
      await expect(newsService[method]('x')).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.newsArticle.update).not.toHaveBeenCalled();
      expect(prismaMock.newsArticle.delete).not.toHaveBeenCalled();
    });
  });

  describe('getLatestNews / getRelatedArticles', () => {
    it('returns latest published news with a capped limit', async () => {
      prismaMock.newsArticle.findMany.mockResolvedValue([]);
      await newsService.getLatestNews(3);
      await newsService.getLatestNews(999);
      await newsService.getLatestNews();
      await newsService.getLatestNews(NaN);
      const calls = prismaMock.newsArticle.findMany.mock.calls.map((c: any[]) => c[0]);
      expect(calls[0].where).toEqual({ status: 'PUBLISHED' });
      expect(calls.map((c: any) => c.take)).toEqual([3, 20, 5, 5]);
    });

    it('returns related published articles from the same category', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(article());
      prismaMock.newsArticle.findMany.mockResolvedValue([]);
      await newsService.getRelatedArticles('n1');
      expect(prismaMock.newsArticle.findMany.mock.calls[0][0]).toMatchObject({
        where: { id: { not: 'n1' }, status: 'PUBLISHED', category: 'ALUMNI_STORY' },
        take: 3,
      });
    });

    it('returns [] for an unknown article', async () => {
      prismaMock.newsArticle.findUnique.mockResolvedValue(null);
      await expect(newsService.getRelatedArticles('x')).resolves.toEqual([]);
    });
  });
});
