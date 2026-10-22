import crypto from 'crypto';

const ordersCreate = jest.fn();
jest.mock('../../utils/razorpay', () => {
  const actual = jest.requireActual('../../utils/razorpay');
  return { ...actual, getRazorpayClient: jest.fn(() => ({ orders: { create: ordersCreate } })) };
});
jest.mock('../../utils/storage', () => ({
  uploadBufferToStorage: jest.fn().mockResolvedValue('https://cdn.test/receipts/r.pdf'),
}));
jest.mock('../../utils/pdfReceipt', () => {
  const actual = jest.requireActual('../../utils/pdfReceipt');
  return { ...actual, generateMembershipReceipt: jest.fn().mockResolvedValue(Buffer.from('%PDF-')) };
});

import config from '../../config';
import { prismaMock } from '../../../tests/helpers';
import {
  addMonths,
  isMembershipCurrent,
  membershipService,
  validateTierInput,
} from '../../services/membershipService';
import { getRazorpayClient } from '../../utils/razorpay';
import { AppError } from '../../middleware/errorHandler';
import { uploadBufferToStorage } from '../../utils/storage';
import { generateMembershipReceipt } from '../../utils/pdfReceipt';

const SECRET = 'membership_test_secret';
const USER = 'user-1';
const sign = (o: string, p: string) => crypto.createHmac('sha256', SECRET).update(`${o}|${p}`).digest('hex');

const tier = (overrides: Record<string, unknown> = {}) => ({
  id: 'tier-1',
  name: 'Gold',
  priceInr: 999.5,
  durationMonths: 12,
  isActive: true,
  benefits: ['a'],
  ...overrides,
});

