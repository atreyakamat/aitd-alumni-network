/**
 * AU-03: an invalid checkout signature must never rewrite a REFUNDED (or otherwise settled)
 * transaction. Before the fix `verifyPayment` flipped any non-SUCCESS transaction to FAILED,
 * and FAILED is a claimable status, so replaying the original (valid) signature afterwards
 * re-completed a refunded payment (a second membership row / donation).
 */
import crypto from 'crypto';
import config from '../../../src/config';
import { resetRazorpayClient } from '../../../src/utils/razorpay';
import { createUser, http, prisma } from '../../integration/helpers';

const KEY_SECRET = 'sec_key_secret';
const original = { ...config.razorpay };

beforeAll(() => {
  config.razorpay.keyId = 'rzp_test_sec';
  config.razorpay.keySecret = KEY_SECRET;
  resetRazorpayClient();
});

afterAll(async () => {
  Object.assign(config.razorpay, original);
  resetRazorpayClient();
  await prisma.$disconnect();
});

const sign = (orderId: string, paymentId: string) =>
  crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

describe('AU-03: invalid signatures cannot downgrade a refunded transaction', () => {
  it('a refunded transaction without an owner (an old guest donation) is untouched by anybody: anonymous 401, member bogus signature 400, genuine replay 409', async () => {
    const { auth } = await createUser('MEMBER');
    const orderId = `order_sec_${crypto.randomUUID()}`;
    const tx = await prisma.transaction.create({
      data: { userId: null, type: 'DONATION', amount: 500, status: 'REFUNDED', gatewayOrderId: orderId, metadata: { amountPaise: 50000 } },
    });
    const body = { razorpay_order_id: orderId, razorpay_payment_id: 'pay_x', razorpay_signature: 'f'.repeat(64) };

    // the platform is private: no anonymous call reaches the payment code at all
    expect((await http().post('/api/donations/verify').send(body)).status).toBe(401);

    const res = await http().post('/api/donations/verify').set('Authorization', auth).send(body);
    expect(res.status).toBe(400);
    expect((await prisma.transaction.findUnique({ where: { id: tx.id } }))?.status).toBe('REFUNDED');

    // and the genuine signature is still refused rather than re-completing the payment
    const replay = await http()
      .post('/api/donations/verify')
      .set('Authorization', auth)
      .send({ razorpay_order_id: orderId, razorpay_payment_id: 'pay_x', razorpay_signature: sign(orderId, 'pay_x') });
    expect(replay.status).toBe(409);
    expect(await prisma.donation.count({ where: { transactionId: tx.id } })).toBe(0);
  });

  it('membership: the owner cannot launder a refund through a bogus signature + valid replay', async () => {
    const { user, auth } = await createUser('MEMBER');
    const tier = await prisma.membershipTier.create({
      data: { name: `Sec tier ${Date.now()}`, priceInr: 100, benefits: ['x'], durationMonths: 12 },
    });
    const orderId = `order_sec_${crypto.randomUUID()}`;
    const tx = await prisma.transaction.create({
      data: { userId: user.id, type: 'MEMBERSHIP', amount: 100, status: 'REFUNDED', gatewayOrderId: orderId, metadata: { tierId: tier.id, amountPaise: 10000 } },
    });

    const bogus = await http()
      .post('/api/memberships/verify')
      .set('Authorization', auth)
      .send({ razorpay_order_id: orderId, razorpay_payment_id: 'pay_m', razorpay_signature: 'a'.repeat(64) });
    expect(bogus.status).toBe(400);
    expect((await prisma.transaction.findUnique({ where: { id: tx.id } }))?.status).toBe('REFUNDED');

    const replay = await http()
      .post('/api/memberships/verify')
      .set('Authorization', auth)
      .send({ razorpay_order_id: orderId, razorpay_payment_id: 'pay_m', razorpay_signature: sign(orderId, 'pay_m') });
    expect(replay.status).toBe(409);
    expect(await prisma.userMembership.count({ where: { userId: user.id } })).toBe(0);
  });
});
