/**
 * ROUND 3 / E1-E5 - payments: order tampering, verification with a tampered amount / signature / somebody else's order, replays, the
 * webhook (bad or missing signature, modified body, oversized body, no secret configured), and receipt access.
 * Real database and real HMACs; only the Razorpay SDK (order creation) and receipt storage are faked.
 */
import crypto from 'crypto';

jest.mock('razorpay', () => {
  let orderSeq = 0;
  return class FakeRazorpay {
    orders = {
      create: async (params: { amount: number; currency: string; notes: Record<string, string> }) => ({
        id: `order_r3_${Date.now()}_${++orderSeq}`,
        amount: params.amount,
        currency: params.currency,
        notes: params.notes,
        status: 'created',
      }),
    };
  };
});
jest.mock('../../../src/utils/storage', () => ({
  ...jest.requireActual('../../../src/utils/storage'),
  uploadBufferToStorage: async () => '/uploads/receipts/r3-mock.pdf',
}));

import config from '../../../src/config';
import { resetRazorpayClient } from '../../../src/utils/razorpay';
import { createUser, http, prisma } from '../../integration/helpers';

const KEY_SECRET = 'r3_key_secret';
const WEBHOOK_SECRET = 'r3_webhook_secret';
const original = { ...config.razorpay };

beforeAll(() => {
  config.razorpay.keyId = 'rzp_test_r3';
  config.razorpay.keySecret = KEY_SECRET;
  config.razorpay.webhookSecret = WEBHOOK_SECRET;
  resetRazorpayClient();
});
afterAll(async () => {
  Object.assign(config.razorpay, original);
  resetRazorpayClient();
  await prisma.$disconnect();
});

const sign = (orderId: string, paymentId: string, secret = KEY_SECRET) => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
const payId = () => `pay_${crypto.randomUUID().slice(0, 12)}`;
const tier = (price = 500) => prisma.membershipTier.create({ data: { name: `R3 tier ${crypto.randomUUID()}`, priceInr: price, durationMonths: 12, benefits: ['x'] } });

const memberOrder = async (who: { auth: string }, tierId: string) => {
  const res = await http().post('/api/memberships/order').set('Authorization', who.auth).send({ tierId });
  expect(res.status).toBe(200);
  return res.body.data as { orderId: string; amount: number };
};
const verifyMembership = (who: { auth: string }, body: Record<string, unknown>) => http().post('/api/memberships/verify').set('Authorization', who.auth).send(body);
const guestOrder = async (amount: unknown = 250, extra: Record<string, unknown> = {}) => http().post('/api/donations/order').send({ amount, donorName: 'Guest', donorEmail: 'guest@example.com', ...extra });
const verifyDonation = (body: Record<string, unknown>, who?: { auth: string }) => {
  const req = http().post('/api/donations/verify');
  return (who ? req.set('Authorization', who.auth) : req).send(body);
};

describe('E1 order tampering: the amount is the server\'s, not the client\'s', () => {
  it('membership: the price is the tier\'s whatever the body says, and an unknown, inactive or free tier gets no order', async () => {
    const member = await createUser('MEMBER');
    const t = await tier(500);
    const res = await http().post('/api/memberships/order').set('Authorization', member.auth).send({ tierId: t.id, amount: 1, priceInr: 1, currency: 'USD' });
    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(50000);
    expect(res.body.data.currency).toBe('INR');
    const stored = await prisma.transaction.findUniqueOrThrow({ where: { gatewayOrderId: res.body.data.orderId } });
    expect(Number(stored.amount)).toBe(500);

    const inactive = await prisma.membershipTier.create({ data: { name: `R3 off ${crypto.randomUUID()}`, priceInr: 100, benefits: [], isActive: false } });
    const free = await prisma.membershipTier.create({ data: { name: `R3 free ${crypto.randomUUID()}`, priceInr: 0, benefits: [] } });
    for (const tierId of [inactive.id, free.id, '00000000-0000-4000-8000-000000000000', 'x', 5, null, [t.id], { id: t.id }]) {
      const bad = await http().post('/api/memberships/order').set('Authorization', member.auth).send({ tierId });
      expect({ tierId: JSON.stringify(tierId), status: bad.status >= 400 && bad.status < 500 }).toEqual({ tierId: JSON.stringify(tierId), status: true });
    }
  });

  it.each([
    ['negative', -5],
    ['zero', 0],
    ['fractions of a paisa', 0.001],
    ['below the minimum', 0.5],
    ['Infinity', 'Infinity'],
    ['NaN', 'NaN'],
    ['an array', [100]],
    ['an object', { $gt: 0 }],
    ['over the maximum', 10_000_000],
    ['absurd', 1e308],
    ['a string with units', '100 rupees'],
    ['null', null],
  ])('guest donation order refuses amount: %s', async (_label, amount) => {
    const res = await guestOrder(amount);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBeDefined();
  });

  it('a good amount is converted to paise exactly, once ("0.1 + 0.2" style floating point does not leak into the order)', async () => {
    const res = await guestOrder(19.99);
    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(1999);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { gatewayOrderId: res.body.data.orderId } });
    expect(Number(row.amount)).toBe(19.99);
  });

  it('guest donor fields cannot smuggle headers or markup into the receipt mail or the wall', async () => {
    for (const donorEmail of ['a@b.co\r\nBcc: x@y.z', 'a@b.co,c@d.ef', '<script>@x.y', 'x@y.z>', '"a b"@c.de']) {
      const res = await guestOrder(100, { donorEmail });
      expect({ donorEmail, status: res.status }).toEqual({ donorEmail, status: 400 });
    }
    const ok = await guestOrder(100, { donorName: '<img src=x onerror=alert(1)>Donor', message: '<script>alert(1)</script>Thanks' });
    expect(ok.status).toBe(200);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { gatewayOrderId: ok.body.data.orderId } });
    expect(JSON.stringify(row.metadata)).not.toMatch(/<\s*\/?[a-z]|onerror=/i);
  });
});

