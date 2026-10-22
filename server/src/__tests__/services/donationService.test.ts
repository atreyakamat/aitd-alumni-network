import crypto from 'crypto';

const ordersCreate = jest.fn();
const ordersFetch = jest.fn();
const ordersEdit = jest.fn();
jest.mock('../../utils/razorpay', () => {
  const actual = jest.requireActual('../../utils/razorpay');
  return {
    ...actual,
    getRazorpayClient: jest.fn(() => ({ orders: { create: ordersCreate, fetch: ordersFetch, edit: ordersEdit } })),
  };
});
jest.mock('../../utils/storage', () => ({
  uploadBufferToStorage: jest.fn().mockResolvedValue('https://cdn.test/receipts/d.pdf'),
}));
jest.mock('../../utils/pdfReceipt', () => {
  const actual = jest.requireActual('../../utils/pdfReceipt');
  return { ...actual, generateDonationReceipt: jest.fn().mockResolvedValue(Buffer.from('%PDF-')) };
});

import config from '../../config';
import { prismaMock } from '../../../tests/helpers';
import { donationService } from '../../services/donationService';
import { getRazorpayClient } from '../../utils/razorpay';
import { AppError } from '../../middleware/errorHandler';
import { generateDonationReceipt } from '../../utils/pdfReceipt';
import { uploadBufferToStorage } from '../../utils/storage';
import { sendEmail } from '../../utils/email';

const SECRET = 'donation_test_secret';
const USER = 'user-1';
const sign = (o: string, p: string) => crypto.createHmac('sha256', SECRET).update(`${o}|${p}`).digest('hex');
const SIG = sign('order_1', 'pay_1');

