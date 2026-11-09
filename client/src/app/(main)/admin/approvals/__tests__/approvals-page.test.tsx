/**
 * The registration review page, run through the REAL api client (interceptors, adminApi) against a fake server that answers with
 * the exact shapes of server/src/services/memberApprovalService.ts and docs/API_REFERENCE.md:
 *   GET  /admin/approvals          -> { success, data: Application[], pagination }
 *   GET  /admin/approvals/summary  -> { success, data: { pending, approved, rejected } }
 *   POST /admin/approvals/:id/approve { note? } -> { success, data: Application }  (409 ALREADY_APPROVED | EMAIL_NOT_VERIFIED, 404)
 *   POST /admin/approvals/:id/reject  { reason } -> { success, data: Application } (409 NOT_PENDING)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/approvals',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ user: { id: 'admin1', fullName: 'Admin One', role: 'ADMIN', userRole: 'ADMIN' }, isLoading: false, isAuthenticated: true }),
}));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import { api } from '@/lib/api';
import ApprovalsPage from '@/app/(main)/admin/approvals/page';

type Application = Record<string, unknown>;

const application = (over: Application = {}): Application => ({
  id: 'u1',
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  batchYear: 2019,
  department: 'Computer Science',
  degree: 'B.Tech',
  roleType: 'ALUMNI',
  enrollmentNumber: 'AIEM/2019/042',
  verificationNote: 'B.Tech CS 2015-2019. Prof. Rao taught my batch.',
  linkedinUrl: 'https://www.linkedin.com/in/ada',
  isActive: true,
  createdAt: '2026-11-01T10:00:00.000Z',
  emailVerifiedAt: '2026-11-01T11:00:00.000Z',
  approvalStatus: 'PENDING',
  approvalReviewedAt: null,
  approvalNote: null,
  approvalReviewedBy: null,
  ...over,
});

const page = (rows: Application[], over: Record<string, unknown> = {}) => ({
  success: true,
  data: rows,
  pagination: { page: 1, limit: 20, total: rows.length, totalPages: rows.length ? 1 : 0, hasNextPage: false, hasPrevPage: false, ...over },
});

interface Call {
  method: string;
  url: string;
  params: Record<string, unknown> | undefined;
  body: unknown;
}

/** The fake server: a handler per "METHOD /path"; anything unhandled is a failing test, not a silent 200. */
type Reply = { status?: number; data: unknown };
let handlers: Record<string, (call: Call) => Reply | Promise<Reply>> = {};
let calls: Call[] = [];
let realAdapter: unknown;

const respond = (config: InternalAxiosRequestConfig, status: number, data: unknown) => {
  const response = { status, statusText: String(status), headers: {}, config, data };
  if (status < 400) return Promise.resolve(response);
  return Promise.reject(new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, null, response));
};

const apiError = (status: number, code: string, message: string): Reply => ({ status, data: { success: false, error: { code, message } } });

const installServer = () => {
  api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    const call: Call = {
      method: String(config.method).toUpperCase(),
      url: String(config.url),
      params: config.params,
      body: typeof config.data === 'string' && config.data ? JSON.parse(config.data) : undefined,
    };
    calls.push(call);
    const handler = handlers[`${call.method} ${call.url}`];
    if (!handler) return respond(config, 500, { success: false, error: { message: `unhandled ${call.method} ${call.url}` } });
    const reply = await handler(call);
    return respond(config, reply.status ?? 200, reply.data);
  }) as unknown as AxiosAdapter;
};

const listCalls = () => calls.filter((c) => c.method === 'GET' && c.url === '/admin/approvals');
const postCalls = () => calls.filter((c) => c.method === 'POST');

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApprovalsPage />
    </QueryClientProvider>
  );
};

const pendingRows = [application()];

beforeEach(() => {
  realAdapter = api.defaults.adapter;
  calls = [];
  toast.mockReset();
  handlers = {
    'GET /admin/approvals/summary': () => ({ data: { success: true, data: { pending: 3, approved: 40, rejected: 1 } } }),
    'GET /admin/approvals': (call) => ({ data: call.params?.status === 'PENDING' ? page(pendingRows) : page([]) }),
  };
  installServer();
});
afterEach(() => {
  api.defaults.adapter = realAdapter as any;
});

