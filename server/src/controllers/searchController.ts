import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { ilike } from '../utils/helpers';

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 100;
export const SEARCH_RESULTS_PER_TYPE = 5;

const emptyResults = () => ({
  users: [],
  jobs: [],
  events: [],
  posts: [],
});

export const searchController = {
  /**
   * Global search across users, jobs, events, and posts
   */
  async globalSearch(req: Request, res: Response, next: NextFunction) {
    try {
      const { q } = req.query;
      // Repeated params (?q=a&q=b) arrive as arrays; only a single string is a valid query.
      const query = typeof q === 'string' ? q.trim().slice(0, SEARCH_MAX_QUERY_LENGTH) : '';

      if (query.length < SEARCH_MIN_QUERY_LENGTH) {
        return res.json({
          success: true,
          data: emptyResults(),
        });
      }

      const take = SEARCH_RESULTS_PER_TYPE;

      const [users, jobs, events, posts] = await Promise.all([
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

        // Search Events (published, public, upcoming only)
        prisma.event.findMany({
          where: {
            OR: [
              { title: ilike(query) },
              { description: ilike(query) },
              { venue: ilike(query) },
              { address: ilike(query) },
              { city: ilike(query) },
            ],
            status: 'PUBLISHED',
            isPublic: true,
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
        }),

        // Search Posts (published, by active authors)
        prisma.post.findMany({
          where: {
            content: ilike(query),
            isPublished: true,
            user: { isActive: true },
          },
          include: {
            user: {
              select: { id: true, fullName: true, profilePhotoUrl: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take,
        }),
      ]);

      res.json({
        success: true,
        data: {
          users,
          jobs,
          events,
          posts,
        },
      });
    } catch (error) {
      console.error('Global search error:', error);
      next(error);
    }
  },
};