const txn = (overrides: Record<string, unknown> = {}) => ({
  id: 'txn-1',
  userId: USER,
  type: 'DONATION',
  amount: 500,
  status: 'PENDING',
  gatewayOrderId: 'order_1',
  metadata: { isAnonymous: false, dedicatedTo: 'Mom', message: 'Hi', chapterId: 'ch-1' },
  createdAt: new Date('2026-02-03T00:00:00Z'),
  ...overrides,
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

const original = { ...config.razorpay };
beforeEach(() => {
  config.razorpay.keyId = 'rzp_test_key';
  config.razorpay.keySecret = SECRET;
  [ordersCreate, ordersFetch, ordersEdit].forEach((m) => m.mockReset());
  (getRazorpayClient as jest.Mock).mockClear();
  (generateDonationReceipt as jest.Mock).mockClear();
  (uploadBufferToStorage as jest.Mock).mockClear();
});
afterAll(() => {
  config.razorpay.keyId = original.keyId;
  config.razorpay.keySecret = original.keySecret;
});

describe('createOrder', () => {
  beforeEach(() => {
    ordersCreate.mockResolvedValue({ id: 'order_1', amount: 50050, currency: 'INR' });
  });

  it('converts the amount to integer paise and stores a PENDING transaction for members', async () => {
    prismaMock.chapter.findUnique.mockResolvedValue({ id: 'ch-1', isActive: true });
    const result = await donationService.createOrder(USER, {
      amount: 500.5,
      isAnonymous: true,
      dedicatedTo: ' Mom ',
      message: 'Hi',
      chapterId: 'ch-1',
    });

    const order = ordersCreate.mock.calls[0][0];
    expect(order.amount).toBe(50050);
    expect(order.receipt.length).toBeLessThanOrEqual(40);
    expect(order.notes).toEqual({ userId: USER, type: 'donation', isAnonymous: 'true', chapterId: 'ch-1' });
    expect(prismaMock.transaction.create).toHaveBeenCalledWith({
      data: {
        userId: USER,
        type: 'DONATION',
        amount: 500.5,
        status: 'PENDING',
        gatewayOrderId: 'order_1',
        metadata: { isAnonymous: true, dedicatedTo: 'Mom', message: 'Hi', chapterId: 'ch-1', amountPaise: 50050 },
      },
    });
    expect(result).toEqual({ orderId: 'order_1', amount: 50050, currency: 'INR', keyId: 'rzp_test_key' });
  });

  it('stores a durable PENDING guest transaction (no user) with the donor details in metadata', async () => {
    prismaMock.chapter.findUnique.mockResolvedValue({ id: 'ch-1', isActive: true });
    await donationService.createOrder(null, {
      amount: 500.5,
      isAnonymous: true,
      message: 'For the library',
      chapterId: 'ch-1',
      donorName: ' Guest Donor ',
      donorEmail: ' Guest@Example.COM ',
    });
    expect(ordersCreate.mock.calls[0][0].notes.userId).toBe('guest');
    expect(ordersCreate.mock.calls[0][0].notes.isAnonymous).toBe('true');
    expect(prismaMock.transaction.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        type: 'DONATION',
        amount: 500.5,
        status: 'PENDING',
        gatewayOrderId: 'order_1',
        metadata: {
          isAnonymous: true,
          message: 'For the library',
          chapterId: 'ch-1',
          amountPaise: 50050,
          donorName: 'Guest Donor',
          donorEmail: 'guest@example.com',
        },
      },
    });
  });

  it('accepts a guest order without donor details', async () => {
    await donationService.createOrder(null, { amount: 100 });
    expect(prismaMock.transaction.create.mock.calls[0][0].data).toMatchObject({
      userId: null,
      metadata: { isAnonymous: false, amountPaise: 10000 },
    });
  });

  it('never stores donor name/email for members (their account is the source of truth)', async () => {
    await donationService.createOrder(USER, { amount: 100, donorName: 'Spoof', donorEmail: 'spoof@x.y' });
    const { metadata } = prismaMock.transaction.create.mock.calls[0][0].data;
    expect(metadata.donorName).toBeUndefined();
    expect(metadata.donorEmail).toBeUndefined();
  });

  it('validates guest donor details before creating the Razorpay order', async () => {
    await expectAppError(donationService.createOrder(null, { amount: 10, donorEmail: 'not-an-email' }), 400);
    await expectAppError(donationService.createOrder(null, { amount: 10, donorName: 'x'.repeat(101) }), 400);
    await expectAppError(donationService.createOrder(null, { amount: 10, donorEmail: 42 as any }), 400);
    expect(ordersCreate).not.toHaveBeenCalled();
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it.each([[0], [0.99], [-5], [1_000_001], ['ten'], [NaN], [10.123]])('rejects amount %p', async (amount) => {
    await expectAppError(donationService.createOrder(USER, { amount: amount as number }), 400, 'VALIDATION_ERROR');
    expect(ordersCreate).not.toHaveBeenCalled();
  });

  it('accepts the minimum of ₹1', async () => {
    await donationService.createOrder(USER, { amount: 1 });
    expect(ordersCreate.mock.calls[0][0].amount).toBe(100);
  });

  it('rejects missing body, oversized messages and non-string fields', async () => {
    await expectAppError(donationService.createOrder(USER, undefined as any), 400);
    await expectAppError(donationService.createOrder(USER, { amount: 10, message: 'x'.repeat(1001) }), 400);
    await expectAppError(donationService.createOrder(USER, { amount: 10, dedicatedTo: 'x'.repeat(201) }), 400);
    await expectAppError(donationService.createOrder(USER, { amount: 10, message: 5 as any }), 400);
  });

  it('404s for an unknown or inactive chapter', async () => {
    prismaMock.chapter.findUnique.mockResolvedValueOnce(null);
    await expectAppError(donationService.createOrder(USER, { amount: 10, chapterId: 'x' }), 404);
    prismaMock.chapter.findUnique.mockResolvedValueOnce({ id: 'x', isActive: false });
    await expectAppError(donationService.createOrder(USER, { amount: 10, chapterId: 'x' }), 404);
    expect(ordersCreate).not.toHaveBeenCalled();
  });

  it('returns 503 when Razorpay is not configured', async () => {
    (getRazorpayClient as jest.Mock).mockImplementationOnce(() => {
      throw new AppError('Payments are not configured.', 503, 'PAYMENT_NOT_CONFIGURED');
    });
    await expectAppError(donationService.createOrder(USER, { amount: 10 }), 503, 'PAYMENT_NOT_CONFIGURED');
  });
});

describe('verifyPayment (signed-in donor)', () => {
  const arrange = (t = txn()) => {
    prismaMock.transaction.findFirst.mockResolvedValue(t);
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.donation.create.mockImplementation(async ({ data }: any) => ({ id: 'don-1', ...data }));
    prismaMock.user.findUnique.mockResolvedValue({ id: USER, fullName: 'U', email: 'u@x.y' });
    prismaMock.chapter.findUnique.mockResolvedValue({ id: 'ch-1', name: 'Pune' });
  };

  it('records the donation from server-side data and increments the chapter total once', async () => {
    arrange();
    const result = await donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG);

    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'txn-1', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SUCCESS', gatewayPaymentId: 'pay_1', gatewaySignature: SIG },
    });
    expect(prismaMock.donation.create).toHaveBeenCalledWith({
      data: {
        userId: USER,
        amount: 500,
        isAnonymous: false,
        dedicatedTo: 'Mom',
        message: 'Hi',
        chapterId: 'ch-1',
        transactionId: 'txn-1',
      },
    });
    expect(prismaMock.chapter.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.chapter.update).toHaveBeenCalledWith({
      where: { id: 'ch-1' },
      data: { totalDonations: { increment: 500 } },
    });
    expect(result).toMatchObject({ alreadyVerified: false, donation: { id: 'don-1' } });

    const receipt = (generateDonationReceipt as jest.Mock).mock.calls[0][0];
    expect(receipt).toMatchObject({ amount: 500, chapterName: 'Pune', receiptNumber: 'AITD-DON-20260203-TXN1' });
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'txn-1' },
      data: { receiptUrl: 'https://cdn.test/receipts/d.pdf' },
    });
  });

  it('does not touch chapter totals for donations without a chapter', async () => {
    arrange(txn({ metadata: { isAnonymous: true } }));
    await donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG);
    expect(prismaMock.donation.create.mock.calls[0][0].data.isAnonymous).toBe(true);
    expect(prismaMock.chapter.update).not.toHaveBeenCalled();
  });

  it('handles a transaction without metadata', async () => {
    arrange(txn({ metadata: null }));
    await donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG);
    expect(prismaMock.donation.create.mock.calls[0][0].data).toMatchObject({ isAnonymous: false, chapterId: undefined });
  });

  it('marks FAILED and records nothing on an invalid signature', async () => {
    arrange();
    await expectAppError(donationService.verifyPayment(USER, 'order_1', 'pay_1', 'bad'), 400, 'INVALID_SIGNATURE');
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'txn-1' },
      data: { status: 'FAILED', gatewayPaymentId: 'pay_1' },
    });
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
    expect(prismaMock.chapter.update).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-SUCCESS transaction (no double count)', async () => {
    arrange(txn({ status: 'SUCCESS' }));
    prismaMock.donation.findFirst.mockResolvedValue({ id: 'don-existing' });
    const result = await donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG);
    expect(result).toMatchObject({ alreadyVerified: true, donation: { id: 'don-existing' } });
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
    expect(prismaMock.chapter.update).not.toHaveBeenCalled();
  });

  it('rejects a bad signature on a SUCCESS transaction without downgrading it', async () => {
    arrange(txn({ status: 'SUCCESS' }));
    await expectAppError(donationService.verifyPayment(USER, 'order_1', 'pay_1', 'bad'), 400);
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
  });

  it('handles a lost race (0 rows claimed) without creating a donation', async () => {
    arrange();
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.donation.findFirst.mockResolvedValue({ id: 'don-winner' });
    const result = await donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG);
    expect(result.alreadyVerified).toBe(true);
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
    expect(prismaMock.chapter.update).not.toHaveBeenCalled();
  });

  it("forbids verifying another user's order, including as a guest", async () => {
    arrange(txn({ userId: 'other' }));
    await expectAppError(donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG), 403, 'FORBIDDEN');
    arrange(txn());
    await expectAppError(donationService.verifyPayment(null, 'order_1', 'pay_1', SIG), 403);
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
  });

  it('refuses refunded transactions', async () => {
    arrange(txn({ status: 'REFUNDED' }));
    await expectAppError(donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG), 409);
  });

  it('requires all Razorpay fields and a configured secret', async () => {
    await expectAppError(donationService.verifyPayment(USER, '', 'pay_1', SIG), 400, 'VALIDATION_ERROR');
    config.razorpay.keySecret = '';
    await expectAppError(donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG), 503);
  });

  it('survives receipt failures and missing users', async () => {
    arrange();
    (generateDonationReceipt as jest.Mock).mockRejectedValueOnce(new Error('pdf'));
    await expect(donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG)).resolves.toMatchObject({
      alreadyVerified: false,
    });
    arrange();
    prismaMock.user.findUnique.mockResolvedValue(null);
    (generateDonationReceipt as jest.Mock).mockClear();
    await donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG);
    expect(generateDonationReceipt).not.toHaveBeenCalled();
  });
});