const card = (name: string) => screen.getByRole('article', { name: new RegExp(name, 'i') });

describe('the review queue', () => {
  it('asks for the PENDING registrations first and shows everything the reviewer needs to decide', async () => {
    renderPage();
    const c = await screen.findByRole('article', { name: /ada lovelace/i });

    expect(listCalls()[0].params).toMatchObject({ status: 'PENDING', page: 1 });
    expect(within(c).getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(within(c).getByText('ada@example.com')).toBeInTheDocument();
    expect(within(c).getByText(/e-mail verified/i)).toBeInTheDocument();
    expect(within(c).getByText('2019')).toBeInTheDocument();
    expect(within(c).getByText('Computer Science')).toBeInTheDocument();
    expect(within(c).getByText('B.Tech')).toBeInTheDocument();
    expect(within(c).getByText('Alumni')).toBeInTheDocument();
    expect(within(c).getByText('AIEM/2019/042')).toBeInTheDocument();
    expect(within(c).getByText('B.Tech CS 2015-2019. Prof. Rao taught my batch.')).toBeInTheDocument();
    expect(within(c).getByText(/1 Nov 2026/)).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: /^approve/i })).toBeEnabled();
    expect(within(c).getByRole('button', { name: /^reject/i })).toBeEnabled();
  });

  it('says clearly when the e-mail address is not verified yet', async () => {
    handlers['GET /admin/approvals'] = () => ({ data: page([application({ emailVerifiedAt: null })]) });
    renderPage();
    const c = await screen.findByRole('article', { name: /ada lovelace/i });
    expect(within(c).getByText(/e-mail not verified/i)).toBeInTheDocument();
    expect(within(c).queryByText(/^e-mail verified/i)).not.toBeInTheDocument();
  });

  it('shows the counts of the summary on the tabs', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: /pending\s*3/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /rejected\s*1/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /approved\s*40/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /pending/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('still works when the counts cannot be loaded', async () => {
    handlers['GET /admin/approvals/summary'] = () => apiError(500, 'INTERNAL', 'Counts are down');
    renderPage();
    expect(await screen.findByRole('article', { name: /ada lovelace/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /pending/i })).toBeInTheDocument();
  });

  it('renders what the applicant typed as plain text, never as HTML', async () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script><b>bold</b>';
    handlers['GET /admin/approvals'] = () => ({
      data: page([application({ verificationNote: hostile, enrollmentNumber: '<i>12</i>', fullName: 'Eve <u>Mallory</u>' })]),
    });
    const { container } = renderPage();
    expect(await screen.findByText(hostile)).toBeInTheDocument();
    expect(screen.getByText('<i>12</i>')).toBeInTheDocument();
    expect(container.querySelector('img, script, b, i, u')).toBeNull();
  });

  it('opens the LinkedIn profile safely in a new tab, and only for http(s) addresses', async () => {
    handlers['GET /admin/approvals'] = () => ({
      data: page([
        application({ id: 'u1', fullName: 'Ada Lovelace', linkedinUrl: 'https://www.linkedin.com/in/ada' }),
        application({ id: 'u2', fullName: 'Bad Actor', email: 'bad@example.com', linkedinUrl: 'javascript:alert(1)' }),
        application({ id: 'u3', fullName: 'Data Url', email: 'data@example.com', linkedinUrl: 'data:text/html,<script>alert(1)</script>' }),
        application({ id: 'u4', fullName: 'Mail To', email: 'mt@example.com', linkedinUrl: 'mailto:x@example.com' }),
        application({ id: 'u5', fullName: 'No Link', email: 'nl@example.com', linkedinUrl: null }),
      ]),
    });
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });

    const link = within(card('ada lovelace')).getByRole('link', { name: /linkedin/i });
    expect(link).toHaveAttribute('href', 'https://www.linkedin.com/in/ada');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);

    for (const name of ['bad actor', 'data url', 'mail to', 'no link']) {
      expect(within(card(name)).queryByRole('link', { name: /linkedin/i })).not.toBeInTheDocument();
    }
    expect(document.querySelector('a[href^="javascript:"], a[href^="data:"], a[href^="mailto:"]')).toBeNull();
  });
});

