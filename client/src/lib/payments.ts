import { getApiErrorMessage, type PaymentOrder, type RazorpayVerification } from '@/lib/api';

const RAZORPAY_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export const PAYMENT_UNAVAILABLE_MESSAGE =
  "Online payments aren't available right now. Please try again later or contact the alumni office.";

/** Friendly message for payment API errors, incl. 503 PAYMENT_NOT_CONFIGURED. */
export function getPaymentErrorMessage(err: unknown, fallback: string): string {
  const response = (err as any)?.response;
  const code = response?.data?.error?.code ?? response?.data?.code;
  if (code === 'PAYMENT_NOT_CONFIGURED' || response?.status === 503) {
    return PAYMENT_UNAVAILABLE_MESSAGE;
  }
  return getApiErrorMessage(err, fallback);
}

let scriptPromise: Promise<void> | null = null;

/** Load Razorpay Checkout once per page. */
export function loadRazorpay(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Razorpay requires a browser'));
  if ((window as any).Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = RAZORPAY_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        script.remove();
        reject(new Error('Could not load the payment window. Check your connection and try again.'));
      };
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

interface CheckoutOptions {
  name?: string;
  description: string;
  prefill?: { name?: string; email?: string };
  /** Called with the razorpay_* fields to verify server-side. */
  onSuccess: (verification: RazorpayVerification) => void | Promise<void>;
  onDismiss?: () => void;
}

/** Build the Razorpay Checkout options for a server-created order. */
export function buildCheckoutOptions(order: PaymentOrder, opts: CheckoutOptions) {
  return {
    key: order.keyId,
    amount: order.amount, // paise, as returned by the server
    currency: order.currency,
    name: opts.name ?? 'AIEM Connection',
    description: opts.description,
    order_id: order.orderId,
    prefill: opts.prefill ?? {},
    theme: { color: '#002045' },
    handler: (response: RazorpayVerification) =>
      opts.onSuccess({
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
      }),
    modal: { ondismiss: () => opts.onDismiss?.() },
  };
}

export async function openRazorpayCheckout(order: PaymentOrder, opts: CheckoutOptions): Promise<void> {
  await loadRazorpay();
  const Razorpay = (window as any).Razorpay;
  const rzp = new Razorpay(buildCheckoutOptions(order, opts));
  rzp.open();
}