describe('completeTransaction (shared by client verify and webhook)', () => {
  const arrange = () => {
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.donation.create.mockImplementation(async ({ data }: any) => ({ id: 'don-1', ...data }));
    prismaMock.user.findUnique.mockResolvedValue({ id: USER, fullName: 'U', email: 'u@x.y' });
    prismaMock.chapter.findUnique.mockResolvedValue({ id: 'ch-1', name: 'Pune' });
  };

  it('claims without a signature (webhook) and attributes the donation to the transaction owner', async () => {
    arrange();
    const result = await donationService.completeTransaction(txn() as any, { paymentId: 'pay_9' });
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'txn-1', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SUCCESS', gatewayPaymentId: 'pay_9' },
    });
    expect(prismaMock.donation.create.mock.calls[0][0].data.userId).toBe(USER);
    expect(result).toMatchObject({ alreadyVerified: false, donation: { id: 'don-1' } });
    expect((generateDonationReceipt as jest.Mock).mock.calls[0][0].paymentId).toBe('pay_9');
  });

  it('can defer the receipt so the caller is not blocked by PDF generation', async () => {
    arrange();
    let finishReceipt: (b: Buffer) => void = () => undefined;
    (generateDonationReceipt as jest.Mock).mockImplementationOnce(
      () => new Promise<Buffer>((resolve) => (finishReceipt = resolve))
    );
    const result = await donationService.completeTransaction(txn() as any, { paymentId: 'pay_9' }, { deferReceipt: true });
    expect(result.alreadyVerified).toBe(false);
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
    finishReceipt(Buffer.from('%PDF-'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'txn-1' },
      data: { receiptUrl: 'https://cdn.test/receipts/d.pdf' },
    });
  });

  it('falls back to the transaction id on the receipt when no payment id is known', async () => {
    arrange();
    await donationService.completeTransaction(txn() as any, {});
    expect((generateDonationReceipt as jest.Mock).mock.calls[0][0].paymentId).toBe('txn-1');
  });
});

