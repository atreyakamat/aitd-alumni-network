import type { Prisma, Transaction, TransactionType } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { clientLinks } from '../utils/clientLinks';
import { logAuditAction } from './auditService';
import { donationService } from './donationService';
import { membershipService } from './membershipService';
import { notificationService } from './notificationService';

/**
 * Razorpay webhook processing (PRD revenue domain).
 *
 * The webhook is the server-to-server source of truth for payment state, so a
 * payment still completes when the customer closes the browser before the
 * client-side verify call. Completion reuses the exact code path of the verify
 * endpoints (`completeTransaction`), whose status-guarded claim makes verify,
 * webhook and redelivered webhooks race-safe and idempotent.
 *
 * Signature verification happens in the controller, against the raw body.
 */

/** Subset of the Razorpay webhook envelope this service reads. */
export interface RazorpayWebhookEvent {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayPaymentEntity };
    order?: { entity?: RazorpayOrderEntity };
  };
}

interface RazorpayPaymentEntity {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
}

interface RazorpayOrderEntity {
  id?: string;
  amount?: number;
  amount_paid?: number;
  currency?: string;
  status?: string;
}

export type WebhookOutcome =
  | 'completed'
  | 'already_completed'
  | 'marked_failed'
  | 'amount_mismatch'
  | 'unknown_order'
  | 'unprocessable'
  | 'unsupported_event'
  | 'ignored';

export interface WebhookResult {
  outcome: WebhookOutcome;
  transactionId?: string;
}

export interface WebhookContext {
  /** `X-Razorpay-Event-Id`, logged for tracing redeliveries. */
  eventId?: string;
}

interface PaidNotice {
  orderId?: string;
  paymentId?: string;
  amountPaise?: number;
  currency?: string;
}

/** Audit payload (`newValues`) of a PAYMENT_MISMATCH entry. */
export interface PaymentMismatch {
  event: string;
  eventId: string | null;
  orderId: string;
  paymentId: string | null;
  transactionType: TransactionType;
  expectedPaise: number;
  receivedPaise: number | null;
  expectedCurrency: string;
  receivedCurrency: string | null;
}

export const SUPPORTED_WEBHOOK_EVENTS = ['payment.captured', 'order.paid', 'payment.failed'] as const;

const log = (message: string, details: Record<string, unknown>) =>
  console.log(`[razorpay-webhook] ${message}`, details);

/** Amount Razorpay was asked to collect, in integer paise (server-side truth). */
const expectedPaise = (transaction: Transaction) => Math.round(Number(transaction.amount) * 100);

export class PaymentWebhookService {
  async handleEvent(event: RazorpayWebhookEvent, context: WebhookContext = {}): Promise<WebhookResult> {
    const payment = event.payload?.payment?.entity;

    switch (event.event) {
      case 'payment.captured':
        return this.handlePaid(
          { orderId: payment?.order_id, paymentId: payment?.id, amountPaise: payment?.amount, currency: payment?.currency },
          event.event,
          context
        );

      case 'order.paid': {
        const order = event.payload?.order?.entity;
        return this.handlePaid(
          {
            orderId: order?.id,
            paymentId: payment?.id,
            amountPaise: order?.amount_paid ?? payment?.amount,
            currency: order?.currency ?? payment?.currency,
          },
          event.event,
          context
        );
      }

      case 'payment.failed':
        return this.handleFailed(payment?.order_id, payment?.id, context);

      default:
        log('ignoring unsupported event', { event: event.event, eventId: context.eventId });
        return { outcome: 'unsupported_event' };
    }
  }

