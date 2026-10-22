import Razorpay from 'razorpay';
import crypto from 'crypto';
import config from '../config';
import { AppError } from '../middleware/errorHandler';

/**
 * Razorpay integration helpers.
 *
 * The SDK client is created lazily so that a deployment without payment
 * credentials still boots (PRD §8.3 graceful degradation); payment endpoints
 * respond with a 503 PAYMENT_NOT_CONFIGURED error instead.
 */

/** Smallest amount Razorpay accepts for INR (₹1). */
export const MIN_AMOUNT_INR = 1;
/** Upper bound for a single online payment (₹10,00,000). */
export const MAX_AMOUNT_INR = 1_000_000;

let cachedClient: Razorpay | null = null;
let cachedKeyId: string | null = null;

export const isRazorpayConfigured = (): boolean =>
  Boolean(config.razorpay.keyId && config.razorpay.keySecret);

const notConfigured = () =>
  new AppError('Payments are not configured. Missing Razorpay credentials.', 503, 'PAYMENT_NOT_CONFIGURED');

/** Returns a Razorpay SDK client, or throws a 503 AppError when keys are missing. */
export const getRazorpayClient = (): Razorpay => {
  if (!isRazorpayConfigured()) throw notConfigured();

  if (!cachedClient || cachedKeyId !== config.razorpay.keyId) {
    cachedClient = new Razorpay({
      key_id: config.razorpay.keyId,
      key_secret: config.razorpay.keySecret,
    });
    cachedKeyId = config.razorpay.keyId;
  }
  return cachedClient;
};

/** Test hook: forget the memoised SDK client. */
export const resetRazorpayClient = () => {
  cachedClient = null;
  cachedKeyId = null;
};

/** Constant-time comparison of two hex/ascii strings (length-checked). */
export const safeCompare = (expected: string, received: string): boolean => {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

export const hmacSha256Hex = (payload: string | Buffer, secret: string): string =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

/**
 * Verifies the checkout signature returned by Razorpay:
 * HMAC-SHA256(`${orderId}|${paymentId}`, keySecret), compared in constant time.
 * Never returns true when the secret or any input is missing.
 */
export const verifyPaymentSignature = (
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string = config.razorpay.keySecret
): boolean => {
  if (!secret || !orderId || !paymentId || !signature) return false;
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') return false;
  return safeCompare(hmacSha256Hex(`${orderId}|${paymentId}`, secret), signature);
};

/**
 * Verifies a Razorpay webhook signature: HMAC-SHA256 of the *raw* request body
 * (exact bytes, before JSON parsing or sanitisation) with the webhook secret,
 * compared in constant time against the `X-Razorpay-Signature` header.
 */
export const verifyWebhookSignature = (payload: string | Buffer, signature: string, secret: string): boolean => {
  if (!secret || !signature || typeof signature !== 'string') return false;
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return false;
  return safeCompare(hmacSha256Hex(payload, secret), signature);
};

/**
 * Validates an INR amount and converts it to integer paise.
 * Throws a 400 AppError for non-numeric, out-of-range or sub-paisa amounts.
 */
export const toPaise = (
  amountInr: unknown,
  { min = MIN_AMOUNT_INR, max = MAX_AMOUNT_INR }: { min?: number; max?: number } = {}
): number => {
  const amount = typeof amountInr === 'string' && amountInr.trim() !== '' ? Number(amountInr) : amountInr;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new AppError('Amount must be a valid number', 400, 'VALIDATION_ERROR');
  }
  if (amount < min) {
    throw new AppError(`Amount must be at least ₹${min}`, 400, 'VALIDATION_ERROR');
  }
  if (amount > max) {
    throw new AppError(`Amount cannot exceed ₹${max}`, 400, 'VALIDATION_ERROR');
  }
  const paise = Math.round(amount * 100);
  if (Math.abs(paise - amount * 100) > 1e-6) {
    throw new AppError('Amount cannot have more than two decimal places', 400, 'VALIDATION_ERROR');
  }
  return paise;
};

export const fromPaise = (paise: number | string): number => Number(paise) / 100;

/**
 * Razorpay limits `receipt` to 40 characters.
 * Format: `<prefix>_<first 8 of id>_<base36 timestamp>`.
 */
export const buildOrderReceipt = (prefix: string, id?: string | null, now: number = Date.now()): string =>
  `${prefix}_${(id || 'guest').replace(/-/g, '').slice(0, 8)}_${now.toString(36)}`.slice(0, 40);