describe('verifyPayment (guest)', () => {
  const guestTxn = (overrides: Record<string, unknown> = {}) =>
    txn({
      userId: null,
      amount: 250,
      metadata: {
        isAnonymous: true,
        message: 'For the library',
        chapterId: 'ch-9',
        amountPaise: 25000,
        donorName: 'Guest Donor',
        donorEmail: 'guest@example.com',
      },
      ...overrides,
    });

  const arrange = (t: Record<string, unknown> = guestTxn()) => {
    prismaMock.transaction.findFirst.mockResolvedValue(t);
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.donation.create.mockImplementation(async ({ data }: any) => ({ id: 'don-guest', ...data }));
    prismaMock.chapter.findUnique.mockResolvedValue({ id: 'ch-9', name: 'Delhi' });
    (sendEmail as jest.Mock).mockClear();
  };

  it('completes the PENDING guest transaction from server-side metadata only', async () => {
    arrange();
    const result = await donationService.verifyPayment(null, 'order_1', 'pay_1', SIG);

    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'txn-1', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SUCCESS', gatewayPaymentId: 'pay_1', gatewaySignature: SIG },
    });
    expect(prismaMock.donation.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        amount: 250,
        isAnonymous: true,
        dedicatedTo: undefined,
        message: 'For the library',
        chapterId: 'ch-9',
        transactionId: 'txn-1',
      },
    });
    expect(prismaMock.chapter.update).toHaveBeenCalledWith({
      where: { id: 'ch-9' },
      data: { totalDonations: { increment: 250 } },
    });
    expect(ordersFetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ alreadyVerified: false, donation: { id: 'don-guest' } });
  });

  it('issues the receipt to the guest from metadata and e-mails it', async () => {
    arrange();
    await donationService.verifyPayment(null, 'order_1', 'pay_1', SIG);

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect((generateDonationReceipt as jest.Mock).mock.calls[0][0]).toMatchObject({
      donorName: 'Guest Donor',
      donorEmail: 'guest@example.com',
      amount: 250,
      chapterName: 'Delhi',
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(mail.to).toBe('guest@example.com');
    expect(mail.subject).toMatch(/receipt/i);
    expect(mail.attachments).toEqual([
      expect.objectContaining({ filename: expect.stringMatching(/^AITD-DON-.*\.pdf$/), contentType: 'application/pdf' }),
    ]);
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'txn-1' },
      data: { receiptUrl: 'https://cdn.test/receipts/d.pdf' },
    });
  });

  it('still stores a receipt (but sends no e-mail) for a guest who gave no e-mail', async () => {
    arrange(guestTxn({ metadata: { isAnonymous: false, amountPaise: 25000 } }));
    await donationService.verifyPayment(null, 'order_1', 'pay_1', SIG);
    expect((generateDonationReceipt as jest.Mock).mock.calls[0][0]).toMatchObject({ donorName: 'Guest Donor', donorEmail: '' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(prismaMock.transaction.update).toHaveBeenCalled();
  });

  it('keeps the receipt when the e-mail fails', async () => {
    arrange();
    (sendEmail as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));
    await expect(donationService.verifyPayment(null, 'order_1', 'pay_1', SIG)).resolves.toMatchObject({
      alreadyVerified: false,
    });
    expect(prismaMock.transaction.update).toHaveBeenCalled();
  });

  it('lets a signed-in caller holding a valid signature verify a guest order without claiming it', async () => {
    arrange();
    await donationService.verifyPayment(USER, 'order_1', 'pay_1', SIG);
    expect(prismaMock.donation.create.mock.calls[0][0].data.userId).toBeNull();
  });

  it('marks the guest transaction FAILED on an invalid signature', async () => {
    arrange();
    await expectAppError(donationService.verifyPayment(null, 'order_1', 'pay_1', 'bad'), 400, 'INVALID_SIGNATURE');
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'txn-1' },
      data: { status: 'FAILED', gatewayPaymentId: 'pay_1' },
    });
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
  });

  it('is idempotent once the webhook has completed the guest transaction', async () => {
    arrange(guestTxn({ status: 'SUCCESS' }));
    prismaMock.donation.findFirst.mockResolvedValue({ id: 'don-webhook' });
    const result = await donationService.verifyPayment(null, 'order_1', 'pay_1', SIG);
    expect(result).toMatchObject({ alreadyVerified: true, donation: { id: 'don-webhook' } });
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
  });
});