  private async handlePaid(notice: PaidNotice, eventName: string, context: WebhookContext): Promise<WebhookResult> {
    const { orderId, paymentId } = notice;
    if (!orderId) {
      log('event without an order id', { event: eventName, eventId: context.eventId });
      return { outcome: 'ignored' };
    }

    const transaction = await prisma.transaction.findUnique({ where: { gatewayOrderId: orderId } });
    if (!transaction) {
      // Every order (member or guest) gets a PENDING row at order time, so this is a foreign
      // order or a guest order created before that; the latter is still recorded by client verify.
      log('no transaction for order', { event: eventName, orderId, eventId: context.eventId });
      return { outcome: 'unknown_order' };
    }

    if (transaction.status === 'SUCCESS') {
      return { outcome: 'already_completed', transactionId: transaction.id };
    }
    if (transaction.status === 'REFUNDED') {
      log('ignoring payment for a refunded transaction', { orderId, transactionId: transaction.id, eventId: context.eventId });
      return { outcome: 'ignored', transactionId: transaction.id };
    }

    const expected = expectedPaise(transaction);
    const currencyMatches = !notice.currency || notice.currency === transaction.currency;
    if (notice.amountPaise !== expected || !currencyMatches) {
      // Leave the transaction as-is for manual reconciliation: never grant a membership or
      // credit a donation for an amount we did not price, but do not hide money received
      // by marking it FAILED either. The mismatch is audited and admins are notified.
      const mismatch: PaymentMismatch = {
        event: eventName,
        eventId: context.eventId ?? null,
        orderId,
        paymentId: paymentId ?? null,
        transactionType: transaction.type,
        expectedPaise: expected,
        receivedPaise: notice.amountPaise ?? null,
        expectedCurrency: transaction.currency,
        receivedCurrency: notice.currency ?? null,
      };
      console.warn('[razorpay-webhook] paid amount does not match transaction; left for reconciliation', {
        transactionId: transaction.id,
        ...mismatch,
      });
      await this.reportMismatch(transaction.id, mismatch);
      return { outcome: 'amount_mismatch', transactionId: transaction.id };
    }

    const service = transaction.type === 'MEMBERSHIP' ? membershipService : donationService;
    try {
      const result = await service.completeTransaction(transaction, { paymentId }, { deferReceipt: true });
      return { outcome: result.alreadyVerified ? 'already_completed' : 'completed', transactionId: transaction.id };
    } catch (error) {
      // Business-rule failures will not fix themselves on redelivery: acknowledge and log.
      // Anything else (e.g. database outage) propagates so Razorpay retries.
      if (error instanceof AppError) {
        console.error('[razorpay-webhook] could not complete transaction', {
          orderId,
          transactionId: transaction.id,
          code: error.code,
          message: error.message,
          eventId: context.eventId,
        });
        return { outcome: 'unprocessable', transactionId: transaction.id };
      }
      throw error;
    }
  }

  /**
   * Makes an amount/currency mismatch durable and visible: one PAYMENT_MISMATCH audit entry
   * (entity TRANSACTION) per transaction + payment, and an in-app notification to every
   * active ADMIN/SUPER_ADMIN. Redeliveries and the paired payment.captured/order.paid events
   * for the same payment are deduplicated. Best-effort: failures here never fail the webhook.
   */
  private async reportMismatch(transactionId: string, mismatch: PaymentMismatch) {
    try {
      const previous = (await prisma.auditLog.findMany({
        where: { action: 'PAYMENT_MISMATCH', entityType: 'TRANSACTION', entityId: transactionId },
        select: { newValues: true },
        take: 50,
      })) || [];
      const alreadyReported = previous.some((entry) => {
        const values = (entry.newValues || {}) as Partial<PaymentMismatch>;
        return (values.paymentId ?? null) === mismatch.paymentId && (values.receivedPaise ?? null) === mismatch.receivedPaise;
      });
      if (alreadyReported) return;

      await logAuditAction({
        action: 'PAYMENT_MISMATCH',
        entityType: 'TRANSACTION',
        entityId: transactionId,
        newValues: mismatch as unknown as Prisma.InputJsonValue,
      });

      const admins = (await prisma.user.findMany({
        where: { userRole: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
        select: { id: true },
      })) || [];
      const received =
        mismatch.receivedPaise === null ? 'an unknown amount' : `${mismatch.receivedPaise} paise ${mismatch.receivedCurrency ?? ''}`.trim();
      await Promise.all(
        admins.map((admin) =>
          notificationService
            .createNotification({
              userId: admin.id,
              type: 'ADMIN_ANNOUNCEMENT',
              title: 'Payment needs reconciliation',
              message: `Razorpay order ${mismatch.orderId} was paid ${received}, but ${mismatch.expectedPaise} paise ${mismatch.expectedCurrency} was expected. The ${mismatch.transactionType.toLowerCase()} was not completed.`,
              link: clientLinks.adminAudit('PAYMENT_MISMATCH'),
              metadata: { transactionId, ...mismatch },
            })
            .catch((error) => console.error('[razorpay-webhook] could not notify admin of mismatch', error))
        )
      );
    } catch (error) {
      console.error('[razorpay-webhook] could not record payment mismatch', { transactionId, error });
    }
  }

  private async handleFailed(orderId: string | undefined, paymentId: string | undefined, context: WebhookContext) {
    if (!orderId) {
      log('payment.failed without an order id', { eventId: context.eventId });
      return { outcome: 'ignored' } as WebhookResult;
    }

    // Only PENDING moves to FAILED: a SUCCESS (or REFUNDED) transaction is never downgraded
    // by a late failure notice for an earlier attempt on the same order.
    const updated = await prisma.transaction.updateMany({
      where: { gatewayOrderId: orderId, status: 'PENDING' },
      data: { status: 'FAILED', gatewayPaymentId: paymentId },
    });
    if (updated.count === 0) {
      log('payment.failed did not match a pending transaction', { orderId, eventId: context.eventId });
      return { outcome: 'ignored' } as WebhookResult;
    }
    return { outcome: 'marked_failed' } as WebhookResult;
  }
}

export const paymentWebhookService = new PaymentWebhookService();
