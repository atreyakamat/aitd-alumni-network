import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';

export const searchController = {
  /**
   * Global search across users, jobs, events, and posts
   */
  async globalSearch(req: Request, res: Response, next: NextFunction) {
    try {
      const { q } = req.query;
      const query = q as string;

      if (!query || query.length < 2) {
        return res.json({
          success: true,
          data: {
            users: [],
            jobs: [],
            events: [],
            posts: [],
          },
        });
      }

      const [users, jobs, events, posts] = await Promise.all([
        // Search Users
        prisma.user.findMany({
          where: {
            OR: [
              { fullName: { contains: query } },
              { currentDesignation: { contains: query } },
              { department: { contains: query } },
              { skills: { some: { skill: { name: { contains: query } } } } },
            ],
            isActive: true,
          },
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
            batchYear: true,
            department: true,
          },
          take: 5,
        }),

        // Search Jobs
        prisma.jobOpportunity.findMany({
          where: {
            OR: [
              { title: { contains: query } },
              { company: { contains: query } },
              { description: { contains: query } },
            ],
            status: 'PUBLISHED',
          },
          take: 5,
        }),

        // Search Events
        prisma.event.findMany({
          where: {
            OR: [
              { title: { contains: query } },
              { description: { contains: query } },
              { venue: { contains: query } },
              { address: { contains: query } },
              { city: { contains: query } },
            ],
            startDate: { gte: new Date() },
          },
          take: 5,
        }),

        // Search Posts
        prisma.post.findMany({
          where: {
            content: { contains: query },
          },
          include: {
            user: {
              select: { fullName: true, profilePhotoUrl: true },
            },
          },
          take: 5,
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
