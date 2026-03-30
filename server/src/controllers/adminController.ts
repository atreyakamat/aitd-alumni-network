import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';

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
        
        // Content stats
        totalPosts,
        postsThisMonth,
        totalJobs,
        activeJobs,
        totalEvents,
        upcomingEvents,
        
        // Financial stats
        totalDonations,
        donationsThisMonth,
        donationsThisYear,
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
        
        // Content counts
        prisma.post.count(),
        prisma.post.count({ where: { createdAt: { gte: startOfMonth } } }),
        prisma.jobOpportunity.count(),
        prisma.jobOpportunity.count({ where: { status: 'PUBLISHED', deadline: { gte: now } } }),
        prisma.event.count(),
        prisma.event.count({ where: { startDate: { gte: now } } }),
        
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
        prisma.userMembership.count(),
        prisma.userMembership.count({ where: { status: 'ACTIVE' } }),
        
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

      // Calculate growth percentages
      const userGrowthPercent = newUsersLastMonth > 0 
        ? ((newUsersThisMonth - newUsersLastMonth) / newUsersLastMonth * 100).toFixed(1)
        : newUsersThisMonth > 0 ? '100' : '0';

      // Get monthly user registrations for the past 12 months
      const monthlyUserGrowth = await getMonthlyStats(prisma, 'user', 12);
      const monthlyDonations = await getMonthlyDonationStats(prisma, 12);

      res.json({
        success: true,
        data: {
          users: {
            total: totalUsers,
            active: activeUsers,
            verified: verifiedUsers,
            newThisMonth: newUsersThisMonth,
            growthPercent: parseFloat(userGrowthPercent as string),
            byRole: usersByRole.map(r => ({ role: r.userRole, count: r._count })),
            byBatch: usersByBatch.map(b => ({ year: b.batchYear, count: b._count })),
            monthlyGrowth: monthlyUserGrowth,
          },
          content: {
            posts: {
              total: totalPosts,
              thisMonth: postsThisMonth,
            },
            jobs: {
              total: totalJobs,
              active: activeJobs,
            },
            events: {
              total: totalEvents,
              upcoming: upcomingEvents,
            },
          },
          financial: {
            donations: {
              totalAmount: totalDonations._sum.amount || 0,
              totalCount: totalDonations._count,
              thisMonth: donationsThisMonth._sum.amount || 0,
              thisYear: donationsThisYear._sum.amount || 0,
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
          },
          recentActivity: {
            users: recentUsers,
            posts: recentPosts.map(p => ({
              id: p.id,
              content: p.content?.substring(0, 100) + (p.content && p.content.length > 100 ? '...' : ''),
              author: p.user.fullName,
              likes: p.likeCount,
              comments: p.commentCount,
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
async function getMonthlyStats(prisma: any, model: string, months: number) {
  const results = [];
  const now = new Date();
  
  for (let i = months - 1; i >= 0; i--) {
    const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    
    const count = await prisma.user.count({
      where: {
        createdAt: { gte: startDate, lt: endDate },
      },
    });
    
    results.push({
      month: startDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      count,
    });
  }
  
  return results;
}

// Helper function to get monthly donation stats
async function getMonthlyDonationStats(prisma: any, months: number) {
  const results = [];
  const now = new Date();
  
  for (let i = months - 1; i >= 0; i--) {
    const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    
    const donationSum = await prisma.transaction.aggregate({
      where: {
        status: 'SUCCESS',
        type: 'DONATION',
        createdAt: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    });
    
    const membershipSum = await prisma.transaction.aggregate({
      where: {
        status: 'SUCCESS',
        type: 'MEMBERSHIP',
        createdAt: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    });
    
    results.push({
      month: startDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      donations: donationSum._sum.amount || 0,
      memberships: membershipSum._sum.amount || 0,
    });
  }
  
  return results;
}