describe('approving', () => {
  const approved = (note: string | null = null) =>
    application({ approvalStatus: 'APPROVED', approvalReviewedAt: '2026-11-08T09:00:00.000Z', approvalNote: note, approvalReviewedBy: { id: 'admin1', fullName: 'Admin One' } });

  it('asks for an optional note, approves, then refreshes the list and the counts', async () => {
    let decided = false;
    handlers['GET /admin/approvals'] = () => ({ data: page(decided ? [] : pendingRows) });
    handlers['GET /admin/approvals/summary'] = () => ({
      data: { success: true, data: decided ? { pending: 2, approved: 41, rejected: 1 } : { pending: 3, approved: 40, rejected: 1 } },
    });
    handlers['POST /admin/approvals/u1/approve'] = () => {
      decided = true;
      return { data: { success: true, data: approved('Checked with the alumni office') } };
    };
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^approve/i }));

    const dialog = await screen.findByRole('dialog', { name: /approve ada lovelace/i });
    await userEvent.type(within(dialog).getByLabelText(/note/i), 'Checked with the alumni office');
    await userEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]).toMatchObject({ url: '/admin/approvals/u1/approve', body: { note: 'Checked with the alumni office' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/approved/i) }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    // the card is gone and the counts moved
    await waitFor(() => expect(screen.queryByRole('article', { name: /ada lovelace/i })).not.toBeInTheDocument());
    expect(await screen.findByRole('tab', { name: /pending\s*2/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /approved\s*41/i })).toBeInTheDocument();
  });

  it('sends no note at all when none is typed', async () => {
    handlers['POST /admin/approvals/u1/approve'] = () => ({ data: { success: true, data: approved() } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^approve/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0].body).toEqual({});
  });

  it('limits the note to 500 characters and counts them', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^approve/i }));
    const dialog = await screen.findByRole('dialog');
    const note = within(dialog).getByLabelText(/note/i);
    expect(note).toHaveAttribute('maxlength', '500');
    expect(within(dialog).getByText('0 / 500')).toBeInTheDocument();
    await userEvent.type(note, 'Fine');
    expect(within(dialog).getByText('4 / 500')).toBeInTheDocument();
  });

  it('shows the message of the server when the e-mail address is not verified, and keeps the dialog open', async () => {
    const message = 'This person has not verified their e-mail address yet. Approve after they have used the link we mailed to them.';
    handlers['POST /admin/approvals/u1/approve'] = () => apiError(409, 'EMAIL_NOT_VERIFIED', message);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^approve/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: message }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // can be tried again
    expect(within(dialog).getByRole('button', { name: /^approve$/i })).toBeEnabled();
  });

  it('refreshes the list when somebody else decided first (ALREADY_APPROVED)', async () => {
    handlers['POST /admin/approvals/u1/approve'] = () => apiError(409, 'ALREADY_APPROVED', 'This person is already approved');
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^approve/i }));
    const dialog = await screen.findByRole('dialog');
    const before = listCalls().length;
    await userEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already approved/i);
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
  });

  it('disables the buttons while the request runs, so it cannot be sent twice', async () => {
    let release!: () => void;
    handlers['POST /admin/approvals/u1/approve'] = () =>
      new Promise<Reply>((resolve) => {
        release = () => resolve({ data: { success: true, data: approved() } });
      });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^approve/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));

    await waitFor(() => expect(within(dialog).getByRole('button', { name: /approving/i })).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: /cancel/i })).toBeDisabled();
    expect(postCalls()).toHaveLength(1);

    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(postCalls()).toHaveLength(1);
  });
});

