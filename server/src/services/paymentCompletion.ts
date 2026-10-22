import type { Prisma, TransactionStatus } from '@prisma/client';

/**
 * Shared pieces of the payment completion path used by both the client-side
 * verify endpoints and the Razorpay webhook.
 */

/** Gateway details recorded when a transaction is completed. */
export interface GatewayPayment {
  paymentId?: string;
  /** Checkout signature (client verify only; webhooks are authenticated by their own HMAC). */
  signature?: string;
}

export interface CompletionOptions {
  /** Generate/upload the receipt in the background (webhooks must answer quickly). */
  deferReceipt?: boolean;
}

/**
 * Statuses a completion may claim. FAILED is included because Razorpay lets a
 * customer retry on the same order after a failed attempt.
 */
export const CLAIMABLE_STATUSES: TransactionStatus[] = ['PENDING', 'FAILED'];

/**
 * Status-guarded claim: a conditional updateMany so that, of any number of
 * concurrent completers (client verify, webhook, redelivered webhook), exactly
 * one flips the row to SUCCESS. Returns true when this caller won the claim.
 */
export const claimTransaction = async (
  tx: Prisma.TransactionClient,
  transactionId: string,
  payment: GatewayPayment
): Promise<boolean> => {
  const data: Prisma.TransactionUpdateManyMutationInput = { status: 'SUCCESS' };
  if (payment.paymentId) data.gatewayPaymentId = payment.paymentId;
  if (payment.signature) data.gatewaySignature = payment.signature;

  const claimed = await tx.transaction.updateMany({
    where: { id: transactionId, status: { in: CLAIMABLE_STATUSES } },
    data,
  });
  return claimed.count > 0;
};

/** Runs a best-effort side effect now, or in the background when deferred. */
export const runReceipt = async (task: () => Promise<void>, options: CompletionOptions = {}) => {
  if (options.deferReceipt) {
    // The task swallows its own errors; this catch only guards against bugs.
    task().catch((error) => console.error('Deferred receipt generation failed:', error));
    return;
  }
  await task();
};
