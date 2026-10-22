jest.mock('../../utils/storage', () => ({
  uploadBufferToStorage: jest.fn().mockResolvedValue('https://cdn.test/receipts/w.pdf'),
}));
jest.mock('../../utils/pdfReceipt', () => {
  const actual = jest.requireActual('../../utils/pdfReceipt');
  return {
    ...actual,
    generateDonationReceipt: jest.fn().mockResolvedValue(Buffer.from('%PDF-')),
    generateMembershipReceipt: jest.fn().mockResolvedValue(Buffer.from('%PDF-')),
  };
});

import { prismaMock } from '../../../tests/helpers';
import { paymentWebhookService } from '../../services/paymentWebhookService';
import { donationService } from '../../services/donationService';
import { membershipService } from '../../services/membershipService';

const USER = 'user-1';

const donationTxn = (overrides: Record<string, unknown> = {}) => ({
  id: 'txn-d',
  userId: USER,
  type: 'DONATION',
  amount: 500.5,
  currency: 'INR',
  status: 'PENDING',
  gatewayOrderId: 'order_d',
  metadata: { isAnonymous: false, chapterId: 'ch-1', amountPaise: 50050 },
  createdAt: new Date('2026-02-03T00:00:00Z'),
  ...overrides,
});

const membershipTxn = (overrides: Record<string, unknown> = {}) => ({
  id: 'txn-m',
  userId: USER,
  type: 'MEMBERSHIP',
  amount: 999,
  currency: 'INR',
  status: 'PENDING',
  gatewayOrderId: 'order_m',
  metadata: { tierId: 'tier-1', amountPaise: 99900 },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const captured = (orderId: string, amount: number, extra: Record<string, unknown> = {}) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_1', order_id: orderId, amount, currency: 'INR', status: 'captured', ...extra } } },
});

const orderPaid = (orderId: string, amountPaid: number, paymentId: string | null = 'pay_2') => ({
  event: 'order.paid',
  payload: {
    order: { entity: { id: orderId, amount: amountPaid, amount_paid: amountPaid, currency: 'INR', status: 'paid' } },
    ...(paymentId ? { payment: { entity: { id: paymentId, order_id: orderId, amount: amountPaid, currency: 'INR' } } } : {}),
  },
});

const failed = (orderId: string) => ({
  event: 'payment.failed',
  payload: { payment: { entity: { id: 'pay_f', order_id: orderId, amount: 100, currency: 'INR', status: 'failed' } } },
});

// Webhook completions generate receipts in the background; let them settle inside the test that started them.
afterEach(() => new Promise((resolve) => setImmediate(resolve)));

const arrangeDonation = (t = donationTxn()) => {
  prismaMock.transaction.findUnique.mockResolvedValue(t);
  prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.donation.create.mockImplementation(async ({ data }: any) => ({ id: 'don-1', ...data }));
  prismaMock.user.findUnique.mockResolvedValue({ id: USER, fullName: 'U', email: 'u@x.y' });
  prismaMock.chapter.findUnique.mockResolvedValue({ id: 'ch-1', name: 'Pune' });
};

const arrangeMembership = (t = membershipTxn()) => {
  prismaMock.transaction.findUnique.mockResolvedValue(t);
  prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.membershipTier.findUnique.mockResolvedValue({ id: 'tier-1', name: 'Gold', durationMonths: 12, isActive: true });
  prismaMock.userMembership.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.userMembership.create.mockImplementation(async ({ data }: any) => ({ id: 'mem-1', ...data }));
  prismaMock.user.findUnique.mockResolvedValue({ id: USER, fullName: 'U', email: 'u@x.y' });
};

