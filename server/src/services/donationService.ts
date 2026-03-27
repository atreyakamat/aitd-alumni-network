import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

interface CreateDonationInput {
  amount: number;
  isAnonymous?: boolean;
  dedicatedTo?: string;
  message?: string;
  chapterId?: string;
}

export class DonationService {
  async createOrder(userId: string | null, data: CreateDonationInput) {
    const order = await razorpay.orders.create({
      amount: data.amount * 100, // Amount in paise
      currency: 'INR',
      receipt: `donation_${userId || 'guest'}_${Date.now()}`,
      notes: {
        userId: userId || 'guest',
        type: 'donation',
        isAnonymous: String(data.isAnonymous || false),
        chapterId: data.chapterId || '',
      },
    });

    // Create pending transaction if user is logged in
    if (userId) {
      await prisma.transaction.create({
        data: {
          userId,
          type: 'DONATION',
          amount: data.amount,
          status: 'PENDING',
          gatewayOrderId: order.id,
          metadata: {
            isAnonymous: data.isAnonymous,
            dedicatedTo: data.dedicatedTo,
            message: data.message,
            chapterId: data.chapterId,
          },
        },
      });
    }

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    };
  }

  async verifyPayment(
    userId: string | null,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
    donationData: CreateDonationInput
  ) {
    // Verify signature
    const body = razorpayOrderId + '|' + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      throw new AppError('Invalid payment signature', 400, 'INVALID_SIGNATURE');
    }

    // Update transaction if exists
    if (userId) {
      await prisma.transaction.updateMany({
        where: { gatewayOrderId: razorpayOrderId },
        data: {
          status: 'SUCCESS',
          gatewayPaymentId: razorpayPaymentId,
          gatewaySignature: razorpaySignature,
        },
      });
    }

    // Get transaction for reference
    const transaction = userId
      ? await prisma.transaction.findFirst({
          where: { gatewayOrderId: razorpayOrderId },
        })
      : null;

    // Create donation record
    const donation = await prisma.donation.create({
      data: {
        userId,
        amount: donationData.amount,
        isAnonymous: donationData.isAnonymous || false,
        dedicatedTo: donationData.dedicatedTo,
        message: donationData.message,
        chapterId: donationData.chapterId,
        transactionId: transaction?.id,
      },
    });

    // Update chapter donation total if applicable
    if (donationData.chapterId) {
      await prisma.chapter.update({
        where: { id: donationData.chapterId },
        data: {
          totalDonations: { increment: donationData.amount },
        },
      });
    }

    return {
      message: 'Thank you for your donation!',
      donation,
    };
  }

  async getDonorsWall(page: number = 1, limit: number = 20) {
    const { skip, take } = paginationHelper(page, limit);

    const [donations, total] = await Promise.all([
      prisma.donation.findMany({
        where: {
          isAnonymous: false,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
              batchYear: true,
            },
          },
          chapter: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.donation.count({ where: { isAnonymous: false } }),
    ]);

    return buildPaginationResponse(donations, total, page, limit);
  }

  async getFeaturedDonors() {
    return prisma.donation.findMany({
      where: {
        isFeatured: true,
        isAnonymous: false,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            batchYear: true,
          },
        },
      },
      orderBy: { amount: 'desc' },
      take: 10,
    });
  }

  async getChapterDonations() {
    const chapters = await prisma.chapter.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        totalDonations: true,
        _count: {
          select: { donations: true },
        },
      },
      orderBy: { totalDonations: 'desc' },
    });

    return chapters;
  }

  async getUserDonations(userId: string) {
    return prisma.donation.findMany({
      where: { userId },
      include: {
        chapter: {
          select: { id: true, name: true },
        },
        transaction: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDonationStats() {
    const [total, count, thisMonth] = await Promise.all([
      prisma.donation.aggregate({
        _sum: { amount: true },
      }),
      prisma.donation.count(),
      prisma.donation.aggregate({
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalAmount: total._sum.amount || 0,
      totalDonors: count,
      thisMonthAmount: thisMonth._sum.amount || 0,
    };
  }

  // Admin: Feature a donor
  async featureDonor(donationId: string, featured: boolean) {
    return prisma.donation.update({
      where: { id: donationId },
      data: { isFeatured: featured },
    });
  }
}

export const donationService = new DonationService();
