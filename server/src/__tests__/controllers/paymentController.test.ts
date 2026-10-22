jest.mock('../../utils/pdfReceipt', () => {
  const actual = jest.requireActual('../../utils/pdfReceipt');
  return {
    ...actual,
    generateDonationReceipt: jest.fn(actual.generateDonationReceipt),
    generateMembershipReceipt: jest.fn(actual.generateMembershipReceipt),
  };
});

import { api, authAs, getApp, mockReqRes, prismaMock, USER_IDS } from '../../../tests/helpers';
import {
  donationController,
  membershipController,
  transactionController,
} from '../../controllers/paymentController';
import { membershipService } from '../../services/membershipService';
import { donationService } from '../../services/donationService';
import { generateDonationReceipt, generateMembershipReceipt } from '../../utils/pdfReceipt';
import config from '../../config';

const member = { id: USER_IDS.MEMBER, userRole: 'MEMBER' };
const admin = { id: USER_IDS.ADMIN, userRole: 'ADMIN' };

// Restore only the service spies created here (jest.restoreAllMocks would also undo the harness's console silencing).
const spies: jest.SpyInstance[] = [];
const spyOn = ((obj: any, method: any) => {
  const spy = jest.spyOn(obj, method);
  spies.push(spy);
  return spy;
}) as typeof jest.spyOn;
const restoreSpies = () => {
  while (spies.length) spies.pop()!.mockRestore();
};
afterEach(restoreSpies);

// The first request lazily builds the whole Express app; warm it up outside the per-test timeout.
beforeAll(() => {
  getApp();
}, 120000);

