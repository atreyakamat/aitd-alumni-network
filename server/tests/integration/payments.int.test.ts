/**
 * Payments against a real PostgreSQL database: guest and member donation orders get a
 * durable PENDING transaction that a genuinely signed Razorpay webhook completes;
 * amount mismatches are audited and surfaced to admins; financial records survive
 * a hard user delete (Transaction.userId ON DELETE SET NULL).
 *
 * Only the Razorpay SDK (order creation) and receipt storage are faked; webhook and
 * checkout signatures are real HMACs.
 */
import crypto from 'crypto';

// Plain functions (not jest.fn) so afterEach's restoreAllMocks cannot strip them.
jest.mock('razorpay', () => {
  let orderSeq = 0;
  return class FakeRazorpay {
    orders = {
      create: async (params: { amount: number; currency: string; notes: Record<string, string> }) => ({
        id: `order_int_${Date.now()}_${++orderSeq}`,
        amount: params.amount,
        currency: params.currency,
        notes: params.notes,
        status: 'created',
      }),
    };
  };
});
// Receipts would otherwise be written to server/uploads.
jest.mock('../../src/utils/storage', () => ({
  ...jest.requireActual('../../src/utils/storage'),
  uploadBufferToStorage: async () => 'https://cdn.test/receipts/int.pdf',
}));

import config from '../../src/config';
import * as email from '../../src/utils/email';
import { resetRazorpayClient } from '../../src/utils/razorpay';
import { createUser, http, prisma } from './helpers';

const KEY_SECRET = 'int_key_secret';
const WEBHOOK_SECRET = 'int_webhook_secret';
const original = { ...config.razorpay };

beforeAll(() => {
  config.razorpay.keyId = 'rzp_test_int';
  config.razorpay.keySecret = KEY_SECRET;
  config.razorpay.webhookSecret = WEBHOOK_SECRET;
  resetRazorpayClient();
});

afterAll(async () => {
  Object.assign(config.razorpay, original);
  resetRazorpayClient();
  await prisma.$disconnect();
});

const sendMail = () => jest.spyOn(email, 'sendEmail').mockResolvedValue(undefined);
afterEach(() => jest.restoreAllMocks());

const deliver = (event: Record<string, unknown>, secret = WEBHOOK_SECRET) => {
  const body = JSON.stringify(event);
  return http()
    .post('/api/payments/webhook/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', crypto.createHmac('sha256', secret).update(body).digest('hex'))
    .set('X-Razorpay-Event-Id', `evt_${crypto.randomUUID()}`)
    .send(body);
};

const captured = (orderId: string, amount: number, paymentId = `pay_${crypto.randomUUID().slice(0, 12)}`) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: 'INR', status: 'captured' } } },
});

const checkoutSignature = (orderId: string, paymentId: string) =>
  crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

/** Webhook receipts are generated in the background; wait for the stored URL. */
const waitForReceipt = async (transactionId: string) => {
  for (let i = 0; i < 100; i++) {
    const t = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (t?.receiptUrl) return t;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('receipt was never stored');
};

const createChapter = () =>
  prisma.chapter.create({ data: { name: `Payments Chapter ${crypto.randomUUID()}`, region: 'West' } });

describe('guest donations', () => {
  it('creates a PENDING guest transaction that a signed webhook completes from server-side data', async () => {
    const mail = sendMail();
    const chapter = await createChapter();

    const order = await http().post('/api/donations/order').send({
      amount: 250.5,
      isAnonymous: false,
      message: 'For the library',
      chapterId: chapter.id,
      donorName: 'Guest Donor',
      donorEmail: 'Guest.Donor@Example.com',
    });
    expect(order.status).toBe(200);
    const { orderId, amount } = order.body.data;
    expect(amount).toBe(25050);

    const pending = await prisma.transaction.findUnique({ where: { gatewayOrderId: orderId } });
    expect(pending).toMatchObject({ userId: null, type: 'DONATION', status: 'PENDING' });
    expect(Number(pending!.amount)).toBe(250.5);
    expect(pending!.metadata).toMatchObject({
      donorName: 'Guest Donor',
      donorEmail: 'guest.donor@example.com',
      message: 'For the library',
      chapterId: chapter.id,
      amountPaise: 25050,
    });

    // A forged delivery is rejected and changes nothing.
    expect((await deliver(captured(orderId, 25050), 'wrong-secret')).status).toBe(400);

    const paymentId = 'pay_guest_int_1';
    const res = await deliver(captured(orderId, 25050, paymentId));
    expect(res.status).toBe(200);

    const done = await waitForReceipt(pending!.id);
    expect(done).toMatchObject({ status: 'SUCCESS', gatewayPaymentId: paymentId, userId: null });
    const donations = await prisma.donation.findMany({ where: { transactionId: pending!.id } });
    expect(donations).toHaveLength(1);
    expect(donations[0]).toMatchObject({ userId: null, isAnonymous: false, message: 'For the library', chapterId: chapter.id });
    expect(Number(donations[0].amount)).toBe(250.5);
    expect(Number((await prisma.chapter.findUnique({ where: { id: chapter.id } }))!.totalDonations)).toBe(250.5);

    // The receipt is e-mailed to the guest.
    expect(mail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guest.donor@example.com',
        attachments: [expect.objectContaining({ contentType: 'application/pdf' })],
      })
    );

    // Redelivery and the late client verify are both idempotent.
    expect((await deliver(captured(orderId, 25050, paymentId))).status).toBe(200);
    const verify = await http().post('/api/donations/verify').send({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: checkoutSignature(orderId, paymentId),
    });
    expect(verify.status).toBe(200);
    expect(verify.body.data.alreadyVerified).toBe(true);
    expect(await prisma.donation.count({ where: { transactionId: pending!.id } })).toBe(1);
    expect(Number((await prisma.chapter.findUnique({ where: { id: chapter.id } }))!.totalDonations)).toBe(250.5);

    // Public stats count the guest donation.
    const wall = await http().get('/api/donations/wall?limit=100');
    expect(wall.body.data.some((d: { id: string }) => d.id === donations[0].id)).toBe(true);
  });

  it('completes through the client verify path when the webhook has not arrived', async () => {
    sendMail();
    const order = await http().post('/api/donations/order').send({ amount: 100, isAnonymous: true });
    const { orderId } = order.body.data;
    const paymentId = 'pay_guest_int_2';

    const verify = await http().post('/api/donations/verify').send({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: checkoutSignature(orderId, paymentId),
      // Ignored: the amount comes from the stored transaction.
      amount: 999999,
    });
    expect(verify.status).toBe(200);
    expect(verify.body.data.alreadyVerified).toBe(false);
    expect(verify.body.data.donation).toMatchObject({ userId: null, isAnonymous: true });
    expect(Number(verify.body.data.donation.amount)).toBe(100);

    // The webhook arriving afterwards is a no-op.
    expect((await deliver(captured(orderId, 10000, paymentId))).status).toBe(200);
    const t = await prisma.transaction.findUnique({ where: { gatewayOrderId: orderId } });
    expect(await prisma.donation.count({ where: { transactionId: t!.id } })).toBe(1);
  });
});

