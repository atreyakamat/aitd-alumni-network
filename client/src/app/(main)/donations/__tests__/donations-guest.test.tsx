import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

/**
 * Guest donations. The platform is private, but alumni donate without an account: /donations is the ONE page a visitor
 * may open, and for a visitor it is the donation form and nothing else. These tests run the real API client (interceptors
 * included) against a fake network, so they see exactly which requests the page makes and with which headers.
 */

const authState: { user: any; isLoading: boolean } = { user: null, isLoading: false };
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

// The Razorpay checkout is a third-party popup: the test plays its part
const checkout = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@/lib/payments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments')>()),
  openRazorpayCheckout: checkout.open,
}));

import DonationsPage from '@/app/(main)/donations/page';
import { api } from '@/lib/api';
import { PAYMENT_UNAVAILABLE_MESSAGE } from '@/lib/payments';

interface Sent {
  method: string;
  url: string;
  hasAuthorization: boolean;
  body: any;
}

const ORDER = { orderId: 'order_guest_1', amount: 100000, currency: 'INR', keyId: 'rzp_test_key' };
const VERIFICATION = { razorpay_order_id: 'order_guest_1', razorpay_payment_id: 'pay_guest_1', razorpay_signature: 'sig_guest_1' };

let sent: Sent[] = [];
let respond: (req: Sent) => { status: number; data: unknown };
let realAdapter: typeof api.defaults.adapter;

const ok = (data: unknown) => ({ status: 200, data: { success: true, data } });
const fail = (status: number, code: string, message: string) => ({ status, data: { success: false, error: { code, message } } });

const defaultResponses = (req: Sent) => {
  if (req.url === '/donations/order') return ok(ORDER);
  if (req.url === '/donations/verify') return ok({ alreadyVerified: false, donation: { id: 'd1', userId: null } });
  if (req.url === '/donations/stats') return ok({ totalAmount: 125000, totalDonors: 42, thisMonthAmount: 15000 });
  return ok([]);
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sent = [];
  respond = defaultResponses;
  authState.user = null;
  authState.isLoading = false;
  realAdapter = api.defaults.adapter;
  api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    const req: Sent = {
      method: String(config.method),
      url: String(config.url),
      hasAuthorization: config.headers.has('Authorization'),
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
    };
    sent.push(req);
    const { status, data } = respond(req);
    const response = { data, status, statusText: String(status), headers: {}, config };
    if (status >= 400) throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, response);
    return response;
  }) as AxiosAdapter;
  // open() remembers the options the page passed, so a test can finish or dismiss the payment like the popup would
  checkout.open.mockImplementation(async (_order: unknown, opts: unknown) => {
    (checkout as any).options = opts;
  });
});

afterEach(() => {
  api.defaults.adapter = realAdapter;
});

const finishPayment = () =>
  act(async () => {
    await (checkout as any).options.onSuccess(VERIFICATION);
  });
const dismissPayment = () =>
  act(() => {
    (checkout as any).options.onDismiss();
  });

const nameField = () => screen.getByRole('textbox', { name: /your name/i });
const emailField = () => screen.getByRole('textbox', { name: /e-mail for your receipt/i });
const messageField = () => screen.getByRole('textbox', { name: /message/i });
const donateButton = () => screen.getByRole('button', { name: /^donate/i });