const txn = (overrides: Record<string, unknown> = {}) => ({
  id: 'txn-1',
  userId: USER,
  type: 'MEMBERSHIP',
  amount: 999.5,
  status: 'PENDING',
  gatewayOrderId: 'order_1',
  metadata: { tierId: 'tier-1' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const original = { ...config.razorpay };
beforeEach(() => {
  config.razorpay.keyId = 'rzp_test_key';
  config.razorpay.keySecret = SECRET;
  ordersCreate.mockReset();
  (getRazorpayClient as jest.Mock).mockClear();
  (uploadBufferToStorage as jest.Mock).mockClear();
  (generateMembershipReceipt as jest.Mock).mockClear();
});
afterAll(() => {
  config.razorpay.keyId = original.keyId;
  config.razorpay.keySecret = original.keySecret;
});

const expectAppError = async (p: Promise<unknown>, status: number, code?: string) => {
  const err = await p.then(
    () => {
      throw new Error('expected rejection');
    },
    (e) => e
  );
  expect(err).toBeInstanceOf(AppError);
  expect(err.statusCode).toBe(status);
  if (code) expect(err.code).toBe(code);
  return err;
};

describe('helpers', () => {
  it('addMonths clamps to month end', () => {
    expect(addMonths(new Date(2026, 0, 31), 1).getDate()).toBe(28);
    expect(addMonths(new Date(2028, 0, 31), 1).getDate()).toBe(29);
    const d = addMonths(new Date(2026, 4, 15), 12);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 4, 15]);
  });

  it('isMembershipCurrent handles expiry and lifetime', () => {
    const now = new Date('2026-06-01');
    expect(isMembershipCurrent({ status: 'ACTIVE', endDate: null }, now)).toBe(true);
    expect(isMembershipCurrent({ status: 'ACTIVE', endDate: new Date('2026-07-01') }, now)).toBe(true);
    expect(isMembershipCurrent({ status: 'ACTIVE', endDate: new Date('2026-05-31') }, now)).toBe(false);
    expect(isMembershipCurrent({ status: 'CANCELLED', endDate: null }, now)).toBe(false);
    expect(isMembershipCurrent(null)).toBe(false);
  });
});

describe('validateTierInput', () => {
  const valid = { name: ' Gold ', priceInr: 100, benefits: ['x', ' y '] };

  it('whitelists and normalises fields', () => {
    const out = validateTierInput({ ...valid, id: 'hack', createdAt: 'x', durationMonths: null, isActive: false });
    expect(out).toEqual({ name: 'Gold', priceInr: 100, benefits: ['x', 'y'], durationMonths: null, isActive: false });
  });

  it('allows a free (0) tier and string prices', () => {
    expect(validateTierInput({ ...valid, priceInr: 0 }).priceInr).toBe(0);
    expect(validateTierInput({ ...valid, priceInr: '49.99' }).priceInr).toBe(49.99);
  });

  it.each([
    [{ ...valid, priceInr: -1 }, /priceInr/],
    [{ ...valid, priceInr: 'abc' }, /priceInr/],
    [{ ...valid, priceInr: 10_000_000 }, /exceed/],
    [{ ...valid, benefits: 'free stuff' }, /benefits/],
    [{ ...valid, benefits: ['ok', 3] }, /benefits/],
    [{ ...valid, benefits: [' '] }, /benefits/],
    [{ ...valid, name: '' }, /name/],
    [{ ...valid, name: 'x'.repeat(101) }, /too long/],
    [{ ...valid, durationMonths: 0 }, /durationMonths/],
    [{ ...valid, durationMonths: 1.5 }, /durationMonths/],
    [{ ...valid, description: 5 }, /description/],
    [{ ...valid, badgeColor: 5 }, /badgeColor/],
    [{ ...valid, displayOrder: 'first' }, /displayOrder/],
    [{ ...valid, isActive: 'yes' }, /isActive/],
    [null, /required/],
  ])('rejects %p', (input, msg) => {
    expect(() => validateTierInput(input)).toThrow(msg);
  });

  it('validates only provided fields in partial mode', () => {
    expect(validateTierInput({ priceInr: 5 }, true)).toEqual({ priceInr: 5 });
    expect(validateTierInput({ description: null, badgeColor: '#fff', displayOrder: 2 }, true)).toEqual({
      description: null,
      badgeColor: '#fff',
      displayOrder: 2,
    });
    expect(() => validateTierInput({ priceInr: -5 }, true)).toThrow(/priceInr/);
  });
});

describe('tiers', () => {
  it('getTiers lists active tiers ordered by displayOrder', async () => {
    prismaMock.membershipTier.findMany.mockResolvedValue([tier()]);
    await membershipService.getTiers();
    expect(prismaMock.membershipTier.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
  });

  it('getTier returns the tier or 404s', async () => {
    prismaMock.membershipTier.findUnique.mockResolvedValueOnce(tier());
    await expect(membershipService.getTier('tier-1')).resolves.toMatchObject({ id: 'tier-1' });
    prismaMock.membershipTier.findUnique.mockResolvedValueOnce(null);
    await expectAppError(membershipService.getTier('nope'), 404, 'NOT_FOUND');
    await expectAppError(membershipService.getTier(''), 400);
  });

  it('createTier validates before writing', async () => {
    prismaMock.membershipTier.create.mockResolvedValue(tier());
    await membershipService.createTier({ name: 'Gold', priceInr: 10, benefits: ['a'] });
    expect(prismaMock.membershipTier.create).toHaveBeenCalledWith({
      data: { name: 'Gold', priceInr: 10, benefits: ['a'] },
    });
    await expectAppError(membershipService.createTier({ name: 'X', priceInr: -1, benefits: [] }), 400);
    expect(prismaMock.membershipTier.create).toHaveBeenCalledTimes(1);
  });

  it('updateTier validates, 404s on unknown tiers and rejects empty updates', async () => {
    prismaMock.membershipTier.findUnique.mockResolvedValue(tier());
    prismaMock.membershipTier.update.mockResolvedValue(tier({ priceInr: 50 }));
    await membershipService.updateTier('tier-1', { priceInr: 50, id: 'evil' });
    expect(prismaMock.membershipTier.update).toHaveBeenCalledWith({ where: { id: 'tier-1' }, data: { priceInr: 50 } });

    await expectAppError(membershipService.updateTier('tier-1', { foo: 1 }), 400);
    await expectAppError(membershipService.updateTier('tier-1', { benefits: 'x' }), 400);
    prismaMock.membershipTier.findUnique.mockResolvedValue(null);
    await expectAppError(membershipService.updateTier('missing', { priceInr: 1 }), 404);
  });
});

describe('getUserMembership', () => {
  it('only returns ACTIVE memberships that are lifetime or not yet expired', async () => {
    prismaMock.userMembership.findFirst.mockResolvedValue(null);
    const before = Date.now();
    const result = await membershipService.getUserMembership(USER);
    expect(result).toBeNull();
    const args = prismaMock.userMembership.findFirst.mock.calls[0][0];
    expect(args.where.userId).toBe(USER);
    expect(args.where.status).toBe('ACTIVE');
    expect(args.where.OR[0]).toEqual({ endDate: null });
    expect(args.where.OR[1].endDate.gte.getTime()).toBeGreaterThanOrEqual(before);
    expect(args.orderBy).toEqual({ startDate: 'desc' });
  });
});

describe('createOrder', () => {
  beforeEach(() => {
    ordersCreate.mockResolvedValue({ id: 'order_1', amount: 99950, currency: 'INR' });
  });

  it('creates a Razorpay order priced from the server-side tier and a PENDING transaction', async () => {
    prismaMock.membershipTier.findUnique.mockResolvedValue(tier());
    const result = await membershipService.createOrder(USER, 'tier-1');

    const order = ordersCreate.mock.calls[0][0];
    expect(order.amount).toBe(99950);
    expect(Number.isInteger(order.amount)).toBe(true);
    expect(order.currency).toBe('INR');
    expect(order.receipt.length).toBeLessThanOrEqual(40);
    expect(order.notes).toEqual({ userId: USER, tierId: 'tier-1', type: 'membership' });

    expect(prismaMock.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER,
        type: 'MEMBERSHIP',
        amount: 999.5,
        status: 'PENDING',
        gatewayOrderId: 'order_1',
        metadata: { tierId: 'tier-1', amountPaise: 99950 },
      }),
    });
    expect(result).toMatchObject({ orderId: 'order_1', amount: 99950, currency: 'INR', keyId: 'rzp_test_key' });
  });

  it('handles Prisma Decimal-like prices', async () => {
    prismaMock.membershipTier.findUnique.mockResolvedValue(tier({ priceInr: { toString: () => '1499.00', valueOf: () => 1499 } }));
    await membershipService.createOrder(USER, 'tier-1');
    expect(ordersCreate.mock.calls[0][0].amount).toBe(149900);
  });

  it('requires a tierId', async () => {
    await expectAppError(membershipService.createOrder(USER, undefined as any), 400);
    expect(ordersCreate).not.toHaveBeenCalled();
  });

  it('404s for unknown tiers', async () => {
    prismaMock.membershipTier.findUnique.mockResolvedValue(null);
    await expectAppError(membershipService.createOrder(USER, 'nope'), 404);
  });

  it('rejects inactive tiers', async () => {
    prismaMock.membershipTier.findUnique.mockResolvedValue(tier({ isActive: false }));
    await expectAppError(membershipService.createOrder(USER, 'tier-1'), 400, 'TIER_INACTIVE');
    expect(ordersCreate).not.toHaveBeenCalled();
  });

  it('rejects free tiers (nothing to pay)', async () => {
    prismaMock.membershipTier.findUnique.mockResolvedValue(tier({ priceInr: 0 }));
    await expectAppError(membershipService.createOrder(USER, 'tier-1'), 400, 'TIER_FREE');
  });

  it('surfaces a 503 when Razorpay is not configured and writes nothing', async () => {
    prismaMock.membershipTier.findUnique.mockResolvedValue(tier());
    (getRazorpayClient as jest.Mock).mockImplementationOnce(() => {
      throw new AppError('Payments are not configured.', 503, 'PAYMENT_NOT_CONFIGURED');
    });
    await expectAppError(membershipService.createOrder(USER, 'tier-1'), 503, 'PAYMENT_NOT_CONFIGURED');
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });
});

