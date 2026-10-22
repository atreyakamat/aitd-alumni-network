import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';

/** Prisma Decimal/null/undefined → finite number (0 when absent). */
export const toAmount = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Month-over-month growth in percent, one decimal; never NaN/Infinity. */
export const growthPercent = (current: number, previous: number): number => {
  if (previous > 0) return Math.round(((current - previous) / previous) * 1000) / 10;
  return current > 0 ? 100 : 0;
};

const countOf = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && '_all' in value) return Number((value as { _all: number })._all) || 0;
  return 0;
};

const previewContent = (content: unknown): string => {
  if (typeof content !== 'string') return '';
  return content.length > 100 ? `${content.substring(0, 100)}...` : content;
};

export const adminController = {
  /**
   * Get comprehensive admin dashboard statistics
   */
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const startOfYear = new Date(now.getFullYear(), 0, 1);

      // Parallel queries for all stats
      const [
        // User stats
        totalUsers,
        activeUsers,
        verifiedUsers,
        newUsersThisMonth,
        newUsersLastMonth,
        usersByRole,
        usersByBatch,
        usersByCity,
        
        // Content stats
        totalPosts,
        postsThisMonth,
        totalComments,
        commentsThisMonth,
        totalJobs,
        activeJobs,
        jobsThisMonth,
        totalEvents,
        upcomingEvents,
        eventsThisMonth,
        
        // Financial stats
        totalDonations,
        donationsThisMonth,
        donationsThisYear,
        donationsLastMonth,
        totalMemberships,
        activeMemberships,
        
        // Engagement stats
        totalConnections,
        totalMessages,
        messagesThisMonth,
        
        // Recent activity
        recentUsers,
        recentPosts,
      ] = await Promise.all([
        // User counts
        prisma.user.count({ where: { isActive: true } }),
        prisma.user.count({ where: { isActive: true, lastLoginAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
        prisma.user.count({ where: { isVerified: true } }),
        prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
        prisma.user.count({ where: { createdAt: { gte: startOfLastMonth, lt: startOfMonth } } }),
        prisma.user.groupBy({ by: ['userRole'], _count: true }),
        prisma.user.groupBy({ 
          by: ['batchYear'], 
          _count: true, 
          orderBy: { batchYear: 'desc' },
          take: 10,
        }),
        prisma.user.groupBy({
          by: ['city'],
          where: { isActive: true, city: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { city: 'desc' } },
          take: 10,
        }),
        
        // Content counts
        prisma.post.count(),
        prisma.post.count({ where: { createdAt: { gte: startOfMonth } } }),
        prisma.postComment.count(),
        prisma.postComment.count({ where: { createdAt: { gte: startOfMonth } } }),
        prisma.jobOpportunity.count(),
        prisma.jobOpportunity.count({ where: { status: 'PUBLISHED', deadline: { gte: now } } }),
        prisma.jobOpportunity.count({ where: { createdAt: { gte: startOfMonth } } }),
        prisma.event.count(),
        prisma.event.count({ where: { startDate: { gte: now } } }),
        prisma.event.count({ where: { createdAt: { gte: startOfMonth } } }),
        
        // Financial
        prisma.transaction.aggregate({ 
          where: { status: 'SUCCESS', type: 'DONATION' },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.transaction.aggregate({ 
          where: { status: 'SUCCESS', type: 'DONATION', createdAt: { gte: startOfMonth } },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({ 
          where: { status: 'SUCCESS', type: 'DONATION', createdAt: { gte: startOfYear } },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: { status: 'SUCCESS', type: 'DONATION', createdAt: { gte: startOfLastMonth, lt: startOfMonth } },
          _sum: { amount: true },
        }),
        prisma.userMembership.count(),
        prisma.userMembership.count({
          where: { status: 'ACTIVE', OR: [{ endDate: null }, { endDate: { gte: now } }] },
        }),
        
        // Engagement
        prisma.connection.count({ where: { status: 'ACCEPTED' } }),
        prisma.message.count(),
        prisma.message.count({ where: { createdAt: { gte: startOfMonth } } }),
        
        // Recent activity
        prisma.user.findMany({
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: { id: true, fullName: true, email: true, createdAt: true, batchYear: true },
        }),
        prisma.post.findMany({
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: { 
            user: { select: { fullName: true } },
          },
        }),
      ]);

      const userGrowthPercent = growthPercent(newUsersThisMonth || 0, newUsersLastMonth || 0);

      // Parallelize monthly stats fetches
      const [monthlyUserGrowth, monthlyDonations, dailyActivity] = await Promise.all([
        getMonthlyStats(prisma, 12),
        getMonthlyDonationStats(prisma, 12),
        getDailyActivityStats(prisma, 7),
      ]);

      res.json({
        success: true,
        data: {
          users: {
            total: totalUsers,
            active: activeUsers,
            verified: verifiedUsers,
            newThisMonth: newUsersThisMonth,
            growthPercent: userGrowthPercent,
            byRole: (usersByRole || []).map(r => ({ role: r.userRole, count: countOf(r._count) })),
            byBatch: (usersByBatch || []).map(b => ({ year: b.batchYear, count: countOf(b._count) })),
            byLocation: (usersByCity || [])
              .filter(c => typeof c.city === 'string' && c.city.trim() !== '')
              .map(c => ({ city: c.city as string, count: countOf(c._count) })),
            monthlyGrowth: monthlyUserGrowth,
          },
          content: {
            posts: {
              total: totalPosts,
              thisMonth: postsThisMonth,
            },
            comments: {
              total: totalComments,
              thisMonth: commentsThisMonth,
            },
            jobs: {
              total: totalJobs,
              active: activeJobs,
              newThisMonth: jobsThisMonth,
            },
            events: {
              total: totalEvents,
              upcoming: upcomingEvents,
              newThisMonth: eventsThisMonth,
            },
          },
          financial: {
            donations: {
              totalAmount: toAmount(totalDonations?._sum?.amount),
              totalCount: countOf(totalDonations?._count),
              thisMonth: toAmount(donationsThisMonth?._sum?.amount),
              lastMonth: toAmount(donationsLastMonth?._sum?.amount),
              growthPercent: growthPercent(
                toAmount(donationsThisMonth?._sum?.amount),
                toAmount(donationsLastMonth?._sum?.amount),
              ),
              thisYear: toAmount(donationsThisYear?._sum?.amount),
              monthly: monthlyDonations,
            },
            memberships: {
              total: totalMemberships,
              active: activeMemberships,
            },
          },
          engagement: {
            connections: totalConnections,
            messages: {
              total: totalMessages,
              thisMonth: messagesThisMonth,
            },
            daily: dailyActivity,
          },
          recentActivity: {
            users: recentUsers || [],
            posts: (recentPosts || []).map(p => ({
              id: p.id,
              content: previewContent(p.content),
              author: p.user?.fullName ?? null,
              likes: p.likeCount ?? 0,
              comments: p.commentCount ?? 0,
              createdAt: p.createdAt,
            })),
          },
        },
      });
    } catch (error) {
      console.error('Error fetching admin stats:', error);
      next(error);
    }
  },
};

// Helper function to get monthly registration stats
async function getMonthlyStats(prisma: any, months: number) {
  const now = new Date();
  const ranges = Array.from({ length: months }, (_, i) => months - 1 - i);
  
  return Promise.all(ranges.map(async (i) => {
    const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    
    const count = await prisma.user.count({
      where: {
        createdAt: { gte: startDate, lt: endDate },
      },
    });
    
    return {
      month: startDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      count: count || 0,
    };
  }));
}

// Helper function to get monthly donation stats
async function getMonthlyDonationStats(prisma: any, months: number) {
  const now = new Date();
  const ranges = Array.from({ length: months }, (_, i) => months - 1 - i);
  
  return Promise.all(ranges.map(async (i) => {
    const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    
    const [donationSum, membershipSum] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          status: 'SUCCESS',
          type: 'DONATION',
          createdAt: { gte: startDate, lt: endDate },
        },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          status: 'SUCCESS',
          type: 'MEMBERSHIP',
          createdAt: { gte: startDate, lt: endDate },
        },
        _sum: { amount: true },
      })
    ]);
    
    return {
      month: startDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      donations: toAmount(donationSum?._sum?.amount),
      memberships: toAmount(membershipSum?._sum?.amount),
    };
  }));
}

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Helper function to get per-day activity (posts, comments, messages), oldest day first
async function getDailyActivityStats(prisma: any, days: number) {
  const now = new Date();
  const ranges = Array.from({ length: days }, (_, i) => days - 1 - i);

  return Promise.all(ranges.map(async (i) => {
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1);
    const where = { createdAt: { gte: startDate, lt: endDate } };

    const [posts, comments, messages] = await Promise.all([
      prisma.post.count({ where }),
      prisma.postComment.count({ where }),
      prisma.message.count({ where }),
    ]);

    return {
      date: dateKey(startDate),
      day: startDate.toLocaleDateString('en-US', { weekday: 'short' }),
      posts: posts || 0,
      comments: comments || 0,
      messages: messages || 0,
    };
  }));
}
