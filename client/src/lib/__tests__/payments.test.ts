import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInstance = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  defaults: { baseURL: '' },
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
}));

vi.mock('axios', () => {
  const create = vi.fn(() => mockInstance);
  return { default: { create, post: vi.fn() }, create };
});

import { donationApi, membershipApi } from '@/lib/api';
import { PAYMENT_UNAVAILABLE_MESSAGE, buildCheckoutOptions, getPaymentErrorMessage } from '@/lib/payments';

const verification = {
  razorpay_order_id: 'order_1',
  razorpay_payment_id: 'pay_1',
  razorpay_signature: 'sig',
};

beforeEach(() => {
  mockInstance.post.mockReset();
  mockInstance.get.mockReset();
  mockInstance.post.mockResolvedValue({ data: { success: true, data: {} } });
  mockInstance.get.mockResolvedValue({ data: { success: true, data: [] } });
});

describe('donation request shapes', () => {
  it('POST /donations/order with the documented body', async () => {
    await donationApi.createOrder({ amount: 1000, isAnonymous: true, dedicatedTo: 'Batch 2010', chapterId: undefined });
    expect(mockInstance.post).toHaveBeenCalledWith('/donations/order', {
      amount: 1000,
      isAnonymous: true,
      dedicatedTo: 'Batch 2010',
    });
  });

  it('sends guest donor details with the order (stored server-side for the receipt)', async () => {
    await donationApi.createOrder({ amount: 500, donorName: 'Guest Donor', donorEmail: 'guest@example.com' });
    expect(mockInstance.post).toHaveBeenCalledWith('/donations/order', {
      amount: 500,
      donorName: 'Guest Donor',
      donorEmail: 'guest@example.com',
    });
  });

  it('POST /donations/verify with only the snake_case razorpay_* keys', async () => {
    await donationApi.verifyPayment({ ...verification, message: 'ignored' } as typeof verification);
    expect(mockInstance.post).toHaveBeenCalledWith('/donations/verify', verification);
  });
});

describe('membership request shapes', () => {
  it('POST /memberships/order with tierId', async () => {
    await membershipApi.createOrder('tier-1');
    expect(mockInstance.post).toHaveBeenCalledWith('/memberships/order', { tierId: 'tier-1' });
  });

  it('POST /memberships/verify with only the razorpay_* keys', async () => {
    await membershipApi.verifyPayment({ ...verification, extra: 'x' } as any);
    expect(mockInstance.post).toHaveBeenCalledWith('/memberships/verify', verification);
  });

  it('GET /memberships/history is paginated', async () => {
    await membershipApi.getHistory({ page: 2 });
    expect(mockInstance.get).toHaveBeenCalledWith('/memberships/history', { params: { page: 2 } });
  });
});

describe('getPaymentErrorMessage', () => {
  it('maps PAYMENT_NOT_CONFIGURED to a friendly message', () => {
    const err = {
      response: { status: 503, data: { success: false, error: { message: 'Missing Razorpay credentials.', code: 'PAYMENT_NOT_CONFIGURED' } } },
    };
    expect(getPaymentErrorMessage(err, 'f')).toBe(PAYMENT_UNAVAILABLE_MESSAGE);
  });

  it('passes through other server messages', () => {
    const err = { response: { status: 400, data: { success: false, error: { message: 'Amount too low', code: 'VALIDATION' } } } };
    expect(getPaymentErrorMessage(err, 'f')).toBe('Amount too low');
  });
});

describe('buildCheckoutOptions', () => {
  it('uses the server keyId/amount/order and forwards razorpay_* to onSuccess', async () => {
    const onSuccess = vi.fn();
    const opts = buildCheckoutOptions(
      { orderId: 'order_1', amount: 100000, currency: 'INR', keyId: 'rzp_test_key' },
      { description: 'Donation', onSuccess }
    );
    expect(opts).toMatchObject({ key: 'rzp_test_key', amount: 100000, currency: 'INR', order_id: 'order_1' });
    await opts.handler({ ...verification, extra: 1 } as any);
    expect(onSuccess).toHaveBeenCalledWith(verification);
  });
});