describe('verifyPayment', () => {
  const sig = sign('order_1', 'pay_1');

  const arrangeHappyPath = () => {
    prismaMock.transaction.findFirst.mockResolvedValue(txn());
    prismaMock.membershipTier.findUnique.mockResolvedValue(tier());
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.userMembership.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.userMembership.create.mockImplementation(async ({ data }: any) => ({ id: 'mem-1', ...data }));
    prismaMock.user.findUnique.mockResolvedValue({ id: USER, fullName: 'U', email: 'u@x.y' });
  };

  it('activates the membership exactly once on a valid signature', async () => {
    arrangeHappyPath();
    const result = await membershipService.verifyPayment(USER, 'order_1', 'pay_1', sig);

    expect(prismaMock.transaction.findFirst).toHaveBeenCalledWith({
      where: { gatewayOrderId: 'order_1', type: 'MEMBERSHIP' },
    });
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'txn-1', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SUCCESS', gatewayPaymentId: 'pay_1', gatewaySignature: sig },
    });
    expect(prismaMock.userMembership.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    const created = prismaMock.userMembership.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ userId: USER, tierId: 'tier-1', status: 'ACTIVE', transactionId: 'txn-1' });
    expect(created.endDate).toBeInstanceOf(Date);
    expect(created.endDate.getTime()).toBeGreaterThan(created.startDate.getTime());
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: USER }, data: { membershipTierId: 'tier-1' } });
    expect(result).toMatchObject({ alreadyVerified: false, membership: { id: 'mem-1' } });

    // receipt uses the server-side amount and a deterministic number
    const receipt = (generateMembershipReceipt as jest.Mock).mock.calls[0][0];
    expect(receipt.amount).toBe(999.5);
    expect(receipt.receiptNumber).toBe('AITD-MEM-20260101-TXN1');
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'txn-1' },
      data: { receiptUrl: 'https://cdn.test/receipts/r.pdf' },
    });
  });

  it('gives lifetime tiers a null endDate', async () => {
    arrangeHappyPath();
    prismaMock.membershipTier.findUnique.mockResolvedValue(tier({ durationMonths: null }));
    await membershipService.verifyPayment(USER, 'order_1', 'pay_1', sig);
    expect(prismaMock.userMembership.create.mock.calls[0][0].data.endDate).toBeNull();
  });

  it('marks the transaction FAILED and never activates on an invalid signature', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(txn());
    await expectAppError(membershipService.verifyPayment(USER, 'order_1', 'pay_1', 'deadbeef'), 400, 'INVALID_SIGNATURE');
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'txn-1' },
      data: { status: 'FAILED', gatewayPaymentId: 'pay_1' },
    });
    expect(prismaMock.userMembership.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('does not accept a signature for a different payment id', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(txn());
    await expectAppError(membershipService.verifyPayment(USER, 'order_1', 'pay_2', sig), 400, 'INVALID_SIGNATURE');
  });

  it('is idempotent: an already-SUCCESS transaction returns the existing membership', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(txn({ status: 'SUCCESS' }));
    prismaMock.userMembership.findFirst.mockResolvedValue({ id: 'mem-existing' });
    const result = await membershipService.verifyPayment(USER, 'order_1', 'pay_1', sig);
    expect(result).toMatchObject({ alreadyVerified: true, membership: { id: 'mem-existing' } });
    expect(prismaMock.userMembership.findFirst).toHaveBeenCalledWith({
      where: { transactionId: 'txn-1' },
      include: { tier: true },
    });
    expect(prismaMock.userMembership.create).not.toHaveBeenCalled();
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('never downgrades a SUCCESS transaction on a bad signature', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(txn({ status: 'SUCCESS' }));
    await expectAppError(membershipService.verifyPayment(USER, 'order_1', 'pay_1', 'bad'), 400, 'INVALID_SIGNATURE');
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
  });

  it('loses a concurrent race gracefully (status guard claims 0 rows)', async () => {
    arrangeHappyPath();
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.userMembership.findFirst.mockResolvedValue({ id: 'mem-winner' });
    const result = await membershipService.verifyPayment(USER, 'order_1', 'pay_1', sig);
    expect(result).toMatchObject({ alreadyVerified: true, membership: { id: 'mem-winner' } });
    expect(prismaMock.userMembership.create).not.toHaveBeenCalled();
    expect(generateMembershipReceipt).not.toHaveBeenCalled();
  });

  it('allows a previously FAILED transaction to succeed with a genuine signature', async () => {
    arrangeHappyPath();
    prismaMock.transaction.findFirst.mockResolvedValue(txn({ status: 'FAILED' }));
    const result = await membershipService.verifyPayment(USER, 'order_1', 'pay_1', sig);
    expect(result.alreadyVerified).toBe(false);
  });

  it('refuses refunded transactions', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(txn({ status: 'REFUNDED' }));
    await expectAppError(membershipService.verifyPayment(USER, 'order_1', 'pay_1', sig), 409, 'PAYMENT_REFUNDED');
  });

  it("forbids verifying someone else's order", async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(txn({ userId: 'someone-else' }));
    await expectAppError(membershipService.verifyPayment(USER, 'order_1', 'pay_1', sig), 403, 'FORBIDDEN');
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
  });

  it('404s for unknown orders', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null);
    await expectAppError(membershipService.verifyPayment(USER, 'order_x', 'pay_1', sig), 404);
  });

  it('requires all three Razorpay fields', async () => {
    await expectAppError(membershipService.verifyPayment(USER, 'order_1', '', sig), 400, 'VALIDATION_ERROR');
    await expectAppError(membershipService.verifyPayment(USER, '', 'pay_1', sig), 400);
    await expectAppError(membershipService.verifyPayment(USER, 'order_1', 'pay_1', ''), 400);
  });

  it('returns 503 instead of verifying against an empty secret', async () => {
    config.razorpay.keySecret = '';
    const forged = crypto.createHmac('sha256', '').update('order_1|pay_1').digest('hex');
    await expectAppError(membershipService.verifyPayment(USER, 'order_1', 'pay_1', forged), 503, 'PAYMENT_NOT_CONFIGURED');
    expect(prismaMock.transaction.findFirst).not.toHaveBeenCalled();
  });

  it('rejects transactions with no tier metadata', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(txn({ metadata: null }));
    await expectAppError(membershipService.verifyPayment(USER, 'order_1', 'pay_1', sig), 422);
  });

  it('still succeeds when receipt generation fails', async () => {
    arrangeHappyPath();
    (generateMembershipReceipt as jest.Mock).mockRejectedValueOnce(new Error('pdf boom'));
    const result = await membershipService.verifyPayment(USER, 'order_1', 'pay_1', sig);
    expect(result.alreadyVerified).toBe(false);
    expect(uploadBufferToStorage).not.toHaveBeenCalled();
  });

  it('skips the receipt when the user record is gone', async () => {
    arrangeHappyPath();
    prismaMock.user.findUnique.mockResolvedValue(null);
    await membershipService.verifyPayment(USER, 'order_1', 'pay_1', sig);
    expect(generateMembershipReceipt).not.toHaveBeenCalled();
  });
});