describe('MembershipController (unit)', () => {
  const cases: Array<[keyof typeof membershipController, keyof typeof membershipService, Record<string, unknown>]> = [
    ['getTiers', 'getTiers', {}],
    ['getTier', 'getTier', { params: { id: 't1' } }],
    ['getMyMembership', 'getUserMembership', { user: member }],
    ['createOrder', 'createOrder', { user: member, body: { tierId: 't1' } }],
    ['verifyPayment', 'verifyPayment', { user: member, body: {} }],
  ];

  it.each(cases)('%s wraps the service result and forwards errors', async (handler, method, req) => {
    const spy = spyOn(membershipService, method as any).mockResolvedValueOnce({ ok: 1 } as never);
    const ctx = mockReqRes(req);
    await (membershipController as any)[handler](ctx.req, ctx.res, ctx.next);
    expect(spy).toHaveBeenCalled();
    expect(ctx.res.json).toHaveBeenCalledWith({ success: true, data: { ok: 1 } });

    spy.mockRejectedValueOnce(new Error('boom') as never);
    const ctx2 = mockReqRes(req);
    await (membershipController as any)[handler](ctx2.req, ctx2.res, ctx2.next);
    expect(ctx2.next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('verifyPayment passes the caller id and razorpay fields', async () => {
    const spy = spyOn(membershipService, 'verifyPayment').mockResolvedValue({} as any);
    const ctx = mockReqRes({
      user: member,
      body: { razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 's', amount: 1 },
    });
    await membershipController.verifyPayment(ctx.req, ctx.res, ctx.next);
    expect(spy).toHaveBeenCalledWith(member.id, 'o', 'p', 's');
  });

  it('createTier responds 201 and audits; errors are forwarded', async () => {
    spyOn(membershipService, 'createTier').mockResolvedValue({ id: 'tier-9' } as any);
    prismaMock.auditLog.create.mockResolvedValue({});
    const ctx = mockReqRes({ user: admin, body: { name: 'Gold' } });
    await membershipController.createTier(ctx.req, ctx.res, ctx.next);
    expect(ctx.res.status).toHaveBeenCalledWith(201);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: admin.id, action: 'CREATE', entityType: 'MEMBERSHIP', entityId: 'tier-9' }),
    });

    const ctx2 = mockReqRes({ user: admin, body: { priceInr: -1 } });
    restoreSpies();
    await membershipController.createTier(ctx2.req, ctx2.res, ctx2.next);
    expect(ctx2.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('updateTier audits and forwards errors', async () => {
    spyOn(membershipService, 'updateTier').mockResolvedValue({ id: 't1' } as any);
    const ctx = mockReqRes({ user: admin, params: { id: 't1' }, body: { priceInr: 5 } });
    await membershipController.updateTier(ctx.req, ctx.res, ctx.next);
    expect(ctx.res.json).toHaveBeenCalledWith({ success: true, data: { id: 't1' } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'UPDATE', entityId: 't1' }),
    });

    restoreSpies();
    prismaMock.membershipTier.findUnique.mockResolvedValue(null);
    const ctx2 = mockReqRes({ user: admin, params: { id: 'x' }, body: { priceInr: 5 } });
    await membershipController.updateTier(ctx2.req, ctx2.res, ctx2.next);
    expect(ctx2.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('getMembershipHistory paginates for the caller', async () => {
    const spy = jest
      .spyOn(membershipService, 'getMembershipHistory')
      .mockResolvedValue({ data: [], pagination: { page: 2 } } as any);
    const ctx = mockReqRes({ user: member, query: { page: '2', limit: 'abc' } });
    await membershipController.getMembershipHistory(ctx.req, ctx.res, ctx.next);
    expect(spy).toHaveBeenCalledWith(member.id, 2, 20);
    expect(ctx.res.json).toHaveBeenCalledWith({ success: true, data: [], pagination: { page: 2 } });

    spy.mockRejectedValueOnce(new Error('x'));
    const ctx2 = mockReqRes({ user: member });
    await membershipController.getMembershipHistory(ctx2.req, ctx2.res, ctx2.next);
    expect(ctx2.next).toHaveBeenCalled();
  });

  it('getPaidMembers parses paging and forwards errors', async () => {
    const spy = spyOn(membershipService, 'getPaidMembers').mockResolvedValue({ data: [], pagination: {} } as any);
    const ctx = mockReqRes({ query: { page: '3', limit: '5' } });
    await membershipController.getPaidMembers(ctx.req, ctx.res, ctx.next);
    expect(spy).toHaveBeenCalledWith(3, 5);
    spy.mockRejectedValueOnce(new Error('x'));
    const ctx2 = mockReqRes();
    await membershipController.getPaidMembers(ctx2.req, ctx2.res, ctx2.next);
    expect(ctx2.next).toHaveBeenCalled();
  });
});

describe('DonationController (unit)', () => {
  const cases: Array<[keyof typeof donationController, keyof typeof donationService, Record<string, unknown>, unknown[]]> = [
    ['createOrder', 'createOrder', { user: member, body: { amount: 10 } }, [member.id, { amount: 10 }]],
    ['getFeaturedDonors', 'getFeaturedDonors', {}, []],
    ['getChapterDonations', 'getChapterDonations', {}, []],
    ['getMyDonations', 'getUserDonations', { user: member }, [member.id]],
    ['getStats', 'getDonationStats', {}, []],
    ['getLeaderboard', 'getDonationLeaderboard', { query: { limit: '5' } }, [5]],
  ];

  it.each(cases)('%s delegates and forwards errors', async (handler, method, req, args) => {
    const spy = spyOn(donationService, method as any).mockResolvedValueOnce({ ok: 1 } as never);
    const ctx = mockReqRes(req);
    await (donationController as any)[handler](ctx.req, ctx.res, ctx.next);
    expect(spy).toHaveBeenCalledWith(...args);
    expect(ctx.res.json).toHaveBeenCalledWith({ success: true, data: { ok: 1 } });

    spy.mockRejectedValueOnce(new Error('boom') as never);
    const ctx2 = mockReqRes(req);
    await (donationController as any)[handler](ctx2.req, ctx2.res, ctx2.next);
    expect(ctx2.next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('createOrder treats unauthenticated callers as guests', async () => {
    const spy = spyOn(donationService, 'createOrder').mockResolvedValue({} as any);
    const ctx = mockReqRes({ body: { amount: 10 } });
    await donationController.createOrder(ctx.req, ctx.res, ctx.next);
    expect(spy).toHaveBeenCalledWith(null, { amount: 10 });
  });

  it('getLeaderboard defaults to 10', async () => {
    const spy = spyOn(donationService, 'getDonationLeaderboard').mockResolvedValue([]);
    const ctx = mockReqRes({ query: { limit: 'abc' } });
    await donationController.getLeaderboard(ctx.req, ctx.res, ctx.next);
    expect(spy).toHaveBeenCalledWith(10);
  });

  it('verifyPayment forwards only the Razorpay fields (donation details come from the server-side order)', async () => {
    const spy = spyOn(donationService, 'verifyPayment').mockResolvedValue({} as any);
    const ctx = mockReqRes({
      user: member,
      body: {
        razorpay_order_id: 'o',
        razorpay_payment_id: 'p',
        razorpay_signature: 's',
        amount: 999999,
        chapterId: 'evil',
        isAnonymous: true,
        message: 'hi',
        dedicatedTo: 'Mom',
      },
    });
    await donationController.verifyPayment(ctx.req, ctx.res, ctx.next);
    expect(spy).toHaveBeenCalledWith(member.id, 'o', 'p', 's');

    spy.mockRejectedValueOnce(new Error('x'));
    const ctx2 = mockReqRes({ body: {} });
    await donationController.verifyPayment(ctx2.req, ctx2.res, ctx2.next);
    expect(spy).toHaveBeenLastCalledWith(null, undefined, undefined, undefined);
    expect(ctx2.next).toHaveBeenCalled();
  });

  it('getDonorsWall parses paging and spreads the paginated result', async () => {
    const spy = spyOn(donationService, 'getDonorsWall').mockResolvedValue({ data: [], pagination: {} } as any);
    const ctx = mockReqRes({ query: { page: '2' } });
    await donationController.getDonorsWall(ctx.req, ctx.res, ctx.next);
    expect(spy).toHaveBeenCalledWith(2, 20);
    expect(ctx.res.json).toHaveBeenCalledWith({ success: true, data: [], pagination: {} });
    spy.mockRejectedValueOnce(new Error('x'));
    const ctx2 = mockReqRes();
    await donationController.getDonorsWall(ctx2.req, ctx2.res, ctx2.next);
    expect(ctx2.next).toHaveBeenCalled();
  });
});

describe('TransactionController.getReceipt', () => {
  const txn = (overrides: Record<string, unknown> = {}) => ({
    id: '7e57ab1e-0000-4000-8000-000000000000',
    userId: member.id,
    type: 'DONATION',
    status: 'SUCCESS',
    amount: 500,
    gatewayPaymentId: 'pay_1',
    createdAt: new Date('2026-04-05T12:00:00Z'),
    user: { fullName: 'Member', email: 'm@aitd.test' },
    donations: [{ dedicatedTo: null, message: 'hi', chapter: { name: 'Pune' } }],
    memberships: [],
    ...overrides,
  });

  const run = async (user: any, found: unknown) => {
    prismaMock.transaction.findUnique.mockResolvedValue(found);
    const ctx = mockReqRes({ params: { id: 'txn' }, user });
    await transactionController.getReceipt(ctx.req, ctx.res, ctx.next);
    return ctx;
  };

  beforeEach(() => {
    (generateDonationReceipt as jest.Mock).mockClear();
    (generateMembershipReceipt as jest.Mock).mockClear();
  });

  it('lets the owner download a donation receipt PDF with correct headers', async () => {
    const ctx = await run(member, txn());
    expect(ctx.next).not.toHaveBeenCalled();
    expect(ctx.res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(ctx.res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="receipt_7e57ab1e-0000-4000-8000-000000000000.pdf"'
    );
    const buf: Buffer = ctx.res.send.mock.calls[0][0];
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(ctx.res.setHeader).toHaveBeenCalledWith('Content-Length', buf.length);
    expect((generateDonationReceipt as jest.Mock).mock.calls[0][0]).toMatchObject({
      receiptNumber: 'AITD-DON-20260405-7E57AB1E',
      amount: 500,
      chapterName: 'Pune',
      paymentId: 'pay_1',
    });
  });

  it('produces the same receipt number on every download', async () => {
    await run(member, txn());
    await run(member, txn());
    const calls = (generateDonationReceipt as jest.Mock).mock.calls;
    expect(calls[0][0].receiptNumber).toBe(calls[1][0].receiptNumber);
  });

  it('lets an admin download any receipt', async () => {
    const ctx = await run(admin, txn({ userId: 'someone-else' }));
    expect(ctx.res.send).toHaveBeenCalled();
  });

  it('renders a guest donation receipt for an admin from the donor details in metadata', async () => {
    const ctx = await run(
      admin,
      txn({ userId: null, user: null, metadata: { donorName: 'Guest Donor', donorEmail: 'guest@example.com' } })
    );
    expect(ctx.res.send).toHaveBeenCalled();
    expect((generateDonationReceipt as jest.Mock).mock.calls[0][0]).toMatchObject({
      donorName: 'Guest Donor',
      donorEmail: 'guest@example.com',
    });
  });

  it('never lets a member download a guest receipt', async () => {
    const ctx = await run(member, txn({ userId: null, user: null, metadata: { donorName: 'Guest Donor' } }));
    expect(ctx.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("returns 403 for another member's receipt", async () => {
    const ctx = await run({ id: 'intruder', userRole: 'MEMBER' }, txn());
    expect(ctx.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(ctx.res.send).not.toHaveBeenCalled();
  });

  it('chapter admins are not admins for receipts', async () => {
    const ctx = await run({ id: 'ca', userRole: 'CHAPTER_ADMIN' }, txn());
    expect(ctx.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('404s for unknown transactions', async () => {
    const ctx = await run(member, null);
    expect(ctx.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it.each(['PENDING', 'FAILED', 'REFUNDED'])('refuses %s transactions', async (status) => {
    const ctx = await run(member, txn({ status }));
    expect(ctx.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(generateDonationReceipt).not.toHaveBeenCalled();
  });

  it('404s when donation details are missing', async () => {
    const ctx = await run(member, txn({ donations: [] }));
    expect(ctx.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('renders membership receipts, with lifetime tiers passing a null end date', async () => {
    const ctx = await run(
      member,
      txn({
        type: 'MEMBERSHIP',
        gatewayPaymentId: null,
        donations: [],
        memberships: [{ startDate: new Date('2026-04-05'), endDate: null, tier: { name: 'Lifetime' } }],
      })
    );
    expect(ctx.res.send).toHaveBeenCalled();
    expect((generateMembershipReceipt as jest.Mock).mock.calls[0][0]).toMatchObject({
      receiptNumber: 'AITD-MEM-20260405-7E57AB1E',
      membershipTier: 'Lifetime',
      endDate: null,
      paymentId: '7e57ab1e-0000-4000-8000-000000000000',
    });
  });

  it('404s when membership details are missing', async () => {
    const ctx = await run(member, txn({ type: 'MEMBERSHIP', memberships: [] }));
    expect(ctx.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('rejects other transaction types', async () => {
    const ctx = await run(member, txn({ type: 'EVENT' }));
    expect(ctx.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('payment routes', () => {
  const original = { ...config.razorpay };
  afterEach(() => {
    config.razorpay.keyId = original.keyId;
    config.razorpay.keySecret = original.keySecret;
  });

  it('POST /api/memberships/order returns 503 PAYMENT_NOT_CONFIGURED without Razorpay keys', async () => {
    config.razorpay.keyId = '';
    config.razorpay.keySecret = '';
    const { header } = authAs('MEMBER');
    prismaMock.membershipTier.findUnique.mockResolvedValue({ id: 't1', priceInr: 100, isActive: true });
    const res = await api().post('/api/memberships/order').set('Authorization', header).send({ tierId: 't1' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, error: { code: 'PAYMENT_NOT_CONFIGURED' } });
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it('POST /api/donations/order returns 503 for guests without Razorpay keys', async () => {
    config.razorpay.keyId = '';
    config.razorpay.keySecret = '';
    const res = await api().post('/api/donations/order').send({ amount: 100 });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PAYMENT_NOT_CONFIGURED');
  });

  it('POST /api/donations/order validates the amount before touching Razorpay', async () => {
    const res = await api().post('/api/donations/order').send({ amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/memberships/verify requires authentication', async () => {
    await api().post('/api/memberships/verify').send({}).expect(401);
  });

  it('POST /api/memberships/tiers is admin-only and validated', async () => {
    const m = authAs('MEMBER');
    await api().post('/api/memberships/tiers').set('Authorization', m.header).send({}).expect(403);
    const a = authAs('ADMIN');
    const res = await api()
      .post('/api/memberships/tiers')
      .set('Authorization', a.header)
      .send({ name: 'Gold', priceInr: -10, benefits: [] });
    expect(res.status).toBe(400);
    expect(prismaMock.membershipTier.create).not.toHaveBeenCalled();
  });

  it("GET /api/transactions/:id/receipt forbids another member's receipt", async () => {
    const { header } = authAs('MEMBER');
    prismaMock.transaction.findUnique.mockResolvedValue({
      id: 't',
      userId: 'someone-else',
      status: 'SUCCESS',
      type: 'DONATION',
    });
    const res = await api().get('/api/transactions/t/receipt').set('Authorization', header);
    expect(res.status).toBe(403);
  });

  it('GET /api/transactions/:id/receipt streams a PDF to the owner', async () => {
    const { user, header } = authAs('MEMBER');
    prismaMock.transaction.findUnique.mockResolvedValue({
      id: 'abcd1234-0000',
      userId: user.id,
      status: 'SUCCESS',
      type: 'DONATION',
      amount: 100,
      gatewayPaymentId: 'pay_x',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      user: { fullName: 'M', email: 'm@x.y' },
      donations: [{ chapter: null }],
      memberships: [],
    });
    const res = await api()
      .get('/api/transactions/abcd1234-0000/receipt')
      .set('Authorization', header)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="receipt_abcd1234-0000.pdf"');
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
