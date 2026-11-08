/**
 * ROUND 2 - payment completion under a burst: the client "verify" call, the webhook and its redeliveries all race to
 * complete one gateway order. Exactly one must win; money and entitlements are applied once.
 * (Held up in round 2; kept as regression coverage.)
 */
import { createUser, prisma } from '../../integration/helpers';
import { donationService } from '../../../src/services/donationService';
import { membershipService } from '../../../src/services/membershipService';
import { paymentWebhookService } from '../../../src/services/paymentWebhookService';

// Receipts are generated in the background and written to disk: not what these tests are about
jest.mock('../../../src/utils/storage', () => ({
  ...jest.requireActual('../../../src/utils/storage'),
  uploadBufferToStorage: jest.fn().mockResolvedValue('/uploads/receipts/mock.pdf'),
}));

afterAll(async () => {
  await prisma.$disconnect();
});

let orderCounter = 0;
const orderId = () => `order_r2_${Date.now()}_${++orderCounter}`;

describe('donations', () => {
  it('verify + webhook + redelivered webhooks complete a donation once and credit the chapter once', async () => {
    const donor = await createUser('MEMBER');
    const chapter = await prisma.chapter.create({ data: { name: `R2 donations ${Date.now()}`, region: 'R2' } });
    const gatewayOrderId = orderId();
    const tx = await prisma.transaction.create({
      data: {
        userId: donor.user.id,
        type: 'DONATION',
        amount: '500',
        status: 'PENDING',
        gatewayOrderId,
        metadata: { chapterId: chapter.id, isAnonymous: false, amountPaise: 50000 },
      },
    });

    const event = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_r2', order_id: gatewayOrderId, amount: 50000, currency: 'INR', status: 'captured' } } },
    };
    const results = await Promise.all([
      donationService.completeTransaction(tx, { paymentId: 'pay_r2', signature: 'sig' }),
      donationService.completeTransaction(tx, { paymentId: 'pay_r2', signature: 'sig' }),
      paymentWebhookService.handleEvent(event),
      paymentWebhookService.handleEvent(event),
      paymentWebhookService.handleEvent(event),
      donationService.completeTransaction(tx, { paymentId: 'pay_r2' }, { deferReceipt: true }),
    ]);
    expect(results).toHaveLength(6);

    expect(await prisma.donation.count({ where: { transactionId: tx.id } })).toBe(1);
    const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(stored.status).toBe('SUCCESS');
    const updated = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(Number(updated.totalDonations)).toBe(500);
  });

  it('a refunded or failed-then-refunded transaction cannot be completed again by a late burst', async () => {
    const donor = await createUser('MEMBER');
    const gatewayOrderId = orderId();
    const tx = await prisma.transaction.create({
      data: { userId: donor.user.id, type: 'DONATION', amount: '100', status: 'REFUNDED', gatewayOrderId, metadata: { isAnonymous: true, amountPaise: 10000 } },
    });
    const event = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_late', order_id: gatewayOrderId, amount: 10000, currency: 'INR' } } },
    };
    await Promise.all([paymentWebhookService.handleEvent(event), paymentWebhookService.handleEvent(event)]);
    expect(await prisma.donation.count({ where: { transactionId: tx.id } })).toBe(0);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).status).toBe('REFUNDED');
  });

  it('a paid amount that differs from the order is never completed, however often it is delivered', async () => {
    const donor = await createUser('MEMBER');
    const gatewayOrderId = orderId();
    const tx = await prisma.transaction.create({
      data: { userId: donor.user.id, type: 'DONATION', amount: '1000', status: 'PENDING', gatewayOrderId, metadata: { isAnonymous: false, amountPaise: 100000 } },
    });
    const event = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_short', order_id: gatewayOrderId, amount: 100, currency: 'INR' } } },
    };
    await Promise.all(Array.from({ length: 4 }, () => paymentWebhookService.handleEvent(event)));
    expect(await prisma.donation.count({ where: { transactionId: tx.id } })).toBe(0);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).status).toBe('PENDING');
  });
});

describe('memberships', () => {
  it('a burst of completions for one order activates the membership once', async () => {
    const member = await createUser('MEMBER');
    const tier = await prisma.membershipTier.create({
      data: { name: `R2 tier ${Date.now()}`, priceInr: '999', durationMonths: 12, benefits: ['x'] },
    });
    const gatewayOrderId = orderId();
    const tx = await prisma.transaction.create({
      data: { userId: member.user.id, type: 'MEMBERSHIP', amount: '999', status: 'PENDING', gatewayOrderId, metadata: { tierId: tier.id } },
    });
    await Promise.all(Array.from({ length: 6 }, () => membershipService.completeTransaction(tx, { paymentId: 'pay_m', signature: 'sig' })));
    expect(await prisma.userMembership.count({ where: { transactionId: tx.id } })).toBe(1);
    expect(await prisma.userMembership.count({ where: { userId: member.user.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('R2-10 two DIFFERENT paid orders completing at once leave one ACTIVE membership, not two', async () => {
    const member = await createUser('MEMBER');
    const tier = await prisma.membershipTier.create({
      data: { name: `R2 tier b ${Date.now()}`, priceInr: '500', durationMonths: 12, benefits: ['x'] },
    });
    const txs = await Promise.all(
      [1, 2, 3].map(() =>
        prisma.transaction.create({
          data: { userId: member.user.id, type: 'MEMBERSHIP', amount: '500', status: 'PENDING', gatewayOrderId: orderId(), metadata: { tierId: tier.id } },
        })
      )
    );
    await Promise.all(txs.map((tx) => membershipService.completeTransaction(tx, { paymentId: `pay_${tx.id}` })));
    expect(await prisma.userMembership.count({ where: { userId: member.user.id, status: 'ACTIVE' } })).toBe(1);
  });
});
