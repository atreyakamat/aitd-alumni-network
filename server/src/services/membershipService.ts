import type { Transaction } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { generateMembershipReceipt, generateReceiptNumber } from '../utils/pdfReceipt';
import { uploadBufferToStorage } from '../utils/storage';
import { buildOrderReceipt, getRazorpayClient, toPaise, verifyPaymentSignature } from '../utils/razorpay';
import { buildPaginationResponse, paginationHelper } from '../utils/helpers';
import config from '../config';
import { claimTransaction, CompletionOptions, GatewayPayment, runReceipt } from './paymentCompletion';

export interface TierInput {
  name: string;
  description?: string | null;
  priceInr: number;
  durationMonths?: number | null;
  benefits: string[];
  badgeColor?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

const MAX_TIER_PRICE_INR = 1_000_000;

const validationError = (message: string) => new AppError(message, 400, 'VALIDATION_ERROR');

/**
 * Validates and whitelists tier fields (prevents mass assignment of id/timestamps).
 * With `partial`, only the provided fields are validated/returned.
 */
export const validateTierInput = (raw: unknown, partial = false): Partial<TierInput> => {
  if (!raw || typeof raw !== 'object') throw validationError('Tier data is required');
  const input = raw as Record<string, unknown>;
  const out: Partial<TierInput> = {};
  const has = (key: string) => input[key] !== undefined;

  if (!partial || has('name')) {
    if (typeof input.name !== 'string' || !input.name.trim()) throw validationError('Tier name is required');
    if (input.name.trim().length > 100) throw validationError('Tier name is too long');
    out.name = input.name.trim();
  }

  if (!partial || has('priceInr')) {
    const price = typeof input.priceInr === 'string' ? Number(input.priceInr) : input.priceInr;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      throw validationError('priceInr must be a number greater than or equal to 0');
    }
    if (price > MAX_TIER_PRICE_INR) throw validationError(`priceInr cannot exceed ${MAX_TIER_PRICE_INR}`);
    out.priceInr = Math.round(price * 100) / 100;
  }

  if (!partial || has('benefits')) {
    if (!Array.isArray(input.benefits) || input.benefits.some((b) => typeof b !== 'string' || !b.trim())) {
      throw validationError('benefits must be an array of non-empty strings');
    }
    out.benefits = (input.benefits as string[]).map((b) => b.trim());
  }

  if (has('durationMonths')) {
    const d = input.durationMonths;
    if (d !== null && (typeof d !== 'number' || !Number.isInteger(d) || d <= 0)) {
      throw validationError('durationMonths must be a positive integer, or null for lifetime');
    }
    out.durationMonths = d as number | null;
  }

  if (has('description')) {
    if (input.description !== null && typeof input.description !== 'string') throw validationError('description must be a string');
    out.description = input.description as string | null;
  }

  if (has('badgeColor')) {
    if (input.badgeColor !== null && typeof input.badgeColor !== 'string') throw validationError('badgeColor must be a string');
    out.badgeColor = input.badgeColor as string | null;
  }

  if (has('displayOrder')) {
    if (typeof input.displayOrder !== 'number' || !Number.isInteger(input.displayOrder)) {
      throw validationError('displayOrder must be an integer');
    }
    out.displayOrder = input.displayOrder;
  }

  if (has('isActive')) {
    if (typeof input.isActive !== 'boolean') throw validationError('isActive must be a boolean');
    out.isActive = input.isActive;
  }

  return out;
};

