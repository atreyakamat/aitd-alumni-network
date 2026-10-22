import crypto from 'crypto';

jest.mock('razorpay', () => jest.fn().mockImplementation((opts: unknown) => ({ opts, orders: {} })));

import Razorpay from 'razorpay';
import config from '../../config';
import {
  buildOrderReceipt,
  fromPaise,
  getRazorpayClient,
  hmacSha256Hex,
  isRazorpayConfigured,
  MAX_AMOUNT_INR,
  resetRazorpayClient,
  safeCompare,
  toPaise,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from '../../utils/razorpay';

const SECRET = 'test_secret';
const sign = (orderId: string, paymentId: string, secret = SECRET) =>
  crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

const original = { ...config.razorpay };

afterEach(() => {
  config.razorpay.keyId = original.keyId;
  config.razorpay.keySecret = original.keySecret;
  resetRazorpayClient();
  (Razorpay as unknown as jest.Mock).mockClear();
});

describe('getRazorpayClient', () => {
  it('throws a 503 PAYMENT_NOT_CONFIGURED error when keys are missing', () => {
    config.razorpay.keyId = '';
    config.razorpay.keySecret = '';
    expect(isRazorpayConfigured()).toBe(false);
    expect(() => getRazorpayClient()).toThrow(
      expect.objectContaining({ statusCode: 503, code: 'PAYMENT_NOT_CONFIGURED' })
    );
    expect(Razorpay).not.toHaveBeenCalled();
  });

  it('throws when only one key is present', () => {
    config.razorpay.keyId = 'rzp_test';
    config.razorpay.keySecret = '';
    expect(() => getRazorpayClient()).toThrow(expect.objectContaining({ statusCode: 503 }));
  });

  it('creates the client lazily and memoises it per key id', () => {
    config.razorpay.keyId = 'rzp_test_1';
    config.razorpay.keySecret = SECRET;
    const a = getRazorpayClient();
    const b = getRazorpayClient();
    expect(a).toBe(b);
    expect(Razorpay).toHaveBeenCalledTimes(1);
    expect(Razorpay).toHaveBeenCalledWith({ key_id: 'rzp_test_1', key_secret: SECRET });

    config.razorpay.keyId = 'rzp_test_2';
    const c = getRazorpayClient();
    expect(c).not.toBe(a);
    expect(Razorpay).toHaveBeenCalledTimes(2);
  });
});

describe('verifyPaymentSignature', () => {
  it('accepts the HMAC-SHA256 of "orderId|paymentId" with the key secret', () => {
    expect(verifyPaymentSignature('order_1', 'pay_1', sign('order_1', 'pay_1'), SECRET)).toBe(true);
  });

  it('uses the configured secret by default', () => {
    config.razorpay.keySecret = SECRET;
    expect(verifyPaymentSignature('order_1', 'pay_1', sign('order_1', 'pay_1'))).toBe(true);
  });

  it('rejects a signature made with another secret, order or payment', () => {
    expect(verifyPaymentSignature('order_1', 'pay_1', sign('order_1', 'pay_1', 'other'), SECRET)).toBe(false);
    expect(verifyPaymentSignature('order_2', 'pay_1', sign('order_1', 'pay_1'), SECRET)).toBe(false);
    expect(verifyPaymentSignature('order_1', 'pay_2', sign('order_1', 'pay_1'), SECRET)).toBe(false);
  });

  it('rejects signatures of a different length without throwing', () => {
    const good = sign('order_1', 'pay_1');
    expect(verifyPaymentSignature('order_1', 'pay_1', good.slice(0, -1), SECRET)).toBe(false);
    expect(verifyPaymentSignature('order_1', 'pay_1', `${good}00`, SECRET)).toBe(false);
  });

  it('never verifies with an empty secret (forgeable HMAC)', () => {
    const forged = sign('order_1', 'pay_1', '');
    expect(verifyPaymentSignature('order_1', 'pay_1', forged, '')).toBe(false);
    config.razorpay.keySecret = '';
    expect(verifyPaymentSignature('order_1', 'pay_1', forged)).toBe(false);
  });

  it('rejects missing or non-string inputs', () => {
    expect(verifyPaymentSignature('', 'pay_1', 'x', SECRET)).toBe(false);
    expect(verifyPaymentSignature('order_1', '', 'x', SECRET)).toBe(false);
    expect(verifyPaymentSignature('order_1', 'pay_1', '', SECRET)).toBe(false);
    expect(verifyPaymentSignature({} as any, 'pay_1', 'x', SECRET)).toBe(false);
  });

  it('compares with crypto.timingSafeEqual', () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    verifyPaymentSignature('order_1', 'pay_1', sign('order_1', 'pay_1'), SECRET);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('verifyWebhookSignature', () => {
  it('validates the HMAC of the raw payload', () => {
    const payload = JSON.stringify({ event: 'payment.captured' });
    const sig = hmacSha256Hex(payload, 'whsec');
    expect(verifyWebhookSignature(payload, sig, 'whsec')).toBe(true);
    expect(verifyWebhookSignature(payload + ' ', sig, 'whsec')).toBe(false);
    expect(verifyWebhookSignature(payload, sig, '')).toBe(false);
    expect(verifyWebhookSignature(payload, '', 'whsec')).toBe(false);
    expect(verifyWebhookSignature(undefined as any, sig, 'whsec')).toBe(false);
  });

  it('verifies the raw request bytes (Buffer) exactly', () => {
    const raw = Buffer.from('{\n  "event": "payment.captured",\n  "note": "<b>₹</b>"\n}', 'utf8');
    const sig = crypto.createHmac('sha256', 'whsec').update(raw).digest('hex');
    expect(verifyWebhookSignature(raw, sig, 'whsec')).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), sig, 'whsec')).toBe(false);
    expect(verifyWebhookSignature(raw, sig.toUpperCase(), 'whsec')).toBe(false);
    expect(verifyWebhookSignature(raw, undefined as any, 'whsec')).toBe(false);
  });
});

describe('safeCompare', () => {
  it('handles equal, unequal, empty and non-string values', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
    expect(safeCompare('abc', 'abd')).toBe(false);
    expect(safeCompare('', '')).toBe(false);
    expect(safeCompare('abc', null as any)).toBe(false);
  });
});

