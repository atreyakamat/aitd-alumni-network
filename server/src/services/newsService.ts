import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse, slugify, calculateReadingTime, ilike } from '../utils/helpers';
import { Actor, isAdminRole } from '../config/permissions';
import { NewsCategory, ArticleStatus, Prisma } from '@prisma/client';

interface CreateArticleInput {
  title: string;
  content: string;
  excerpt?: string;
  category?: NewsCategory;
  featuredImage?: string;
}

interface ArticleFilters {
  category?: NewsCategory;
  status?: ArticleStatus;
  search?: string;
  page?: number;
  limit?: number;
}

const CATEGORIES: NewsCategory[] = Object.values(NewsCategory) as NewsCategory[];
const STATUSES: ArticleStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const EDITABLE_FIELDS = ['title', 'content', 'excerpt', 'category', 'featuredImage'] as const;
const EXCERPT_LENGTH = 200;
const MAX_LATEST = 20;
const MAX_SEARCH_LENGTH = 100;

const authorSelect = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
} as const;

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const buildExcerpt = (content: string) => {
  const text = stripHtml(content);
  return text.length > EXCERPT_LENGTH ? text.substring(0, EXCERPT_LENGTH).trimEnd() + '...' : text;
};

const assertCategory = (category: unknown): NewsCategory | undefined => {
  if (category === undefined || category === null || category === '') return undefined;
  if (!CATEGORIES.includes(category as NewsCategory)) {
    throw new AppError('Invalid news category', 400, 'VALIDATION_ERROR');
  }
  return category as NewsCategory;
};

const clampLimit = (limit: number, fallback: number, max: number) =>
  Number.isFinite(limit) ? Math.min(max, Math.max(1, Math.floor(limit))) : fallback;