describe('E2 verification', () => {
  it('somebody else\'s order cannot be verified, even with a genuine signature; the owner still can, and once', async () => {
    const owner = await createUser('MEMBER');
    const thief = await createUser('MEMBER');
    const t = await tier(300);
    const order = await memberOrder(owner, t.id);
    const paymentId = payId();
    const body = { razorpay_order_id: order.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(order.orderId, paymentId) };

    const stolen = await verifyMembership(thief, body);
    expect(stolen.status).toBe(403);
    const asGuest = await http().post('/api/memberships/verify').send(body);
    expect(asGuest.status).toBe(401);
    expect(await prisma.userMembership.count({ where: { userId: thief.user.id } })).toBe(0);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { gatewayOrderId: order.orderId } })).status).toBe('PENDING');

    const first = await verifyMembership(owner, body);
    expect(first.status).toBe(200);
    const replay = await verifyMembership(owner, body);
    expect(replay.status).toBeLessThan(500);
    expect(await prisma.userMembership.count({ where: { userId: owner.user.id } })).toBe(1);
  });

  it('a signature made for a different order or payment, a wrong key, and every malformed signature are refused and complete nothing', async () => {
    const member = await createUser('MEMBER');
    const t = await tier(300);
    const a = await memberOrder(member, t.id);
    const b = await memberOrder(member, t.id);
    const paymentId = payId();
    const goodForA = sign(a.orderId, paymentId);
    const bad: Array<[string, unknown]> = [
      ['signature of order A used on order B', goodForA],
      ['signed with another key', sign(b.orderId, paymentId, 'some-other-secret')],
      ['upper-case hex', sign(b.orderId, paymentId).toUpperCase()],
      ['trailing space', `${sign(b.orderId, paymentId)} `],
      ['truncated', sign(b.orderId, paymentId).slice(0, 63)],
      ['too long', `${sign(b.orderId, paymentId)}00`],
      ['empty', ''],
      ['a number', 12345],
      ['an array', [sign(b.orderId, paymentId)]],
      ['an object', { value: sign(b.orderId, paymentId) }],
      ['very long', 'a'.repeat(10_000)],
    ];
    for (const [label, signature] of bad) {
      const res = await verifyMembership(member, { razorpay_order_id: b.orderId, razorpay_payment_id: paymentId, razorpay_signature: signature });
      expect({ label, status: res.status >= 400 && res.status < 500 }).toEqual({ label, status: true });
    }
    // and the payment id is part of the signed text: a valid signature does not travel to another payment id
    const swapped = await verifyMembership(member, { razorpay_order_id: b.orderId, razorpay_payment_id: payId(), razorpay_signature: sign(b.orderId, paymentId) });
    expect(swapped.status).toBe(400);
    expect(await prisma.userMembership.count({ where: { userId: member.user.id } })).toBe(0);
    expect((await prisma.transaction.findMany({ where: { userId: member.user.id } })).every((tx) => tx.status !== 'SUCCESS')).toBe(true);
  });

  it('the body cannot choose the amount, the tier or the user at verification time', async () => {
    const member = await createUser('MEMBER');
    const cheap = await tier(100);
    const dear = await tier(9000);
    const order = await memberOrder(member, cheap.id);
    const paymentId = payId();
    const res = await verifyMembership(member, {
      razorpay_order_id: order.orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(order.orderId, paymentId),
      tierId: dear.id,
      amount: 9000,
      userId: '00000000-0000-4000-8000-000000000001',
    });
    expect(res.status).toBe(200);
    const memberships = await prisma.userMembership.findMany({ where: { userId: member.user.id } });
    expect(memberships.map((m) => m.tierId)).toEqual([cheap.id]);
    expect(Number((await prisma.transaction.findUniqueOrThrow({ where: { gatewayOrderId: order.orderId } })).amount)).toBe(100);
  });

  it('a guest donation: forged signature leaves it unpaid; a member\'s donation cannot be verified by a guest or by another member; the genuine signature completes it once', async () => {
    const member = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    const memberDonation = await http().post('/api/donations/order').set('Authorization', member.auth).send({ amount: 700 });
    expect(memberDonation.status).toBe(200);
    const orderId = memberDonation.body.data.orderId as string;
    const paymentId = payId();
    const signature = sign(orderId, paymentId);

    expect((await verifyDonation({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature })).status).toBe(403); // guest
    expect((await verifyDonation({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature }, other)).status).toBe(403);
    expect((await verifyDonation({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: 'f'.repeat(64) }, member)).status).toBe(400);
    expect(await prisma.donation.count({ where: { userId: member.user.id } })).toBe(0);

    const tampered = await verifyDonation({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature, amount: 1, chapterId: 'x' }, member);
    expect(tampered.status).toBe(200);
    expect(await prisma.donation.count({ where: { userId: member.user.id } })).toBe(1);
    expect(Number((await prisma.donation.findFirstOrThrow({ where: { userId: member.user.id } })).amount)).toBe(700);
    await verifyDonation({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature }, member);
    expect(await prisma.donation.count({ where: { userId: member.user.id } })).toBe(1);
  });

  it('missing, empty and mistyped fields are 400, never 500; and nothing verifies while the key secret is not configured', async () => {
    for (const body of [{}, { razorpay_order_id: 'x' }, { razorpay_order_id: 'x', razorpay_payment_id: 'y' }, { razorpay_order_id: [1], razorpay_payment_id: {}, razorpay_signature: 5 }, null as never]) {
      const res = await verifyDonation(body ?? {});
      expect(res.status).toBe(400);
    }
    const saved = config.razorpay.keySecret;
    config.razorpay.keySecret = '';
    try {
      const forged = crypto.createHmac('sha256', '').update('order_x|pay_y').digest('hex');
      const res = await verifyDonation({ razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_y', razorpay_signature: forged });
      expect(res.status).toBe(503);
    } finally {
      config.razorpay.keySecret = saved;
    }
  });
});

