import type { Transaction } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import config from '../config';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { generateDonationReceipt, generateReceiptNumber } from '../utils/pdfReceipt';
import { uploadBufferToStorage } from '../utils/storage';
import { sendEmail } from '../utils/email';
import { emailField } from '../utils/validators';
import {
  buildOrderReceipt,
  fromPaise,
  getRazorpayClient,
  toPaise,
  verifyPaymentSignature,
} from '../utils/razorpay';
import { claimTransaction, CompletionOptions, GatewayPayment, runReceipt } from './paymentCompletion';

export interface CreateDonationInput {
  amount: number;
  isAnonymous?: boolean;
  dedicatedTo?: string;
  message?: string;
  chapterId?: string;
  /** Guest donors only (members' details come from their account): printed on and e-mailed with the receipt. */
  donorName?: string;
  donorEmail?: string;
}

/**
 * Server-side donation details stored on the PENDING transaction at order time.
 * Completion (client verify or webhook) reads only this, never a request body.
 */
export interface DonationMetadata {
  isAnonymous?: boolean;
  dedicatedTo?: string;
  message?: string;
  chapterId?: string;
  amountPaise?: number;
  /** Guest donations only. */
  donorName?: string;
  donorEmail?: string;
  /** Adopted from a Razorpay order created before guest transactions existed. */
  legacyOrder?: boolean;
}

/** Name printed on a guest's receipt when they did not give one. */
export const GUEST_DONOR_NAME = 'Guest Donor';

/** Donor identity for receipts/exports: the member account, else the guest details on the transaction. */
export const guestDonorFromMetadata = (metadata: unknown): { name: string; email: string } => {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as DonationMetadata;
  return { name: meta.donorName || GUEST_DONOR_NAME, email: meta.donorEmail || '' };
};

const MAX_DEDICATION_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_DONOR_NAME_LENGTH = 100;
const MAX_LEADERBOARD = 50;

const validationError = (message: string) => new AppError(message, 400, 'VALIDATION_ERROR');

/** Public donor projection — never includes e-mail or other contact details. */
const PUBLIC_DONOR_SELECT = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
  batchYear: true,
} as const;

/** Donations that count towards public totals: legacy guest donations (no transaction) or a SUCCESS transaction. */
const SUCCESSFUL_DONATION_WHERE = {
  OR: [{ transactionId: null }, { transaction: { is: { status: 'SUCCESS' as const } } }],
};

const optionalText = (value: unknown, field: string, max: number): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw validationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw validationError(`${field} cannot exceed ${max} characters`);
  return trimmed || undefined;
};

const optionalEmail = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = emailField.safeParse(value);
  if (!parsed.success) throw validationError('donorEmail must be a valid email address');
  return parsed.data;
};