export class NewsService {
  /**
   * Public listing is always PUBLISHED-only; a `status` filter is honoured
   * only for platform admins.
   */
  async getArticles(filters: ArticleFilters = {}, viewer?: Actor | null) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);

    let status: ArticleStatus = 'PUBLISHED';
    if (viewer && isAdminRole(viewer.userRole) && filters.status) {
      if (!STATUSES.includes(filters.status)) {
        throw new AppError('Invalid article status', 400, 'VALIDATION_ERROR');
      }
      status = filters.status;
    }

    const where: Prisma.NewsArticleWhereInput = { status };

    const category = assertCategory(filters.category);
    if (category) {
      where.category = category;
    }

    // Case-insensitive on PostgreSQL via ilike()
    const search = typeof filters.search === 'string' ? filters.search.trim().slice(0, MAX_SEARCH_LENGTH) : '';
    if (search) {
      where.OR = [
        { title: ilike(search) },
        { excerpt: ilike(search) },
        { content: ilike(search) },
      ];
    }

    const [articles, total] = await Promise.all([
      prisma.newsArticle.findMany({
        where,
        include: {
          author: { select: authorSelect },
        },
        orderBy: status === 'PUBLISHED' ? { publishedAt: 'desc' } : { updatedAt: 'desc' },
        skip,
        take,
      }),
      prisma.newsArticle.count({ where }),
    ]);

    return buildPaginationResponse(articles, total, page, limit);
  }

  /**
   * Fetch by slug or id. Only published articles are visible publicly; admins
   * may preview drafts (preview does not count as a view).
   */
  async getArticle(slugOrId: string, viewer?: Actor | null) {
    const isAdmin = !!viewer && isAdminRole(viewer.userRole);

    const where: Prisma.NewsArticleWhereInput = {
      OR: [{ slug: slugOrId }, { id: slugOrId }],
    };
    if (!isAdmin) where.status = 'PUBLISHED';

    const article = await prisma.newsArticle.findFirst({
      where,
      include: {
        author: {
          select: { ...authorSelect, currentDesignation: true },
        },
      },
    });

    if (!article) {
      throw new AppError('Article not found', 404, 'NOT_FOUND');
    }

    if (article.status !== 'PUBLISHED') {
      return article;
    }

    await prisma.newsArticle.update({
      where: { id: article.id },
      data: { viewCount: { increment: 1 } },
    });

    return { ...article, viewCount: (article.viewCount ?? 0) + 1 };
  }

  /** Returns `base` or `base-N` (N >= 2), whichever is the first unused slug. */
  async generateUniqueSlug(title: string, excludeId?: string): Promise<string> {
    const base = slugify(title || '').substring(0, 180) || 'article';

    const existing = await prisma.newsArticle.findMany({
      where: {
        slug: { startsWith: base },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { slug: true },
    });
    const taken = new Set(existing.map(a => a.slug));

    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  async createArticle(authorId: string, data: CreateArticleInput) {
    if (!data || typeof data.title !== 'string' || !data.title.trim()) {
      throw new AppError('Title is required', 400, 'VALIDATION_ERROR');
    }
    if (typeof data.content !== 'string' || !data.content.trim()) {
      throw new AppError('Content is required', 400, 'VALIDATION_ERROR');
    }
    const category = assertCategory(data.category) || 'INSTITUTE_UPDATE';

    const title = data.title.trim();
    const slug = await this.generateUniqueSlug(title);
    const readingTime = calculateReadingTime(stripHtml(data.content));

    return prisma.newsArticle.create({
      data: {
        title,
        slug,
        content: data.content,
        excerpt: data.excerpt || buildExcerpt(data.content),
        category,
        featuredImage: data.featuredImage,
        authorId,
        readingTime,
        status: 'DRAFT',
      },
    });
  }

  async updateArticle(id: string, data: Partial<CreateArticleInput>) {
    const article = await prisma.newsArticle.findUnique({
      where: { id },
    });

    if (!article) {
      throw new AppError('Article not found', 404, 'NOT_FOUND');
    }

    const updateData: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (data && data[field] !== undefined) updateData[field] = data[field];
    }

    if (updateData.title !== undefined) {
      if (typeof updateData.title !== 'string' || !updateData.title.trim()) {
        throw new AppError('Title is required', 400, 'VALIDATION_ERROR');
      }
      updateData.title = updateData.title.trim();
      // Published URLs are stable; drafts follow their title.
      if (article.status !== 'PUBLISHED' && updateData.title !== article.title) {
        updateData.slug = await this.generateUniqueSlug(updateData.title as string, id);
      }
    }

    if (updateData.content !== undefined) {
      if (typeof updateData.content !== 'string' || !updateData.content.trim()) {
        throw new AppError('Content is required', 400, 'VALIDATION_ERROR');
      }
      updateData.readingTime = calculateReadingTime(stripHtml(updateData.content));
    }

    if (updateData.category !== undefined) assertCategory(updateData.category);

    return prisma.newsArticle.update({
      where: { id },
      data: updateData as Prisma.NewsArticleUpdateInput,
    });
  }

  private async findOrThrow(id: string) {
    const article = await prisma.newsArticle.findUnique({ where: { id } });
    if (!article) {
      throw new AppError('Article not found', 404, 'NOT_FOUND');
    }
    return article;
  }

  async publishArticle(id: string) {
    const article = await this.findOrThrow(id);
    if (article.status === 'PUBLISHED') {
      return article;
    }

    return prisma.newsArticle.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
  }

  async unpublishArticle(id: string) {
    await this.findOrThrow(id);
    return prisma.newsArticle.update({
      where: { id },
      data: { status: 'DRAFT' },
    });
  }

  async deleteArticle(id: string) {
    await this.findOrThrow(id);
    await prisma.newsArticle.delete({ where: { id } });
    return { message: 'Article deleted' };
  }

  async getLatestNews(limit: number = 5) {
    return prisma.newsArticle.findMany({
      where: { status: 'PUBLISHED' },
      include: {
        author: { select: authorSelect },
      },
      orderBy: { publishedAt: 'desc' },
      take: clampLimit(limit, 5, MAX_LATEST),
    });
  }

  async getRelatedArticles(articleId: string, limit: number = 3) {
    const article = await prisma.newsArticle.findUnique({
      where: { id: articleId },
    });

    if (!article) {
      return [];
    }

    return prisma.newsArticle.findMany({
      where: {
        id: { not: articleId },
        status: 'PUBLISHED',
        category: article.category,
      },
      orderBy: { publishedAt: 'desc' },
      take: clampLimit(limit, 3, MAX_LATEST),
    });
  }
}

export const newsService = new NewsService();