describe('verifyPayment (legacy guest order without a transaction row)', () => {
  const guestOrder = (notes: Record<string, string> = {}) => ({
    id: 'order_1',
    amount: 25000,
    currency: 'INR',
    notes: { userId: 'guest', type: 'donation', isAnonymous: 'true', chapterId: 'ch-9', ...notes },
  });

  beforeEach(() => {
    prismaMock.transaction.findFirst.mockResolvedValue(null);
    prismaMock.transaction.create.mockImplementation(async ({ data }: any) => ({
      id: 'txn-adopted',
      createdAt: new Date('2026-10-14T00:00:00Z'),
      ...data,
    }));
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.donation.create.mockImplementation(async ({ data }: any) => ({ id: 'don-guest', ...data }));
  });

  it('adopts the order as a guest transaction (amount from Razorpay, not the client) and completes it', async () => {
    ordersFetch.mockResolvedValue(guestOrder());
    const result = await donationService.verifyPayment(null, 'order_1', 'pay_1', SIG);

    expect(prismaMock.transaction.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        type: 'DONATION',
        amount: 250,
        currency: 'INR',
        status: 'PENDING',
        gatewayOrderId: 'order_1',
        metadata: { isAnonymous: true, chapterId: 'ch-9', amountPaise: 25000, legacyOrder: true },
      },
    });
    expect(prismaMock.donation.create.mock.calls[0][0].data).toMatchObject({
      userId: null,
      amount: 250,
      isAnonymous: true,
      chapterId: 'ch-9',
      transactionId: 'txn-adopted',
    });
    expect(result).toMatchObject({ alreadyVerified: false });
  });

  it('returns the donation already recorded by the old flow (tagged on the order)', async () => {
    ordersFetch.mockResolvedValue(guestOrder({ donationId: 'don-old' }));
    prismaMock.donation.findUnique.mockResolvedValue({ id: 'don-old' });
    const result = await donationService.verifyPayment(null, 'order_1', 'pay_1', SIG);
    expect(result).toMatchObject({ alreadyVerified: true, donation: { id: 'don-old' } });
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
  });

  it('uses the row a concurrent verify adopted first (unique order id)', async () => {
    ordersFetch.mockResolvedValue(guestOrder());
    prismaMock.transaction.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    prismaMock.transaction.findUnique.mockResolvedValue({ id: 'txn-other', userId: null, type: 'DONATION', status: 'SUCCESS' });
    prismaMock.donation.findFirst.mockResolvedValue({ id: 'don-other' });
    const result = await donationService.verifyPayment(null, 'order_1', 'pay_1', SIG);
    expect(result).toMatchObject({ alreadyVerified: true, donation: { id: 'don-other' } });
  });

  it('rejects an invalid signature before contacting Razorpay', async () => {
    await expectAppError(donationService.verifyPayment(null, 'order_1', 'pay_1', 'bad'), 400, 'INVALID_SIGNATURE');
    expect(ordersFetch).not.toHaveBeenCalled();
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
  });

  it('404s when the order cannot be fetched or is not a donation', async () => {
    ordersFetch.mockRejectedValueOnce(new Error('404'));
    await expectAppError(donationService.verifyPayment(null, 'order_1', 'pay_1', SIG), 404);
    ordersFetch.mockResolvedValueOnce({ id: 'order_1', amount: 100, notes: { type: 'membership' } });
    await expectAppError(donationService.verifyPayment(null, 'order_1', 'pay_1', SIG), 404);
    ordersFetch.mockResolvedValueOnce(null);
    await expectAppError(donationService.verifyPayment(null, 'order_1', 'pay_1', SIG), 404);
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it('refuses to record a member order whose transaction is missing', async () => {
    ordersFetch.mockResolvedValue(guestOrder({ userId: 'someone' }));
    await expectAppError(donationService.verifyPayment(null, 'order_1', 'pay_1', SIG), 404);
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
  });
});