describe('toPaise / fromPaise', () => {
  it('converts rupees to integer paise without float drift', () => {
    expect(toPaise(1)).toBe(100);
    expect(toPaise(499.99)).toBe(49999);
    expect(toPaise(19.99)).toBe(1999);
    expect(toPaise(0.1 + 0.2 + 0.7)).toBe(100);
    expect(toPaise('250')).toBe(25000);
    expect(Number.isInteger(toPaise(1234.56))).toBe(true);
    expect(fromPaise(49999)).toBe(499.99);
    expect(fromPaise('100')).toBe(1);
  });

  it.each([[0], [0.5], [-10], [MAX_AMOUNT_INR + 1], [NaN], [Infinity], ['abc'], [''], [null], [undefined], [{}]])(
    'rejects %p with a 400 VALIDATION_ERROR',
    (value) => {
      expect(() => toPaise(value)).toThrow(expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }));
    }
  );

  it('rejects sub-paisa precision', () => {
    expect(() => toPaise(10.005)).toThrow(/two decimal places/);
  });

  it('accepts the bounds and honours custom limits', () => {
    expect(toPaise(1)).toBe(100);
    expect(toPaise(MAX_AMOUNT_INR)).toBe(MAX_AMOUNT_INR * 100);
    expect(() => toPaise(50, { max: 10 })).toThrow(/cannot exceed/);
  });
});

describe('buildOrderReceipt', () => {
  it('stays within the 40 character Razorpay receipt limit', () => {
    const r = buildOrderReceipt('membership', '00000000-0000-4000-8000-000000000001', 1_700_000_000_000);
    expect(r.length).toBeLessThanOrEqual(40);
    expect(r).toBe(`membership_00000000_${(1_700_000_000_000).toString(36)}`);
  });

  it('uses "guest" for anonymous callers', () => {
    expect(buildOrderReceipt('don', null, 0)).toBe('don_guest_0');
  });
});
