import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { ilike } from '../utils/helpers';
import { loadViewerContext, visiblePostWhere } from '../services/socialShared';

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 100;
export const SEARCH_RESULTS_PER_TYPE = 5;

/**
 * `public`: an anonymous visitor, who only gets what the public site already shows (events, news, chapters).
 * `member`: a signed-in member, who additionally searches people, jobs and posts.
 * The client uses `scope` to explain that more is available after signing in.
 */
export type SearchScope = 'public' | 'member';

const emptyResults = () => ({
  users: [],
  jobs: [],
  events: [],
  posts: [],
  news: [],
  chapters: [],
});

export const searchController = {
  /**
   * Global search. Works without an account (public content only) and returns more to members.
   */
  async globalSearch(req: Request, res: Response, next: NextFunction) {
    try {
      const { q } = req.query;
      const scope: SearchScope = req.user?.id ? 'member' : 'public';
      // Repeated params (?q=a&q=b) arrive as arrays; only a single string is a valid query.
      const query = typeof q === 'string' ? q.trim().slice(0, SEARCH_MAX_QUERY_LENGTH) : '';

      if (query.length < SEARCH_MIN_QUERY_LENGTH) {
        return res.json({
          success: true,
          data: { scope, ...emptyResults() },
        });
      }

      const take = SEARCH_RESULTS_PER_TYPE;
      const isMember = scope === 'member';

      // Public content: what the logged-out site shows anyway
      const eventsQuery = prisma.event.findMany({
        where: {
          OR: [
            { title: ilike(query) },
            { description: ilike(query) },
            { venue: ilike(query) },
            { address: ilike(query) },
            { city: ilike(query) },
          ],
          status: 'PUBLISHED',
          // Members-only events are searchable by members only
          ...(isMember ? {} : { isPublic: true }),
          startDate: { gte: new Date() },
        },
        select: {
          id: true,
          title: true,
          bannerUrl: true,
          eventType: true,
          venue: true,
          city: true,
          startDate: true,
          endDate: true,
        },
        orderBy: { startDate: 'asc' },
        take,
      });

      const newsQuery = prisma.newsArticle.findMany({
        where: {
          status: 'PUBLISHED',
          OR: [{ title: ilike(query) }, { excerpt: ilike(query) }, { content: ilike(query) }],
        },
        // No article body in a result list
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          category: true,
          featuredImage: true,
          publishedAt: true,
        },
        orderBy: { publishedAt: 'desc' },
        take,
      });

      const chaptersQuery = prisma.chapter.findMany({
        where: {
          isActive: true,
          OR: [{ name: ilike(query) }, { region: ilike(query) }, { description: ilike(query) }],
        },
        select: {
          id: true,
          name: true,
          region: true,
          description: true,
          logoUrl: true,
          memberCount: true,
        },
        orderBy: { memberCount: 'desc' },
        take,
      });

      if (!isMember) {
        const [events, news, chapters] = await Promise.all([eventsQuery, newsQuery, chaptersQuery]);
        return res.json({
          success: true,
          data: { scope, ...emptyResults(), events, news, chapters },
        });
      }

      // Members: the same visibility rules as the feed decide which posts can be found
      const viewer = await loadViewerContext(req.user);

      const [users, jobs, events, posts, news, chapters] = await Promise.all([
        // Search Users (same visibility as the directory; no contact/location fields)
        prisma.user.findMany({
          where: {
            OR: [
              { fullName: ilike(query) },
              { currentDesignation: ilike(query) },
              { department: ilike(query) },
              { skills: { some: { skill: { name: ilike(query) } } } },
            ],
            isActive: true,
            isVerified: true,
          },
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
            batchYear: true,
            department: true,
          },
          take,
        }),

        // Search Jobs
        prisma.jobOpportunity.findMany({
          where: {
            OR: [
              { title: ilike(query) },
              { company: ilike(query) },
              { description: ilike(query) },
            ],
            status: 'PUBLISHED',
          },
          select: {
            id: true,
            title: true,
            company: true,
            location: true,
            workplaceType: true,
            jobType: true,
            deadline: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take,
        }),

        eventsQuery,

        // Search Posts: published, by active authors, and CONNECTIONS-only posts only for the author's connections
        prisma.post.findMany({
          where: { AND: [visiblePostWhere(viewer), { content: ilike(query) }] },
          include: {
            user: {
              select: { id: true, fullName: true, profilePhotoUrl: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take,
        }),

        newsQuery,
        chaptersQuery,
      ]);

      res.json({
        success: true,
        data: {
          scope,
          users,
          jobs,
          events,
          posts,
          news,
          chapters,
        },
      });
    } catch (error) {
      console.error('Global search error:', error);
      next(error);
    }
  },
};
