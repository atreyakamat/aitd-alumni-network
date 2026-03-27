import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config';
import Razorpay from 'razorpay';
import crypto from 'crypto';

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

export class MembershipService {
  async getTiers() {
    return prisma.membershipTier.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getTier(id: string) {
    const tier = await prisma.membershipTier.findUnique({
      where: { id },
    });

    if (!tier) {
      throw new AppError('Membership tier not found', 404, 'NOT_FOUND');
    }

    return tier;
  }

  async createTier(data: {
    name: string;
    description?: string;
    priceInr: number;
    durationMonths?: number;
    benefits: string[];
    badgeColor?: string;
    displayOrder?: number;
  }) {
    return prisma.membershipTier.create({
      data: {
        ...data,
        priceInr: data.priceInr,
        benefits: data.benefits,
      },
    });
  }

  async updateTier(id: string, data: Partial<{
    name: string;
    description?: string;
    priceInr: number;
    durationMonths?: number;
    benefits: string[];
    badgeColor?: string;
    displayOrder?: number;
    isActive: boolean;
  }>) {
    return prisma.membershipTier.update({
      where: { id },
      data,
    });
  }

  async getUserMembership(userId: string) {
    return prisma.userMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        OR: [
          { endDate: null },
          { endDate: { gte: new Date() } },
        ],
      },
      include: {
        tier: true,
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async createOrder(userId: string, tierId: string) {
    const tier = await this.getTier(tierId);

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: Number(tier.priceInr) * 100, // Amount in paise
      currency: 'INR',
      receipt: `membership_${userId}_${Date.now()}`,
      notes: {
        userId,
        tierId,
        type: 'membership',
      },
    });

    // Create pending transaction
    await prisma.transaction.create({
      data: {
        userId,
        type: 'MEMBERSHIP',
        amount: tier.priceInr,
        status: 'PENDING',
        gatewayOrderId: order.id,
        metadata: { tierId },
      },
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      tier,
    };
  }

  async verifyPayment(
    userId: string,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string
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

    // Update transaction
    const transaction = await prisma.transaction.findFirst({
      where: { gatewayOrderId: razorpayOrderId },
    });

    if (!transaction) {
      throw new AppError('Transaction not found', 404, 'NOT_FOUND');
    }

    const metadata = transaction.metadata as { tierId: string };
    const tier = await this.getTier(metadata.tierId);

    // Calculate end date
    let endDate: Date | null = null;
    if (tier.durationMonths) {
      endDate = new Date();
      endDate.setMonth(endDate.getMonth() + tier.durationMonths);
    }

    // Update transaction
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'SUCCESS',
        gatewayPaymentId: razorpayPaymentId,
        gatewaySignature: razorpaySignature,
      },
    });

    // Create membership
    const membership = await prisma.userMembership.create({
      data: {
        userId,
        tierId: tier.id,
        startDate: new Date(),
        endDate,
        status: 'ACTIVE',
        transactionId: transaction.id,
      },
    });

    // Update user's membership tier
    await prisma.user.update({
      where: { id: userId },
      data: { membershipTierId: tier.id },
    });

    return {
      message: 'Membership activated successfully',
      membership,
    };
  }

  async getMembershipHistory(userId: string) {
    return prisma.userMembership.findMany({
      where: { userId },
      include: {
        tier: true,
        transaction: true,
      },
      orderBy: { startDate: 'desc' },
    });
  }

  // Admin: Get all paid members
  async getPaidMembers(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [members, total] = await Promise.all([
      prisma.userMembership.findMany({
        where: { status: 'ACTIVE' },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profilePhotoUrl: true,
              batchYear: true,
            },
          },
          tier: true,
        },
        skip,
        take: limit,
        orderBy: { startDate: 'desc' },
      }),
      prisma.userMembership.count({ where: { status: 'ACTIVE' } }),
    ]);

    return {
      data: members,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const membershipService = new MembershipService();