describe('E3 the webhook', () => {
  const event = (orderId: string, amount: number, paymentId = payId()) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: 'INR', status: 'captured' } } },
  });
  const post = (body: string | Buffer, headers: Record<string, string>, contentType = 'application/json') => {
    let req = http().post('/api/payments/webhook/razorpay').set('Content-Type', contentType);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req.send(body);
  };
  const hmac = (body: string | Buffer, secret = WEBHOOK_SECRET) => crypto.createHmac('sha256', secret).update(body).digest('hex');
  const pending = async () => {
    const order = await guestOrder(400);
    return order.body.data.orderId as string;
  };
  const stateOf = async (orderId: string) => (await prisma.transaction.findUniqueOrThrow({ where: { gatewayOrderId: orderId } })).status;

  it('no signature, a wrong signature, a signature over a different body, and a signature from the key secret are all refused and change nothing', async () => {
    const orderId = await pending();
    const body = JSON.stringify(event(orderId, 40000));
    const attempts = [
      post(body, {}),
      post(body, { 'X-Razorpay-Signature': '' }),
      post(body, { 'X-Razorpay-Signature': hmac(body, 'wrong') }),
      post(body, { 'X-Razorpay-Signature': hmac(body, KEY_SECRET) }),
      post(body, { 'X-Razorpay-Signature': hmac(JSON.stringify(event(orderId, 100))) }), // valid for a cheaper body
      post(body, { 'X-Razorpay-Signature': hmac(body).toUpperCase() }),
      post(body, { 'X-Razorpay-Signature': `${hmac(body)}0` }),
    ];
    for (const res of await Promise.all(attempts)) expect([400, 401, 403]).toContain((await res).status);
    expect(await stateOf(orderId)).toBe('PENDING');
  });

  it('a body modified after signing (extra spaces, reordered keys, another amount) is refused: the signature covers the raw bytes', async () => {
    const orderId = await pending();
    const signed = JSON.stringify(event(orderId, 40000));
    const signature = hmac(signed);
    for (const altered of [signed.replace('"captured"', '"captured" '), JSON.stringify(JSON.parse(signed), null, 2), signed.replace('40000', '1')]) {
      const res = await post(altered, { 'X-Razorpay-Signature': signature });
      expect([400, 401, 403]).toContain(res.status);
    }
    expect(await stateOf(orderId)).toBe('PENDING');
  });

  it('the same valid event delivered ten times in parallel completes the payment once', async () => {
    const orderId = await pending();
    const body = JSON.stringify(event(orderId, 40000, 'pay_r3_parallel'));
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => post(body, { 'X-Razorpay-Signature': hmac(body), 'X-Razorpay-Event-Id': `evt_r3_${orderId}_${i % 2}` })));
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(await stateOf(orderId)).toBe('SUCCESS');
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { gatewayOrderId: orderId } });
    expect(await prisma.donation.count({ where: { transactionId: tx.id } })).toBe(1);
  });

  it('an amount that does not match the order does not complete it', async () => {
    const orderId = await pending();
    const body = JSON.stringify(event(orderId, 100)); // paid 1 rupee for a 400 rupee order
    const res = await post(body, { 'X-Razorpay-Signature': hmac(body) });
    expect(res.status).toBeLessThan(500);
    expect(await stateOf(orderId)).toBe('PENDING');
  });

  it('unknown event types, other content types and non-JSON bodies are acknowledged or refused, never a 500; the body limit is 256 KB', async () => {
    const unknown = JSON.stringify({ event: 'payment.vanished', payload: {} });
    expect((await post(unknown, { 'X-Razorpay-Signature': hmac(unknown) })).status).toBeLessThan(500);
    const text = 'not json at all';
    expect((await post(text, { 'X-Razorpay-Signature': hmac(text) })).status).toBeLessThan(500);
    const form = 'event=payment.captured';
    expect((await post(form, { 'X-Razorpay-Signature': hmac(form) }, 'application/x-www-form-urlencoded')).status).toBeLessThan(500);
    const big = JSON.stringify({ event: 'x', padding: 'a'.repeat(256 * 1024 + 10) });
    const tooBig = await post(big, { 'X-Razorpay-Signature': hmac(big) });
    expect(tooBig.status).toBe(413);
  });

  it('without a webhook secret configured the endpoint accepts nothing (an empty secret is a signature anybody can make)', async () => {
    const orderId = await pending();
    const body = JSON.stringify(event(orderId, 40000));
    const saved = config.razorpay.webhookSecret;
    config.razorpay.webhookSecret = '';
    try {
      const res = await post(body, { 'X-Razorpay-Signature': hmac(body, '') });
      expect([400, 401, 403, 503]).toContain(res.status);
      expect(await stateOf(orderId)).toBe('PENDING');
    } finally {
      config.razorpay.webhookSecret = saved;
    }
  });
});