describe('rejecting', () => {
  const rejectedApp = (reason: string) =>
    application({ approvalStatus: 'REJECTED', approvalReviewedAt: '2026-11-08T09:00:00.000Z', approvalNote: reason, approvalReviewedBy: { id: 'admin1', fullName: 'Admin One' } });

  const openReject = async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^reject/i }));
    return screen.findByRole('dialog', { name: /reject ada lovelace/i });
  };

  it('tells the reviewer that the applicant receives the reason by e-mail', async () => {
    renderPage();
    const dialog = await openReject();
    expect(within(dialog).getByText(/receives this reason by e-mail/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/reason/i)).toHaveAttribute('maxlength', '500');
  });

  it('does not send anything without a reason, or with fewer than 3 characters', async () => {
    renderPage();
    const dialog = await openReject();

    await userEvent.click(within(dialog).getByRole('button', { name: /^reject registration$/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/3 to 500 characters/i);
    expect(postCalls()).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText(/reason/i), '  a ');
    await userEvent.click(within(dialog).getByRole('button', { name: /^reject registration$/i }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/3 to 500 characters/i);
    expect(postCalls()).toHaveLength(0);
  });

  it('rejects with the reason (trimmed), then refreshes', async () => {
    let decided = false;
    handlers['GET /admin/approvals'] = () => ({ data: page(decided ? [] : pendingRows) });
    handlers['POST /admin/approvals/u1/reject'] = () => {
      decided = true;
      return { data: { success: true, data: rejectedApp('Not on the batch list') } };
    };
    renderPage();
    const dialog = await openReject();
    await userEvent.type(within(dialog).getByLabelText(/reason/i), '  Not on the batch list ');
    await userEvent.click(within(dialog).getByRole('button', { name: /^reject registration$/i }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]).toMatchObject({ url: '/admin/approvals/u1/reject', body: { reason: 'Not on the batch list' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/rejected/i) }));
    await waitFor(() => expect(screen.queryByRole('article', { name: /ada lovelace/i })).not.toBeInTheDocument());
  });

  it('accepts exactly 3 characters', async () => {
    handlers['POST /admin/approvals/u1/reject'] = () => ({ data: { success: true, data: rejectedApp('abc') } });
    renderPage();
    const dialog = await openReject();
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'abc');
    await userEvent.click(within(dialog).getByRole('button', { name: /^reject registration$/i }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
  });

  it('shows the message of the server when the registration was already decided (NOT_PENDING) and refreshes', async () => {
    handlers['POST /admin/approvals/u1/reject'] = () =>
      apiError(409, 'NOT_PENDING', 'Only a registration that is waiting for approval can be rejected');
    renderPage();
    const dialog = await openReject();
    const before = listCalls().length;
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Not an alumnus');
    await userEvent.click(within(dialog).getByRole('button', { name: /^reject registration$/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/waiting for approval can be rejected/i);
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
  });

  it('disables the buttons while the request runs', async () => {
    let release!: () => void;
    handlers['POST /admin/approvals/u1/reject'] = () =>
      new Promise<Reply>((resolve) => {
        release = () => resolve({ data: { success: true, data: rejectedApp('Not an alumnus') } });
      });
    renderPage();
    const dialog = await openReject();
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Not an alumnus');
    await userEvent.click(within(dialog).getByRole('button', { name: /^reject registration$/i }));

    await waitFor(() => expect(within(dialog).getByRole('button', { name: /rejecting/i })).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: /cancel/i })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(postCalls()).toHaveLength(1);
  });
});

describe('the other tabs', () => {
  const reviewed = (status: 'APPROVED' | 'REJECTED', over: Application = {}) =>
    application({
      id: status === 'APPROVED' ? 'a1' : 'r1',
      fullName: status === 'APPROVED' ? 'Grace Hopper' : 'Mallory Mallet',
      email: status === 'APPROVED' ? 'grace@example.com' : 'mallory@example.com',
      approvalStatus: status,
      approvalReviewedAt: '2026-11-05T09:00:00.000Z',
      approvalNote: status === 'APPROVED' ? 'Verified with the batch list' : 'Not on any batch list',
      approvalReviewedBy: { id: 'admin1', fullName: 'Admin One' },
      ...over,
    });

  beforeEach(() => {
    handlers['GET /admin/approvals'] = (call) => ({
      data:
        call.params?.status === 'APPROVED'
          ? page([reviewed('APPROVED')])
          : call.params?.status === 'REJECTED'
            ? page([reviewed('REJECTED')])
            : page(pendingRows),
    });
  });

  it('Rejected shows who decided, when, and the reason', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /rejected/i }));

    const c = await screen.findByRole('article', { name: /mallory mallet/i });
    expect(listCalls().at(-1)?.params).toMatchObject({ status: 'REJECTED', page: 1 });
    expect(within(c).getByText(/rejected by admin one/i)).toBeInTheDocument();
    expect(within(c).getByText(/5 Nov 2026/)).toBeInTheDocument();
    expect(within(c).getByText('Not on any batch list')).toBeInTheDocument();
    expect(within(c).queryByRole('button', { name: /^reject/i })).not.toBeInTheDocument();
  });

  it('a rejection can be reversed: the server allows approving a rejected registration', async () => {
    handlers['POST /admin/approvals/r1/approve'] = () => ({ data: { success: true, data: reviewed('APPROVED', { id: 'r1' }) } });
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /rejected/i }));
    const c = await screen.findByRole('article', { name: /mallory mallet/i });
    await userEvent.click(within(c).getByRole('button', { name: /^approve/i }));
    const dialog = await screen.findByRole('dialog', { name: /approve mallory mallet/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0].url).toBe('/admin/approvals/r1/approve');
  });

  it('Approved shows who approved, when, and the note, and has no buttons', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /approved/i }));

    const c = await screen.findByRole('article', { name: /grace hopper/i });
    expect(within(c).getByText(/approved by admin one/i)).toBeInTheDocument();
    expect(within(c).getByText(/5 Nov 2026/)).toBeInTheDocument();
    expect(within(c).getByText('Verified with the batch list')).toBeInTheDocument();
    expect(within(c).queryByRole('button')).not.toBeInTheDocument();
  });

  it('copes with a reviewer who no longer exists', async () => {
    handlers['GET /admin/approvals'] = () => ({ data: page([reviewed('APPROVED', { approvalReviewedBy: null })]) });
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /approved/i }));
    expect(await screen.findByText(/approved by an administrator/i)).toBeInTheDocument();
  });
});

