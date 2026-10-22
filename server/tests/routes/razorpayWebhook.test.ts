/**
 * HTTP-level tests for POST /api/payments/webhook/razorpay.
 *
 * Signatures are real HMAC-SHA256 digests of the exact bytes sent, proving the
 * endpoint verifies the raw body (not the parsed + sanitised one).
 */
jest.mock('../../src/utils/storage', () => ({
  ...jest.requireActual('../../src/utils/storage'),
  uploadBufferToStorage: jest.fn().mockResolvedValue('https://cdn.test/receipts/w.pdf'),
}));
jest.mock('../../src/utils/pdfReceipt', () => {
  const actual = jest.requireActual('../../src/utils/pdfReceipt');
  return { ...actual, generateDonationReceipt: jest.fn().mockResolvedValue(Buffer.from('%PDF-')) };
});

import crypto from 'crypto';
import request from 'supertest';
import config from '../../src/config';
import { createApp } from '../../src/app';
import { api, prismaMock } from '../helpers';

const PATH = '/api/payments/webhook/razorpay';
const SECRET = 'whsec_test_secret';
const sign = (raw: string, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex');

// Pretty-printed and containing markup: re-serialising or sanitising the parsed body would change the bytes.
const rawEvent = (event: string, orderId = 'order_1', amount = 50000) =>
  JSON.stringify(
    {
      entity: 'event',
      event,
      payload: {
        payment: {
          entity: {
            id: 'pay_1',
            order_id: orderId,
            amount,
            currency: 'INR',
            notes: { message: '<b>Thanks</b>   for   everything' },
          },
        },
      },
    },
    null,
    2
  );

const post = (raw: string, signature?: string, headers: Record<string, string> = {}) => {
  let req = api().post(PATH).set('Content-Type', 'application/json');
  if (signature !== undefined) req = req.set('X-Razorpay-Signature', signature);
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  return req.send(raw);
};

const pendingDonation = (overrides: Record<string, unknown> = {}) => ({
  id: 'txn-1',
  userId: 'user-1',
  type: 'DONATION',
  amount: 500,
  currency: 'INR',
  status: 'PENDING',
  gatewayOrderId: 'order_1',
  metadata: { isAnonymous: false, amountPaise: 50000 },
  createdAt: new Date('2026-02-03T00:00:00Z'),
  ...overrides,
});

const original = config.razorpay.webhookSecret;
beforeEach(() => {
  config.razorpay.webhookSecret = SECRET;
});
afterAll(() => {
  config.razorpay.webhookSecret = original;
});
afterEach(() => new Promise((resolve) => setImmediate(resolve)));

describe('POST /api/payments/webhook/razorpay', () => {
  it('accepts a correctly signed payment.captured and completes the transaction', async () => {
    prismaMock.transaction.findUnique.mockResolvedValue(pendingDonation());
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.donation.create.mockImplementation(async ({ data }: any) => ({ id: 'don-1', ...data }));
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', fullName: 'U', email: 'u@x.y' });

    const raw = rawEvent('payment.captured');
    const res = await post(raw, sign(raw), { 'X-Razorpay-Event-Id': 'evt_1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'txn-1', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SUCCESS', gatewayPaymentId: 'pay_1' },
    });
    expect(prismaMock.donation.create).toHaveBeenCalledTimes(1);
  });

  it('needs no authentication', async () => {
    prismaMock.transaction.findUnique.mockResolvedValue(null);
    const raw = rawEvent('payment.captured');
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
  });

  it('rejects a tampered body with 400 and writes nothing', async () => {
    const raw = rawEvent('payment.captured');
    const tampered = raw.replace('50000', '50001');
    const res = await post(tampered, sign(raw));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect(prismaMock.transaction.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a signature made with the wrong secret, or no signature at all', async () => {
    const raw = rawEvent('payment.captured');
    expect((await post(raw, sign(raw, 'other-secret'))).status).toBe(400);
    expect((await post(raw)).status).toBe(400);
    expect((await post(raw, '')).status).toBe(400);
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a signature over the re-serialised (compact) body', async () => {
    const raw = rawEvent('payment.captured');
    const res = await post(raw, sign(JSON.stringify(JSON.parse(raw))));
    expect(res.status).toBe(400);
  });

  it('returns 503 and never accepts events when no webhook secret is configured', async () => {
    config.razorpay.webhookSecret = '';
    const raw = rawEvent('payment.captured');
    const res = await post(raw, sign(raw, ''));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('WEBHOOK_NOT_CONFIGURED');
    expect(prismaMock.transaction.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a signed but non-object payload with 400', async () => {
    const raw = '"just a string"';
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(400);
  });

  it('marks a PENDING transaction FAILED on payment.failed', async () => {
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    const raw = rawEvent('payment.failed');
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { gatewayOrderId: 'order_1', status: 'PENDING' },
      data: { status: 'FAILED', gatewayPaymentId: 'pay_1' },
    });
  });

  it('acknowledges unsupported events with 200', async () => {
    const raw = rawEvent('refund.processed');
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('returns 500 on unexpected failures so Razorpay retries', async () => {
    prismaMock.transaction.findUnique.mockRejectedValue(new Error('db down'));
    const raw = rawEvent('payment.captured');
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(500);
  });
});

describe('rate limiting', () => {
  const limitedApp = createApp({ disableRateLimit: false });
  const hasRateLimitHeaders = (res: request.Response) =>
    Object.keys(res.headers).some((h) => h.startsWith('ratelimit') || h.startsWith('x-ratelimit'));

  it('exempts the webhook from the general /api limiter (Razorpay retries deliveries)', async () => {
    const raw = rawEvent('refund.processed');
    const webhook = await request(limitedApp).post(PATH).set('Content-Type', 'application/json').set('X-Razorpay-Signature', sign(raw)).send(raw);
    expect(webhook.status).toBe(200);
    expect(hasRateLimitHeaders(webhook)).toBe(false);

    prismaMock.membershipTier.findMany.mockResolvedValue([]);
    const other = await request(limitedApp).get('/api/memberships/tiers');
    expect(hasRateLimitHeaders(other)).toBe(true);
  });
});
