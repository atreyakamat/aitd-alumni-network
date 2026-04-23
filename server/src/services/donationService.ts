import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import { generateDonationReceipt, generateReceiptNumber } from '../utils/pdfReceipt';
import { uploadBufferToStorage } from '../utils/storage';

let razorpayClient: Razorpay | null = null;

const getRazorpayClient = () => {
  if (!config.razorpay.keyId || !config.razorpay.keySecret) {
    throw new AppError('Payments are not configured. Missing Razorpay credentials.', 503, 'PAYMENT_NOT_CONFIGURED');
  }

  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: config.razorpay.keyId,
      key_secret: config.razorpay.keySecret,
    });
  }

  return razorpayClient;
};

interface CreateDonationInput {
  amount: number;
  isAnonymous?: boolean;
  dedicatedTo?: string;
  message?: string;
  chapterId?: string;
}

export class DonationService {
  async createOrder(userId: string | null, data: CreateDonationInput) {
    const razorpay = getRazorpayClient();
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
    const razorpay = getRazorpayClient();
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

    // Generate and upload receipt PDF if user is logged in
    if (userId && transaction) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const chapter = donationData.chapterId 
          ? await prisma.chapter.findUnique({ where: { id: donationData.chapterId } })
          : null;

        if (user) {
          const receiptBuffer = await generateDonationReceipt({
            receiptNumber: generateReceiptNumber('DON'),
            donorName: user.fullName,
            donorEmail: user.email,
            amount: donationData.amount,
            date: new Date(),
            paymentId: razorpayPaymentId,
            dedicatedTo: donationData.dedicatedTo,
            message: donationData.message,
            chapterName: chapter?.name,
          });

          const receiptUrl = await uploadBufferToStorage(
            receiptBuffer,
            `receipt_${transaction.id}.pdf`,
            'application/pdf',
            'receipts'
          );

          await prisma.transaction.update({
            where: { id: transaction.id },
            data: { receiptUrl },
          });
        }
      } catch (receiptError) {
        console.error('Failed to generate/upload receipt:', receiptError);
        // Don't fail the whole process if receipt generation fails
      }
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

  async getDonationLeaderboard(limit: number = 10) {
    const donors = await prisma.donation.groupBy({
      by: ['userId'],
      where: {
        userId: { not: null },
        isAnonymous: false,
      },
      _sum: {
        amount: true,
      },
      orderBy: {
        _sum: {
          amount: 'desc',
        },
      },
      take: limit,
    });

    const userIds = donors.map(d => d.userId as string);
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        id: true,
        fullName: true,
        profilePhotoUrl: true,
        batchYear: true,
      },
    });

    const leaderboard = donors.map(d => {
      const user = users.find(u => u.id === d.userId);
      return {
        user,
        totalAmount: d._sum.amount,
      };
    });

    return leaderboard;
  }
}

export const donationService = new DonationService();