describe('completeTransaction (shared by client verify and webhook)', () => {
  const arrange = () => {
    prismaMock.membershipTier.findUnique.mockResolvedValue(tier());
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.userMembership.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.userMembership.create.mockImplementation(async ({ data }: any) => ({ id: 'mem-1', ...data }));
    prismaMock.user.findUnique.mockResolvedValue({ id: USER, fullName: 'U', email: 'u@x.y' });
  };

  it('activates for the transaction owner without a signature (webhook)', async () => {
    arrange();
    const result = await membershipService.completeTransaction(txn() as any, { paymentId: 'pay_9' });
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'txn-1', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SUCCESS', gatewayPaymentId: 'pay_9' },
    });
    expect(prismaMock.userMembership.create.mock.calls[0][0].data).toMatchObject({ userId: USER, tierId: 'tier-1' });
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: USER }, data: { membershipTierId: 'tier-1' } });
    expect(result).toMatchObject({ alreadyVerified: false, membership: { id: 'mem-1' } });
  });

  it('returns the winner when the claim is lost (no second activation)', async () => {
    arrange();
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.userMembership.findFirst.mockResolvedValue({ id: 'mem-winner' });
    const result = await membershipService.completeTransaction(txn() as any, { paymentId: 'pay_9' });
    expect(result).toMatchObject({ alreadyVerified: true, membership: { id: 'mem-winner' } });
    expect(prismaMock.userMembership.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('can defer the receipt and falls back to the transaction id as payment reference', async () => {
    arrange();
    const result = await membershipService.completeTransaction(txn() as any, {}, { deferReceipt: true });
    expect(result.alreadyVerified).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    expect((generateMembershipReceipt as jest.Mock).mock.calls[0][0].paymentId).toBe('txn-1');
  });

  it('rejects transactions with no tier metadata before claiming', async () => {
    await expectAppError(membershipService.completeTransaction(txn({ metadata: null }) as any, {}), 422);
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a transaction whose member no longer exists (userId nulled by a user delete)', async () => {
    arrange();
    await expectAppError(membershipService.completeTransaction(txn({ userId: null }) as any, {}), 422, 'INVALID_TRANSACTION');
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.userMembership.create).not.toHaveBeenCalled();
  });
});