describe('public listings never expose anonymous donors or e-mails', () => {
  it('donor wall excludes anonymous and unsuccessful donations and never selects email', async () => {
    prismaMock.donation.findMany.mockResolvedValue([]);
    prismaMock.donation.count.mockResolvedValue(0);
    const result = await donationService.getDonorsWall(1, 500);
    const args = prismaMock.donation.findMany.mock.calls[0][0];
    expect(args.where.isAnonymous).toBe(false);
    expect(args.where.OR).toEqual([{ transactionId: null }, { transaction: { is: { status: 'SUCCESS' } } }]);
    expect(args.select.user.select.email).toBeUndefined();
    expect(args.select.user.select.fullName).toBe(true);
    expect(args.take).toBe(100);
    expect(prismaMock.donation.count).toHaveBeenCalledWith({ where: args.where });
    expect(result).toMatchObject({ data: [], pagination: { total: 0 } });
  });

  it('featured donors exclude anonymous donations', async () => {
    prismaMock.donation.findMany.mockResolvedValue([]);
    await donationService.getFeaturedDonors();
    const args = prismaMock.donation.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ isFeatured: true, isAnonymous: false });
    expect(args.select.user.select.email).toBeUndefined();
    expect(args.take).toBe(10);
  });

  it('leaderboard excludes anonymous/guest donations, clamps limit and hides email', async () => {
    prismaMock.donation.groupBy.mockResolvedValue([
      { userId: 'u1', _sum: { amount: { toString: () => '1500.5', valueOf: () => 1500.5 } } },
      { userId: 'u-deleted', _sum: { amount: 100 } },
    ]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', fullName: 'One' }]);
    const result = await donationService.getDonationLeaderboard(1000);

    const args = prismaMock.donation.groupBy.mock.calls[0][0];
    expect(args.where).toMatchObject({ userId: { not: null }, isAnonymous: false });
    expect(args.take).toBe(50);
    expect(prismaMock.user.findMany.mock.calls[0][0].select.email).toBeUndefined();
    expect(result).toEqual([{ user: { id: 'u1', fullName: 'One' }, totalAmount: 1500.5 }]);
  });

  it('leaderboard handles empty data and bad limits', async () => {
    prismaMock.donation.groupBy.mockResolvedValue([]);
    await expect(donationService.getDonationLeaderboard(NaN)).resolves.toEqual([]);
    expect(prismaMock.donation.groupBy.mock.calls[0][0].take).toBe(10);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    await donationService.getDonationLeaderboard(-3);
    expect(prismaMock.donation.groupBy.mock.calls[1][0].take).toBe(1);
  });
});