describe('E5 receipts', () => {
  it('the owner can fetch the receipt of a completed payment; another member, a guest and a chapter admin cannot; static access is closed', async () => {
    const owner = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    const chapterAdmin = await createUser('CHAPTER_ADMIN');
    const t = await tier(200);
    const order = await memberOrder(owner, t.id);
    const paymentId = payId();
    expect((await verifyMembership(owner, { razorpay_order_id: order.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(order.orderId, paymentId) })).status).toBe(200);
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { gatewayOrderId: order.orderId } });

    for (const who of [other, chapterAdmin]) {
      const res = await http().get(`/api/transactions/${tx.id}/receipt`).set('Authorization', who.auth);
      expect([403, 404]).toContain(res.status);
    }
    expect((await http().get(`/api/transactions/${tx.id}/receipt`)).status).toBe(401);
    expect((await http().get('/uploads/receipts/r3-mock.pdf')).status).toBe(404);
    expect((await http().get('/uploads/x/../receipts/r3-mock.pdf')).status).toBe(404);

    const mine = await http().get('/api/transactions/my').set('Authorization', owner.auth);
    expect(JSON.stringify(mine.body)).toContain(tx.id);
    const theirs = await http().get('/api/transactions/my').set('Authorization', other.auth);
    expect(JSON.stringify(theirs.body)).not.toContain(tx.id);
  });
});