/** Adds `months` calendar months, clamping to the last day of the target month (Jan 31 + 1 → Feb 28/29). */
export const addMonths = (from: Date, months: number): Date => {
  const result = new Date(from.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
};

/** A membership is current when ACTIVE and its endDate is null (lifetime) or not yet past. */
export const isMembershipCurrent = (
  membership: { status: string; endDate: Date | null } | null | undefined,
  now: Date = new Date()
): boolean => {
  if (!membership || membership.status !== 'ACTIVE') return false;
  return membership.endDate === null || new Date(membership.endDate).getTime() >= now.getTime();
};

const currentMembershipWhere = (now: Date) => ({
  status: 'ACTIVE' as const,
  OR: [{ endDate: null }, { endDate: { gte: now } }],
});

export class MembershipService {
  async getTiers() {
    return prisma.membershipTier.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getTier(id: string) {
    if (!id) throw validationError('Tier id is required');
    const tier = await prisma.membershipTier.findUnique({ where: { id } });
    if (!tier) {
      throw new AppError('Membership tier not found', 404, 'NOT_FOUND');
    }
    return tier;
  }

  async createTier(data: unknown) {
    const input = validateTierInput(data) as TierInput;
    return prisma.membershipTier.create({ data: input });
  }

  async updateTier(id: string, data: unknown) {
    const input = validateTierInput(data, true);
    if (Object.keys(input).length === 0) throw validationError('No valid fields to update');
    await this.getTier(id);
    return prisma.membershipTier.update({ where: { id }, data: input });
  }

  /** Current membership (expired ones — endDate in the past — are ignored; lifetime never expires). */
  async getUserMembership(userId: string) {
    return prisma.userMembership.findFirst({
      where: { userId, ...currentMembershipWhere(new Date()) },
      include: { tier: true },
      orderBy: { startDate: 'desc' },
    });
  }

  async createOrder(userId: string, tierId: string) {
    if (!tierId || typeof tierId !== 'string') throw validationError('tierId is required');

    const tier = await this.getTier(tierId);
    if (!tier.isActive) {
      throw new AppError('This membership tier is not available for purchase', 400, 'TIER_INACTIVE');
    }
    const priceInr = Number(tier.priceInr);
    if (!(priceInr > 0)) {
      throw new AppError('This membership tier does not require payment', 400, 'TIER_FREE');
    }

    const razorpay = getRazorpayClient();
    // Amount always comes from the server-side tier, never from the client.
    const amountPaise = toPaise(priceInr);

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: buildOrderReceipt('mem', userId),
      notes: { userId, tierId, type: 'membership' },
    });

    await prisma.transaction.create({
      data: {
        userId,
        type: 'MEMBERSHIP',
        amount: priceInr,
        status: 'PENDING',
        gatewayOrderId: order.id,
        metadata: { tierId, amountPaise },
      },
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: config.razorpay.keyId,
      tier,
    };
  }

  async verifyPayment(
    userId: string,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string
  ) {
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw validationError('razorpay_order_id, razorpay_payment_id and razorpay_signature are required');
    }
    if (!config.razorpay.keySecret) {
      // Never verify against an empty secret: anyone could forge the HMAC.
      throw new AppError('Payments are not configured. Missing Razorpay credentials.', 503, 'PAYMENT_NOT_CONFIGURED');
    }

    const transaction = await prisma.transaction.findFirst({
      where: { gatewayOrderId: razorpayOrderId, type: 'MEMBERSHIP' },
    });
    if (!transaction) {
      throw new AppError('Transaction not found', 404, 'NOT_FOUND');
    }
    if (transaction.userId !== userId) {
      throw new AppError('You can only verify your own payments', 403, 'FORBIDDEN');
    }

    const signatureValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);

    if (transaction.status === 'SUCCESS') {
      if (!signatureValid) throw new AppError('Invalid payment signature', 400, 'INVALID_SIGNATURE');
      return this.alreadyVerified(transaction.id);
    }

    if (!signatureValid) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED', gatewayPaymentId: razorpayPaymentId },
      });
      throw new AppError('Invalid payment signature', 400, 'INVALID_SIGNATURE');
    }

    if (transaction.status === 'REFUNDED') {
      throw new AppError('This payment has been refunded', 409, 'PAYMENT_REFUNDED');
    }

    return this.completeTransaction(transaction, {
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
    });
  }

  /**
   * Completes a PENDING/FAILED membership transaction exactly once: claims it
   * (status-guarded), supersedes any current membership, activates the purchased
   * tier for the transaction owner and stores a receipt. Shared by the client verify
   * endpoint and the Razorpay webhook; a lost claim returns the existing membership
   * with `alreadyVerified: true`.
   */
  async completeTransaction(transaction: Transaction, payment: GatewayPayment, options: CompletionOptions = {}) {
    const metadata = (transaction.metadata || {}) as { tierId?: string };
    if (!metadata.tierId) {
      throw new AppError('Transaction is missing membership details', 422, 'INVALID_TRANSACTION');
    }
    const userId = transaction.userId;
    if (!userId) {
      // Membership orders are always created by a member; a null owner means the user row was
      // deleted (FK SetNull). Never activate a membership for nobody: leave it for reconciliation.
      throw new AppError('Transaction has no member to activate', 422, 'INVALID_TRANSACTION');
    }
    const tier = await this.getTier(metadata.tierId);

    const startDate = new Date();
    const endDate = tier.durationMonths ? addMonths(startDate, tier.durationMonths) : null;

    const membership = await prisma.$transaction(async (tx) => {
      // Status-guarded update: only one concurrent completer can flip PENDING/FAILED → SUCCESS.
      if (!(await claimTransaction(tx, transaction.id, payment))) return null;

      // Supersede any previous current membership (upgrade/renewal).
      await tx.userMembership.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });

      const created = await tx.userMembership.create({
        data: {
          userId,
          tierId: tier.id,
          startDate,
          endDate,
          status: 'ACTIVE',
          transactionId: transaction.id,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { membershipTierId: tier.id },
      });

      return created;
    });

    if (!membership) return this.alreadyVerified(transaction.id);

    // Best-effort receipt generation; payment success never depends on it.
    await runReceipt(async () => {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return;
        const receiptBuffer = await generateMembershipReceipt({
          receiptNumber: generateReceiptNumber('MEM', transaction.id, transaction.createdAt || startDate),
          memberName: user.fullName,
          memberEmail: user.email,
          membershipTier: tier.name,
          amount: Number(transaction.amount),
          startDate,
          endDate,
          paymentId: payment.paymentId || transaction.id,
        });
        const receiptUrl = await uploadBufferToStorage(
          receiptBuffer,
          `receipt_${transaction.id}.pdf`,
          'application/pdf',
          'receipts'
        );
        await prisma.transaction.update({ where: { id: transaction.id }, data: { receiptUrl } });
      } catch (receiptError) {
        console.error('Failed to generate/upload membership receipt:', receiptError);
      }
    }, options);

    return {
      message: 'Membership activated successfully',
      membership,
      alreadyVerified: false,
    };
  }

  private async alreadyVerified(transactionId: string) {
    const membership = await prisma.userMembership.findFirst({
      where: { transactionId },
      include: { tier: true },
    });
    return {
      message: 'Payment already verified',
      membership,
      alreadyVerified: true,
    };
  }

  async getMembershipHistory(userId: string, rawPage = 1, rawLimit = 20) {
    const { skip, take, page, limit } = paginationHelper(rawPage, rawLimit);
    const where = { userId };
    const [items, total] = await Promise.all([
      prisma.userMembership.findMany({
        where,
        include: { tier: true, transaction: true },
        orderBy: { startDate: 'desc' },
        skip,
        take,
      }),
      prisma.userMembership.count({ where }),
    ]);
    return buildPaginationResponse(items, total, page, limit);
  }

  // Admin: Get all paid members with a current (non-expired) membership
  async getPaidMembers(rawPage = 1, rawLimit = 20) {
    const { skip, take, page, limit } = paginationHelper(rawPage, rawLimit);
    const where = currentMembershipWhere(new Date());

    const [members, total] = await Promise.all([
      prisma.userMembership.findMany({
        where,
        include: {
          user: {
            select: { id: true, fullName: true, email: true, profilePhotoUrl: true, batchYear: true },
          },
          tier: true,
        },
        skip,
        take,
        orderBy: { startDate: 'desc' },
      }),
      prisma.userMembership.count({ where }),
    ]);

    return buildPaginationResponse(members, total, page, limit);
  }
}

export const membershipService = new MembershipService();
