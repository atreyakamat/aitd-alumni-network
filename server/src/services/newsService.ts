import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse, slugify, calculateReadingTime } from '../utils/helpers';
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
  page?: number;
  limit?: number;
}

export class NewsService {
  async getArticles(filters: ArticleFilters = {}) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);

    const where: Prisma.NewsArticleWhereInput = {
      status: filters.status || 'PUBLISHED',
    };

    if (filters.category) {
      where.category = filters.category;
    }

    const [articles, total] = await Promise.all([
      prisma.newsArticle.findMany({
        where,
        include: {
          author: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
            },
          },
        },
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
      }),
      prisma.newsArticle.count({ where }),
    ]);

    return buildPaginationResponse(articles, total, page, limit);
  }

  async getArticle(slugOrId: string) {
    const article = await prisma.newsArticle.findFirst({
      where: {
        OR: [
          { slug: slugOrId },
          { id: slugOrId },
        ],
        status: 'PUBLISHED',
      },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
          },
        },
      },
    });

    if (!article) {
      throw new AppError('Article not found', 404, 'NOT_FOUND');
    }

    // Increment view count
    await prisma.newsArticle.update({
      where: { id: article.id },
      data: { viewCount: { increment: 1 } },
    });

    return article;
  }

  async createArticle(authorId: string, data: CreateArticleInput) {
    const slug = slugify(data.title) + '-' + Date.now();
    const readingTime = calculateReadingTime(data.content);

    return prisma.newsArticle.create({
      data: {
        title: data.title,
        slug,
        content: data.content,
        excerpt: data.excerpt || data.content.substring(0, 200) + '...',
        category: data.category || 'INSTITUTE_UPDATE',
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

    const updateData: Prisma.NewsArticleUpdateInput = { ...data };

    if (data.content) {
      updateData.readingTime = calculateReadingTime(data.content);
    }

    return prisma.newsArticle.update({
      where: { id },
      data: updateData,
    });
  }

  async publishArticle(id: string) {
    return prisma.newsArticle.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
  }

  async unpublishArticle(id: string) {
    return prisma.newsArticle.update({
      where: { id },
      data: { status: 'DRAFT' },
    });
  }

  async deleteArticle(id: string) {
    await prisma.newsArticle.delete({ where: { id } });
    return { message: 'Article deleted' };
  }

  async getLatestNews(limit: number = 5) {
    return prisma.newsArticle.findMany({
      where: { status: 'PUBLISHED' },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
          },
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
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
      take: limit,
    });
  }
}

export const newsService = new NewsService();