describe('payment.captured', () => {
  it('completes a PENDING donation through the shared completion path', async () => {
    arrangeDonation();
    const result = await paymentWebhookService.handleEvent(captured('order_d', 50050));

    expect(result).toEqual({ outcome: 'completed', transactionId: 'txn-d' });
    expect(prismaMock.transaction.findUnique).toHaveBeenCalledWith({ where: { gatewayOrderId: 'order_d' } });
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'txn-d', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SUCCESS', gatewayPaymentId: 'pay_1' },
    });
    expect(prismaMock.donation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: USER, amount: 500.5, chapterId: 'ch-1', transactionId: 'txn-d' }),
    });
    expect(prismaMock.chapter.update).toHaveBeenCalledWith({
      where: { id: 'ch-1' },
      data: { totalDonations: { increment: 500.5 } },
    });
  });

  it('activates a PENDING membership', async () => {
    arrangeMembership();
    const result = await paymentWebhookService.handleEvent(captured('order_m', 99900));

    expect(result).toEqual({ outcome: 'completed', transactionId: 'txn-m' });
    expect(prismaMock.userMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: USER, tierId: 'tier-1', status: 'ACTIVE', transactionId: 'txn-m' }),
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: USER }, data: { membershipTierId: 'tier-1' } });
  });

  it('completes a previously FAILED transaction (a retried payment on the same order succeeded)', async () => {
    arrangeDonation(donationTxn({ status: 'FAILED' }));
    const result = await paymentWebhookService.handleEvent(captured('order_d', 50050));
    expect(result.outcome).toBe('completed');
  });

  it('is a no-op for an already-SUCCESS transaction', async () => {
    arrangeDonation(donationTxn({ status: 'SUCCESS' }));
    const result = await paymentWebhookService.handleEvent(captured('order_d', 50050));
    expect(result).toEqual({ outcome: 'already_completed', transactionId: 'txn-d' });
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
  });

  it('does not double-complete when the client verify call wins the race (claim count 0)', async () => {
    arrangeDonation();
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.donation.findFirst.mockResolvedValue({ id: 'don-winner' });
    const result = await paymentWebhookService.handleEvent(captured('order_d', 50050));
    expect(result).toEqual({ outcome: 'already_completed', transactionId: 'txn-d' });
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
    expect(prismaMock.chapter.update).not.toHaveBeenCalled();
  });

  it('is idempotent across a redelivered event', async () => {
    arrangeMembership();
    await paymentWebhookService.handleEvent(captured('order_m', 99900));
    prismaMock.transaction.findUnique.mockResolvedValue(membershipTxn({ status: 'SUCCESS' }));
    const second = await paymentWebhookService.handleEvent(captured('order_m', 99900));
    expect(second.outcome).toBe('already_completed');
    expect(prismaMock.userMembership.create).toHaveBeenCalledTimes(1);
  });

  it('leaves the transaction untouched when the paid amount does not match', async () => {
    arrangeDonation();
    const result = await paymentWebhookService.handleEvent(captured('order_d', 100));
    expect(result).toEqual({ outcome: 'amount_mismatch', transactionId: 'txn-d' });
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('records a mismatch durably in the audit log and notifies active admins', async () => {
    arrangeDonation();
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'super-1' }]);
    prismaMock.notification.create.mockImplementation(async ({ data }: any) => ({ id: 'n', ...data }));

    const result = await paymentWebhookService.handleEvent(captured('order_d', 100), { eventId: 'evt_1' });

    expect(result.outcome).toBe('amount_mismatch');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PAYMENT_MISMATCH',
        entityType: 'TRANSACTION',
        entityId: 'txn-d',
        newValues: {
          event: 'payment.captured',
          eventId: 'evt_1',
          orderId: 'order_d',
          paymentId: 'pay_1',
          transactionType: 'DONATION',
          expectedPaise: 50050,
          receivedPaise: 100,
          expectedCurrency: 'INR',
          receivedCurrency: 'INR',
        },
      }),
    });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { userRole: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
      select: { id: true },
    });
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
    const note = prismaMock.notification.create.mock.calls[0][0].data;
    expect(note).toMatchObject({ userId: 'admin-1', type: 'ADMIN_ANNOUNCEMENT', link: '/admin/audit?action=PAYMENT_MISMATCH' });
    expect(note.message).toContain('order_d');
    expect(note.metadata).toMatchObject({ transactionId: 'txn-d', expectedPaise: 50050, receivedPaise: 100 });
  });

  it('does not re-audit or re-notify a redelivered mismatch for the same payment', async () => {
    arrangeDonation();
    prismaMock.auditLog.findMany.mockResolvedValue([{ newValues: { paymentId: 'pay_1', receivedPaise: 100 } }]);
    const result = await paymentWebhookService.handleEvent(captured('order_d', 100));
    expect(result.outcome).toBe('amount_mismatch');
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('still acknowledges a mismatch when admin notification fails', async () => {
    arrangeDonation();
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockRejectedValue(new Error('db hiccup'));
    const result = await paymentWebhookService.handleEvent(captured('order_d', 100));
    expect(result.outcome).toBe('amount_mismatch');
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });

  it('treats a missing amount or a different currency as a mismatch', async () => {
    arrangeDonation();
    const noAmount = captured('order_d', 50050);
    delete (noAmount.payload.payment.entity as any).amount;
    expect((await paymentWebhookService.handleEvent(noAmount)).outcome).toBe('amount_mismatch');
    expect((await paymentWebhookService.handleEvent(captured('order_d', 50050, { currency: 'USD' }))).outcome).toBe(
      'amount_mismatch'
    );
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('completes a guest donation from the metadata stored at order time', async () => {
    arrangeDonation(
      donationTxn({
        userId: null,
        metadata: {
          isAnonymous: true,
          message: 'From a friend',
          chapterId: 'ch-1',
          amountPaise: 50050,
          donorName: 'Guest Donor',
          donorEmail: 'guest@example.com',
        },
      })
    );
    const result = await paymentWebhookService.handleEvent(captured('order_d', 50050));

    expect(result).toEqual({ outcome: 'completed', transactionId: 'txn-d' });
    expect(prismaMock.donation.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        amount: 500.5,
        isAnonymous: true,
        dedicatedTo: undefined,
        message: 'From a friend',
        chapterId: 'ch-1',
        transactionId: 'txn-d',
      },
    });
    // The deferred receipt goes to the guest from metadata; no user lookup.
    await new Promise((resolve) => setImmediate(resolve));
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('acknowledges unknown orders without writing', async () => {
    prismaMock.transaction.findUnique.mockResolvedValue(null);
    const result = await paymentWebhookService.handleEvent(captured('order_unknown', 100));
    expect(result).toEqual({ outcome: 'unknown_order' });
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('ignores refunded transactions', async () => {
    arrangeDonation(donationTxn({ status: 'REFUNDED' }));
    const result = await paymentWebhookService.handleEvent(captured('order_d', 50050));
    expect(result.outcome).toBe('ignored');
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('ignores payloads without an order id', async () => {
    const result = await paymentWebhookService.handleEvent({ event: 'payment.captured', payload: {} });
    expect(result.outcome).toBe('ignored');
    expect(prismaMock.transaction.findUnique).not.toHaveBeenCalled();
  });

  it('acknowledges business errors from completion (e.g. missing tier metadata) instead of retrying forever', async () => {
    arrangeMembership(membershipTxn({ metadata: null }));
    const result = await paymentWebhookService.handleEvent(captured('order_m', 99900));
    expect(result).toEqual({ outcome: 'unprocessable', transactionId: 'txn-m' });
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('rethrows unexpected errors so Razorpay retries the delivery', async () => {
    arrangeDonation();
    prismaMock.$transaction.mockRejectedValue(new Error('db down'));
    await expect(paymentWebhookService.handleEvent(captured('order_d', 50050))).rejects.toThrow('db down');
  });

  it('dispatches by transaction type to the matching service', async () => {
    const don = jest.spyOn(donationService, 'completeTransaction');
    const mem = jest.spyOn(membershipService, 'completeTransaction');
    arrangeMembership();
    await paymentWebhookService.handleEvent(captured('order_m', 99900));
    expect(mem).toHaveBeenCalledWith(expect.objectContaining({ id: 'txn-m' }), { paymentId: 'pay_1' }, { deferReceipt: true });
    expect(don).not.toHaveBeenCalled();
    don.mockRestore();
    mem.mockRestore();
  });
});

describe('order.paid', () => {
  it('completes using order.amount_paid and the attached payment id', async () => {
    arrangeDonation();
    const result = await paymentWebhookService.handleEvent(orderPaid('order_d', 50050));
    expect(result.outcome).toBe('completed');
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'txn-d', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SUCCESS', gatewayPaymentId: 'pay_2' },
    });
  });

  it('works without an attached payment entity', async () => {
    arrangeDonation();
    const result = await paymentWebhookService.handleEvent(orderPaid('order_d', 50050, null));
    expect(result.outcome).toBe('completed');
    expect(prismaMock.transaction.updateMany.mock.calls[0][0].data).toEqual({ status: 'SUCCESS' });
  });

  it('rejects a short payment', async () => {
    arrangeDonation();
    const result = await paymentWebhookService.handleEvent(orderPaid('order_d', 50000));
    expect(result.outcome).toBe('amount_mismatch');
  });
});

describe('payment.failed', () => {
  it('marks only a PENDING transaction FAILED', async () => {
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    const result = await paymentWebhookService.handleEvent(failed('order_d'));
    expect(result).toEqual({ outcome: 'marked_failed' });
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { gatewayOrderId: 'order_d', status: 'PENDING' },
      data: { status: 'FAILED', gatewayPaymentId: 'pay_f' },
    });
  });

  it('never downgrades a SUCCESS (or unknown) transaction', async () => {
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 0 });
    const result = await paymentWebhookService.handleEvent(failed('order_d'));
    expect(result).toEqual({ outcome: 'ignored' });
  });

  it('ignores a payload without an order id', async () => {
    const result = await paymentWebhookService.handleEvent({ event: 'payment.failed', payload: { payment: { entity: {} } } });
    expect(result.outcome).toBe('ignored');
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
  });
});

describe('other events', () => {
  it('acknowledges unsupported events without touching the database', async () => {
    const result = await paymentWebhookService.handleEvent({ event: 'refund.created', payload: {} });
    expect(result).toEqual({ outcome: 'unsupported_event' });
    expect(prismaMock.transaction.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
  });
});