describe('/donations as a visitor: the donation form and nothing else', () => {
  it('shows the form: name, e-mail, amount, message, anonymity and the donate button', () => {
    render(<DonationsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(nameField()).toBeInTheDocument();
    expect(emailField()).toBeInTheDocument();
    expect(messageField()).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /donate anonymously/i })).not.toBeChecked();
    for (const amount of ['₹500', '₹1,000', '₹2,500', '₹5,000', '₹10,000']) {
      expect(screen.getByRole('button', { name: amount })).toBeInTheDocument();
    }
    expect(screen.getByRole('spinbutton', { name: /other amount/i })).toBeInTheDocument();
    expect(donateButton()).toHaveTextContent('₹1,000');
  });

  it('shows none of the member widgets: no wall of donors, leaderboard, chapter totals, statistics or campaign progress', () => {
    render(<DonationsPage />);
    for (const text of [/wall of donors/i, /leaderboard/i, /by chapter/i, /recent contributors/i, /top contributors/i, /total donors/i, /this month/i, /campaign progress/i, /chapter contributions/i]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search donors/i)).not.toBeInTheDocument();
  });

  it('makes no request at all while nobody is signed in (a 401 from a private endpoint would show errors)', async () => {
    render(<DonationsPage />);
    // give any stray effect time to fire its request
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(sent).toEqual([]);
    expect(sent.filter((r) => /\/donations\/(wall|leaderboard|chapters|stats|featured|my)/.test(r.url))).toEqual([]);
  });

  it('links to sign in for people who do have an account, and to no other members-only page', () => {
    const { container } = render(<DonationsPage />);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login?next=%2Fdonations');
    const hrefs = Array.from(container.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/login?next=%2Fdonations']);
  });

  it('waits for the session check instead of flashing the visitor form to a member', () => {
    authState.isLoading = true;
    render(<DonationsPage />);
    expect(screen.queryByRole('textbox', { name: /your name/i })).not.toBeInTheDocument();
    expect(sent).toEqual([]);
  });
});

describe('/donations as a visitor: donating as a guest', () => {
  it('creates the order and verifies the payment with NO Authorization header, then thanks the donor', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);

    await user.type(nameField(), '  Asha Rao ');
    await user.type(emailField(), ' asha@example.com ');
    await user.type(messageField(), 'For the library');
    await user.click(screen.getByRole('button', { name: '₹2,500' }));
    await user.click(donateButton());

    await waitFor(() => expect(checkout.open).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: 'post',
      url: '/donations/order',
      hasAuthorization: false,
      body: { amount: 2500, isAnonymous: false, donorName: 'Asha Rao', donorEmail: 'asha@example.com', message: 'For the library' },
    });
    expect(checkout.open).toHaveBeenCalledWith(
      ORDER,
      expect.objectContaining({ prefill: { name: 'Asha Rao', email: 'asha@example.com' }, onSuccess: expect.any(Function) })
    );

    await finishPayment();

    // only the three Razorpay fields go to verify (the server holds every other detail), again without a token
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ method: 'post', url: '/donations/verify', hasAuthorization: false, body: VERIFICATION });
    expect(Object.keys(sent[1].body).sort()).toEqual(['razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature']);

    // the thank-you state replaces the form and says where the receipt went
    expect(await screen.findByText(/thank you/i)).toBeInTheDocument();
    expect(screen.getByText(/receipt has been e-mailed to asha@example\.com/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /your name/i })).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Thank you!' }));
    // and nothing else was fetched: no donor wall, no statistics
    expect(sent).toHaveLength(2);
  });

  it('sends no Authorization header even when the browser holds no tokens and the page has loaded nothing else', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.click(donateButton());
    await waitFor(() => expect(checkout.open).toHaveBeenCalled());
    await finishPayment();
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((r) => [r.url, r.hasAuthorization])).toEqual([
      ['/donations/order', false],
      ['/donations/verify', false],
    ]);
    // no name or e-mail given: those fields are simply left out
    expect(sent[0].body).toEqual({ amount: 1000, isAnonymous: false });
  });

  it('donates anonymously when asked', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.click(screen.getByRole('checkbox', { name: /donate anonymously/i }));
    await user.click(donateButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({ amount: 1000, isAnonymous: true });
  });

  it('accepts another amount in whole rupees', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.type(screen.getByRole('spinbutton', { name: /other amount/i }), '750');
    expect(donateButton()).toHaveTextContent('₹750');
    await user.click(donateButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body.amount).toBe(750);
  });

  it.each(['0', '-5', '1.5', '1000001'])('refuses the amount %s before contacting the server', async (typed) => {
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.type(screen.getByRole('spinbutton', { name: /other amount/i }), typed);
    await user.click(donateButton());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Enter a donation amount', variant: 'destructive' }));
    expect(sent).toEqual([]);
    expect(checkout.open).not.toHaveBeenCalled();
  });

  it('refuses an e-mail address that is not one, and says so next to the field', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.type(emailField(), 'not-an-email');
    await user.click(donateButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid e-mail/i);
    expect(emailField()).toHaveAttribute('aria-invalid', 'true');
    expect(sent).toEqual([]);
  });

  it('says so when payments are not configured, and lets the donor try again', async () => {
    respond = (req) => (req.url === '/donations/order' ? fail(503, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured') : defaultResponses(req));
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.click(donateButton());
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not start payment', description: PAYMENT_UNAVAILABLE_MESSAGE, variant: 'destructive' })
      )
    );
    expect(checkout.open).not.toHaveBeenCalled();
    await waitFor(() => expect(donateButton()).toBeEnabled());
  });

  it('shows the validation message of the server when it refuses the details', async () => {
    respond = (req) => (req.url === '/donations/order' ? fail(400, 'VALIDATION_ERROR', 'donorEmail must be a valid email address') : defaultResponses(req));
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.click(donateButton());
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not start payment', description: 'donorEmail must be a valid email address' }))
    );
  });

  it('keeps the form and tells the donor when the payment cannot be verified', async () => {
    respond = (req) => (req.url === '/donations/verify' ? fail(400, 'INVALID_SIGNATURE', 'Invalid payment signature') : defaultResponses(req));
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.click(donateButton());
    await waitFor(() => expect(checkout.open).toHaveBeenCalled());
    await finishPayment();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Payment verification failed', variant: 'destructive' }))
    );
    expect(screen.queryByText(/receipt has been e-mailed/i)).not.toBeInTheDocument();
    expect(nameField()).toBeInTheDocument();
    await waitFor(() => expect(donateButton()).toBeEnabled());
  });

  it('can be used again after a closed payment window', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.click(donateButton());
    await waitFor(() => expect(checkout.open).toHaveBeenCalled());
    expect(donateButton()).toBeDisabled();
    dismissPayment();
    await waitFor(() => expect(donateButton()).toBeEnabled());
  });

  it('says there was no receipt when no e-mail address was given, and offers to donate again with an empty form', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.type(nameField(), 'Asha');
    await user.click(donateButton());
    await waitFor(() => expect(checkout.open).toHaveBeenCalled());
    await finishPayment();
    expect(await screen.findByText(/no e-mail address was given/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /donate again/i }));
    expect(nameField()).toHaveValue('');
    expect(emailField()).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: /donate anonymously/i })).not.toBeChecked();
  });

  it('does not start a second payment while one is open', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);
    await user.click(donateButton());
    await waitFor(() => expect(checkout.open).toHaveBeenCalled());
    await user.click(donateButton());
    expect(sent.filter((r) => r.url === '/donations/order')).toHaveLength(1);
  });
});