describe('payment mismatches', () => {
  it('leaves the transaction PENDING, audits the mismatch once and notifies admins', async () => {
    const superAdmin = await createUser('SUPER_ADMIN');
    const order = await http().post('/api/donations/order').send({ amount: 500 });
    const { orderId } = order.body.data;
    const t = await prisma.transaction.findUnique({ where: { gatewayOrderId: orderId } });

    const event = captured(orderId, 100, 'pay_short_int');
    expect((await deliver(event)).status).toBe(200);
    expect((await deliver(event)).status).toBe(200); // redelivery

    expect((await prisma.transaction.findUnique({ where: { id: t!.id } }))!.status).toBe('PENDING');
    expect(await prisma.donation.count({ where: { transactionId: t!.id } })).toBe(0);

    const audits = await prisma.auditLog.findMany({ where: { action: 'PAYMENT_MISMATCH', entityId: t!.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityType: 'TRANSACTION' });
    expect(audits[0].newValues).toMatchObject({
      orderId,
      paymentId: 'pay_short_int',
      expectedPaise: 50000,
      receivedPaise: 100,
      expectedCurrency: 'INR',
      receivedCurrency: 'INR',
    });

    const notes = await prisma.notification.findMany({ where: { userId: superAdmin.user.id } });
    expect(notes.filter((n) => (n.metadata as { transactionId?: string } | null)?.transactionId === t!.id)).toHaveLength(1);

    // Admins can find it through the audit API.
    const list = await http()
      .get(`/api/admin/audit?action=PAYMENT_MISMATCH&entityType=TRANSACTION`)
      .set('Authorization', superAdmin.auth);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(t!.id);
  });
});

describe('member donations and user deletion', () => {
  it('keeps the member path and preserves financial records with userId NULL after a hard user delete', async () => {
    sendMail();
    const member = await createUser('MEMBER');
    const order = await http()
      .post('/api/donations/order')
      .set('Authorization', member.auth)
      .send({ amount: 300, donorName: 'Ignored For Members' });
    expect(order.status).toBe(200);
    const { orderId } = order.body.data;
    const t = await prisma.transaction.findUnique({ where: { gatewayOrderId: orderId } });
    expect(t).toMatchObject({ userId: member.user.id, status: 'PENDING' });
    expect((t!.metadata as Record<string, unknown>).donorName).toBeUndefined();

    // A guest cannot verify a member's order.
    const paymentId = 'pay_member_int';
    const signature = checkoutSignature(orderId, paymentId);
    const asGuest = await http()
      .post('/api/donations/verify')
      .send({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature });
    expect(asGuest.status).toBe(403);

    expect((await deliver(captured(orderId, 30000, paymentId))).status).toBe(200);
    await waitForReceipt(t!.id);
    const donation = await prisma.donation.findFirst({ where: { transactionId: t!.id } });
    expect(donation).toMatchObject({ userId: member.user.id });

    await prisma.user.delete({ where: { id: member.user.id } });

    const kept = await prisma.transaction.findUnique({ where: { id: t!.id } });
    expect(kept).toMatchObject({ status: 'SUCCESS', userId: null, gatewayPaymentId: paymentId });
    expect(await prisma.donation.findUnique({ where: { id: donation!.id } })).toMatchObject({ userId: null });
  });
});