describe('history and paid members', () => {
  it('paginates membership history for the caller only', async () => {
    prismaMock.userMembership.findMany.mockResolvedValue([{ id: 'm1' }]);
    prismaMock.userMembership.count.mockResolvedValue(21);
    const result = await membershipService.getMembershipHistory(USER, 2, 10);
    const args = prismaMock.userMembership.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: USER });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(result.pagination).toMatchObject({ total: 21, page: 2, limit: 10, totalPages: 3 });
  });

  it('clamps bad pagination input', async () => {
    prismaMock.userMembership.findMany.mockResolvedValue([]);
    prismaMock.userMembership.count.mockResolvedValue(0);
    const result = await membershipService.getMembershipHistory(USER, NaN, 10_000);
    const args = prismaMock.userMembership.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(100);
    expect(result.pagination.totalPages).toBe(0);
  });

  it('lists only current paid members', async () => {
    prismaMock.userMembership.findMany.mockResolvedValue([]);
    prismaMock.userMembership.count.mockResolvedValue(0);
    const result = await membershipService.getPaidMembers();
    const args = prismaMock.userMembership.findMany.mock.calls[0][0];
    expect(args.where.status).toBe('ACTIVE');
    expect(args.where.OR[0]).toEqual({ endDate: null });
    expect(args.include.user.select.passwordHash).toBeUndefined();
    expect(prismaMock.userMembership.count).toHaveBeenCalledWith({ where: args.where });
    expect(result).toMatchObject({ data: [], pagination: { page: 1, limit: 20, total: 0 } });
  });
});