const toNumber = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export class DonationService {
  /**
   * Creates the Razorpay order and, for every donor (guest or member), a durable
   * PENDING transaction holding the server-side truth (amount and donation details).
   * Guest transactions have no user; their contact details live in the metadata.
   */
  async createOrder(userId: string | null, data: CreateDonationInput) {
    if (!data || typeof data !== 'object') throw validationError('Donation details are required');
    const amountPaise = toPaise(data.amount);
    const amount = fromPaise(amountPaise);
    const isAnonymous = data.isAnonymous === true;
    const dedicatedTo = optionalText(data.dedicatedTo, 'dedicatedTo', MAX_DEDICATION_LENGTH);
    const message = optionalText(data.message, 'message', MAX_MESSAGE_LENGTH);
    const chapterId = optionalText(data.chapterId, 'chapterId', 64);
    const guest = userId
      ? {}
      : {
          donorName: optionalText(data.donorName, 'donorName', MAX_DONOR_NAME_LENGTH),
          donorEmail: optionalEmail(data.donorEmail),
        };

    if (chapterId) {
      const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
      if (!chapter || chapter.isActive === false) {
        throw new AppError('Chapter not found', 404, 'NOT_FOUND');
      }
    }

    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: buildOrderReceipt('don', userId),
      notes: {
        userId: userId || 'guest',
        type: 'donation',
        isAnonymous: String(isAnonymous),
        chapterId: chapterId || '',
      },
    });

    const metadata: DonationMetadata = { isAnonymous, dedicatedTo, message, chapterId, amountPaise, ...guest };
    await prisma.transaction.create({
      data: {
        userId,
        type: 'DONATION',
        amount,
        status: 'PENDING',
        gatewayOrderId: order.id,
        metadata: metadata as object,
      },
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: config.razorpay.keyId,
    };
  }

  async verifyPayment(
    userId: string | null,
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

    let transaction = await prisma.transaction.findFirst({
      where: { gatewayOrderId: razorpayOrderId, type: 'DONATION' },
    });

    const signatureValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);

    if (!transaction) {
      if (!signatureValid) throw new AppError('Invalid payment signature', 400, 'INVALID_SIGNATURE');
      const adopted = await this.adoptLegacyGuestOrder(razorpayOrderId);
      if ('alreadyVerified' in adopted) return adopted;
      transaction = adopted;
    }

    // A member's order may only be verified by that member. A guest order (no user) is
    // verifiable by whoever holds Razorpay's signature for it, and stays a guest donation.
    if (transaction.userId && transaction.userId !== userId) {
      throw new AppError('You can only verify your own payments', 403, 'FORBIDDEN');
    }

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
   * Completes a PENDING/FAILED donation transaction (member or guest) exactly once: claims
   * it (status-guarded), records the donation, bumps the chapter total and stores a receipt
   * (e-mailed to guests). Shared by the client verify endpoint and the Razorpay webhook; a
   * lost claim returns the existing donation with `alreadyVerified: true`.
   * Everything comes from the server-side transaction, never from a request body.
   */
  async completeTransaction(transaction: Transaction, payment: GatewayPayment, options: CompletionOptions = {}) {
    const meta = (transaction.metadata || {}) as DonationMetadata;
    const amount = Number(transaction.amount);
    const userId = transaction.userId ?? null;

    const donation = await prisma.$transaction(async (tx) => {
      if (!(await claimTransaction(tx, transaction.id, payment))) return null;

      const created = await tx.donation.create({
        data: {
          userId,
          amount,
          isAnonymous: meta.isAnonymous === true,
          dedicatedTo: meta.dedicatedTo,
          message: meta.message,
          chapterId: meta.chapterId || undefined,
          transactionId: transaction.id,
        },
      });

      if (meta.chapterId) {
        await tx.chapter.update({
          where: { id: meta.chapterId },
          data: { totalDonations: { increment: amount } },
        });
      }
      return created;
    });

    if (!donation) return this.alreadyVerified(transaction.id);

    await runReceipt(
      () => this.storeReceipt(transaction, userId, amount, payment.paymentId || transaction.id, meta),
      options
    );

    return {
      message: 'Thank you for your donation!',
      donation,
      alreadyVerified: false,
    };
  }

  /**
   * Razorpay orders created before guest transactions existed have no row. Adopt such a
   * guest order from the order itself (amount from Razorpay, chapter/anonymity from its
   * notes) so it completes through the normal path. Returns the already-recorded result
   * when the old flow recorded it (tagged `donationId` note).
   */
  private async adoptLegacyGuestOrder(razorpayOrderId: string) {
    let order: any;
    try {
      order = await getRazorpayClient().orders.fetch(razorpayOrderId);
    } catch {
      throw new AppError('Payment order not found', 404, 'NOT_FOUND');
    }
    const notes = (order?.notes || {}) as Record<string, string>;
    if (!order || notes.type !== 'donation') {
      throw new AppError('Payment order not found', 404, 'NOT_FOUND');
    }
    if (notes.userId && notes.userId !== 'guest') {
      // Order belongs to a signed-in donor whose transaction is missing — refuse rather than misattribute.
      throw new AppError('Transaction not found', 404, 'NOT_FOUND');
    }

    if (notes.donationId) {
      const existing = await prisma.donation.findUnique({ where: { id: notes.donationId } });
      if (existing) return { message: 'Payment already verified', donation: existing, alreadyVerified: true };
    }

    const amountPaise = Number(order.amount);
    const metadata: DonationMetadata = {
      isAnonymous: notes.isAnonymous === 'true',
      chapterId: notes.chapterId || undefined,
      amountPaise,
      legacyOrder: true,
    };
    try {
      return await prisma.transaction.create({
        data: {
          userId: null,
          type: 'DONATION',
          amount: fromPaise(amountPaise),
          currency: order.currency || 'INR',
          status: 'PENDING',
          gatewayOrderId: razorpayOrderId,
          metadata: metadata as object,
        },
      });
    } catch (error) {
      // A concurrent verify adopted the order first (gatewayOrderId is unique).
      if ((error as { code?: string })?.code === 'P2002') {
        const existing = await prisma.transaction.findUnique({ where: { gatewayOrderId: razorpayOrderId } });
        if (existing) return existing;
      }
      throw error;
    }
  }

  private async alreadyVerified(transactionId: string) {
    const donation = await prisma.donation.findFirst({ where: { transactionId } });
    return { message: 'Payment already verified', donation, alreadyVerified: true };
  }

  private async storeReceipt(
    transaction: { id: string; createdAt?: Date },
    userId: string | null,
    amount: number,
    paymentId: string,
    meta: DonationMetadata
  ) {
    try {
      let donor: { name: string; email: string };
      if (userId) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return;
        donor = { name: user.fullName, email: user.email };
      } else {
        donor = guestDonorFromMetadata(meta);
      }
      const chapter = meta.chapterId ? await prisma.chapter.findUnique({ where: { id: meta.chapterId } }) : null;
      const receiptNumber = generateReceiptNumber('DON', transaction.id, transaction.createdAt || new Date());
      const receiptBuffer = await generateDonationReceipt({
        receiptNumber,
        donorName: donor.name,
        donorEmail: donor.email,
        amount,
        date: new Date(),
        paymentId,
        dedicatedTo: meta.dedicatedTo,
        message: meta.message,
        chapterName: chapter?.name,
      });

      // Guests have no account to download the receipt from, so it is e-mailed to them.
      if (!userId && donor.email) await this.emailGuestReceipt(donor, receiptNumber, amount, receiptBuffer);

      const receiptUrl = await uploadBufferToStorage(
        receiptBuffer,
        `receipt_${transaction.id}.pdf`,
        'application/pdf',
        'receipts'
      );
      await prisma.transaction.update({ where: { id: transaction.id }, data: { receiptUrl } });
    } catch (receiptError) {
      // Don't fail the payment if receipt generation fails
      console.error('Failed to generate/upload receipt:', receiptError);
    }
  }

  private async emailGuestReceipt(
    donor: { name: string; email: string },
    receiptNumber: string,
    amount: number,
    receipt: Buffer
  ) {
    try {
      const amountText = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
      await sendEmail({
        to: donor.email,
        subject: `Your donation receipt ${receiptNumber}`,
        html: `<p>Dear ${escapeHtml(donor.name)},</p>
<p>Thank you for your donation of ${amountText} to the AIEM Alumni Network. Your receipt (${receiptNumber}) is attached.</p>`,
        text: `Dear ${donor.name}, thank you for your donation of ${amountText} to the AIEM Alumni Network. Your receipt (${receiptNumber}) is attached.`,
        attachments: [{ filename: `${receiptNumber}.pdf`, content: receipt, contentType: 'application/pdf' }],
      });
    } catch (error) {
      console.error('Failed to e-mail guest donation receipt:', error);
    }
  }

  /** Public wall: non-anonymous, successful donations only. */
  async getDonorsWall(rawPage = 1, rawLimit = 20) {
    const { skip, take, page, limit } = paginationHelper(rawPage, rawLimit);
    const where = { isAnonymous: false, ...SUCCESSFUL_DONATION_WHERE };

    const [donations, total] = await Promise.all([
      prisma.donation.findMany({
        where,
        select: {
          id: true,
          amount: true,
          currency: true,
          dedicatedTo: true,
          message: true,
          isFeatured: true,
          createdAt: true,
          user: { select: PUBLIC_DONOR_SELECT },
          chapter: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.donation.count({ where }),
    ]);

    return buildPaginationResponse(donations, total, page, limit);
  }

  async getFeaturedDonors() {
    return prisma.donation.findMany({
      where: { isFeatured: true, isAnonymous: false, ...SUCCESSFUL_DONATION_WHERE },
      select: {
        id: true,
        amount: true,
        currency: true,
        dedicatedTo: true,
        message: true,
        createdAt: true,
        user: { select: PUBLIC_DONOR_SELECT },
      },
      orderBy: { amount: 'desc' },
      take: 10,
    });
  }

  async getChapterDonations() {
    return prisma.chapter.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        totalDonations: true,
        _count: { select: { donations: true } },
      },
      orderBy: { totalDonations: 'desc' },
    });
  }

  /** The caller's own donations (including anonymous ones). */
  async getUserDonations(userId: string) {
    if (!userId) throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    return prisma.donation.findMany({
      where: { userId },
      include: {
        chapter: { select: { id: true, name: true } },
        transaction: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Aggregates successful donations only. */
  async getDonationStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [total, count, thisMonth] = await Promise.all([
      prisma.donation.aggregate({ where: SUCCESSFUL_DONATION_WHERE, _sum: { amount: true } }),
      prisma.donation.count({ where: SUCCESSFUL_DONATION_WHERE }),
      prisma.donation.aggregate({
        where: { ...SUCCESSFUL_DONATION_WHERE, createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalAmount: toNumber(total?._sum?.amount),
      totalDonors: count || 0,
      donationCount: count || 0,
      thisMonthAmount: toNumber(thisMonth?._sum?.amount),
    };
  }

  // Admin: Feature a donor
  async featureDonor(donationId: string, featured: boolean) {
    const donation = await prisma.donation.findUnique({ where: { id: donationId } });
    if (!donation) throw new AppError('Donation not found', 404, 'NOT_FOUND');
    return prisma.donation.update({
      where: { id: donationId },
      data: { isFeatured: featured === true },
    });
  }

  /** Top identified donors by total; anonymous donations never contribute or appear. */
  async getDonationLeaderboard(rawLimit = 10) {
    const limit = Number.isFinite(rawLimit) ? Math.min(MAX_LEADERBOARD, Math.max(1, Math.floor(rawLimit))) : 10;

    const donors = await prisma.donation.groupBy({
      by: ['userId'],
      where: { userId: { not: null }, isAnonymous: false, ...SUCCESSFUL_DONATION_WHERE },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: limit,
    });

    if (donors.length === 0) return [];

    const userIds = donors.map((d) => d.userId as string);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: PUBLIC_DONOR_SELECT,
    });

    return donors
      .map((d) => ({
        user: users.find((u) => u.id === d.userId),
        totalAmount: toNumber(d._sum?.amount),
      }))
      .filter((entry) => entry.user);
  }
}

export const donationService = new DonationService();