describe('search, paging and the empty and error states', () => {
  it('searches (after a short pause) and starts again from page 1', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    await userEvent.type(screen.getByRole('searchbox', { name: /search registrations/i }), 'ada');

    await waitFor(() => expect(listCalls().at(-1)?.params).toMatchObject({ status: 'PENDING', search: 'ada', page: 1 }));
  });

  it('pages through long queues', async () => {
    handlers['GET /admin/approvals'] = (call) => ({
      data:
        call.params?.page === 2
          ? page([application({ id: 'u21', fullName: 'Twenty One', email: 'tw@example.com' })], { page: 2, total: 21, totalPages: 2, hasPrevPage: true, hasNextPage: false })
          : page(pendingRows, { page: 1, total: 21, totalPages: 2, hasNextPage: true }),
    });
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(await screen.findByRole('article', { name: /twenty one/i })).toBeInTheDocument();
    expect(listCalls().at(-1)?.params).toMatchObject({ status: 'PENDING', page: 2 });
  });

  it('says so when nobody is waiting', async () => {
    handlers['GET /admin/approvals'] = () => ({ data: page([]) });
    renderPage();
    expect(await screen.findByText(/no registrations are waiting for approval/i)).toBeInTheDocument();
  });

  it('says so when a search finds nothing', async () => {
    handlers['GET /admin/approvals'] = (call) => ({ data: call.params?.search ? page([]) : page(pendingRows) });
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    await userEvent.type(screen.getByRole('searchbox', { name: /search registrations/i }), 'zzz');
    expect(await screen.findByText(/no registrations match/i)).toBeInTheDocument();
  });

  it('shows the message of the server when the list cannot be loaded, and loads it again on retry', async () => {
    let fail = true;
    handlers['GET /admin/approvals'] = () => (fail ? apiError(500, 'INTERNAL', 'Database is down') : { data: page(pendingRows) });
    renderPage();
    expect(await screen.findByText('Database is down')).toBeInTheDocument();

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('article', { name: /ada lovelace/i })).toBeInTheDocument();
  });
});