describe('/donations as a signed-in member and when the session ends', () => {
  beforeEach(() => {
    authState.user = { id: 'donor-1', fullName: 'Current Donor', email: 'donor@example.com' };
  });

  it('shows a member the whole page (the four reads go out) and no guest form', async () => {
    render(<DonationsPage />);
    expect(await screen.findByRole('tab', { name: /leaderboard/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /wall of donors/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /by chapter/i })).toBeInTheDocument();
    expect(sent.map((r) => r.url).sort()).toEqual(['/donations/chapters', '/donations/leaderboard', '/donations/stats', '/donations/wall']);
    expect(screen.queryByRole('textbox', { name: /your name/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /donate anonymously/i })).not.toBeInTheDocument();
  });

  it('drops to the visitor form, and stops reading private data, when the member signs out or the session ends', async () => {
    const { rerender } = render(<DonationsPage />);
    expect(await screen.findByRole('tab', { name: /wall of donors/i })).toBeInTheDocument();
    const requestsAsMember = sent.length;

    authState.user = null;
    rerender(<DonationsPage />);

    expect(await screen.findByRole('textbox', { name: /your name/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(sent).toHaveLength(requestsAsMember);
  });

  it('a member donation still goes out as the member: no donor name or e-mail fields, the account supplies them', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);
    await screen.findByRole('tab', { name: /wall of donors/i });
    await user.click(within(document.body).getAllByRole('button', { name: /^donate/i })[0]);
    await waitFor(() => expect(sent.some((r) => r.url === '/donations/order')).toBe(true));
    const order = sent.find((r) => r.url === '/donations/order')!;
    expect(order.body).toEqual({ amount: 1000, isAnonymous: false });
    expect(checkout.open).toHaveBeenCalledWith(
      ORDER,
      expect.objectContaining({ prefill: { name: 'Current Donor', email: 'donor@example.com' } })
    );
  });
});