describe('stats, chapters, mine, featuring', () => {
  it('aggregates SUCCESS donations only and returns numbers', async () => {
    prismaMock.donation.aggregate
      .mockResolvedValueOnce({ _sum: { amount: { toString: () => '1200.50', valueOf: () => 1200.5 } } })
      .mockResolvedValueOnce({ _sum: { amount: 200 } });
    prismaMock.donation.count.mockResolvedValue(7);
    const stats = await donationService.getDonationStats();
    expect(stats).toEqual({ totalAmount: 1200.5, totalDonors: 7, donationCount: 7, thisMonthAmount: 200 });
    for (const call of prismaMock.donation.aggregate.mock.calls) {
      expect(call[0].where.OR).toEqual([{ transactionId: null }, { transaction: { is: { status: 'SUCCESS' } } }]);
    }
    expect(prismaMock.donation.count.mock.calls[0][0].where.OR).toBeDefined();
  });

  it('returns zeros (not null/NaN) on an empty database', async () => {
    prismaMock.donation.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prismaMock.donation.count.mockResolvedValue(0);
    await expect(donationService.getDonationStats()).resolves.toEqual({
      totalAmount: 0,
      totalDonors: 0,
      donationCount: 0,
      thisMonthAmount: 0,
    });
  });

  it('lists active chapters by total', async () => {
    prismaMock.chapter.findMany.mockResolvedValue([]);
    await donationService.getChapterDonations();
    expect(prismaMock.chapter.findMany.mock.calls[0][0]).toMatchObject({
      where: { isActive: true },
      orderBy: { totalDonations: 'desc' },
    });
  });

  it("returns only the caller's donations", async () => {
    prismaMock.donation.findMany.mockResolvedValue([]);
    await donationService.getUserDonations(USER);
    expect(prismaMock.donation.findMany.mock.calls[0][0].where).toEqual({ userId: USER });
    await expectAppError(donationService.getUserDonations(''), 401);
  });

  it('features a donation or 404s', async () => {
    prismaMock.donation.findUnique.mockResolvedValueOnce({ id: 'd1' });
    prismaMock.donation.update.mockResolvedValue({ id: 'd1', isFeatured: true });
    await donationService.featureDonor('d1', true);
    expect(prismaMock.donation.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { isFeatured: true } });
    prismaMock.donation.findUnique.mockResolvedValueOnce(null);
    await expectAppError(donationService.featureDonor('nope', true), 404);
  });
});
