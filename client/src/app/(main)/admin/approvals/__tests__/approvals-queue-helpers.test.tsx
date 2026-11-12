/**
 * The queue helpers of the review page, run through the REAL api client against a fake server that answers with the shapes of
 * server/src/services/memberApprovalService.ts:
 *   GET  /admin/approvals          -> items carry `match` { level, reason, recordId?, record? } and `waitingDays`
 *   GET  /admin/approvals/summary  -> { pending, approved, rejected, overdue, alumniRecords }
 *   POST /admin/approvals/bulk-approve { ids, note? }  -> { success, data: { results: [{ id, ok } | { id, ok: false, code, message }], succeeded, failed } }
 *   POST /admin/approvals/bulk-reject  { ids, reason } -> same shape
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/approvals',
  useSearchParams: () => new URLSearchParams(),
}));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import { api } from '@/lib/api';
import ApprovalsPage from '@/app/(main)/admin/approvals/page';

type Row = Record<string, unknown>;

const exactMatch = {
  level: 'exact',
  reason: 'The enrolment number, batch year and name are on the college list',
  recordId: 'rec-1',
  record: { batchYear: 2019, department: 'Computer Science' },
};

const application = (over: Row = {}): Row => ({
  id: 'u1',
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  batchYear: 2019,
  department: 'Computer Science',
  degree: 'B.Tech',
  roleType: 'ALUMNI',
  enrollmentNumber: 'AIEM/2019/042',
  verificationNote: null,
  linkedinUrl: null,
  isActive: true,
  createdAt: '2026-11-01T10:00:00.000Z',
  emailVerifiedAt: '2026-11-01T11:00:00.000Z',
  approvalStatus: 'PENDING',
  approvalReviewedAt: null,
  approvalNote: null,
  approvalReviewedBy: null,
  match: exactMatch,
  waitingDays: 3,
  ...over,
});

const page = (rows: Row[]) => ({
  success: true,
  data: rows,
  pagination: { page: 1, limit: 20, total: rows.length, totalPages: rows.length ? 1 : 0, hasNextPage: false, hasPrevPage: false },
});

interface Call {
  method: string;
  url: string;
  params: Record<string, unknown> | undefined;
  body: any;
}
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
const bulkCalls = () => calls.filter((c) => c.method === 'POST' && c.url.startsWith('/admin/approvals/bulk-'));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })}>
      <ApprovalsPage />
    </QueryClientProvider>
  );

const ADA = application();
const BEN = application({ id: 'u2', fullName: 'Ben Batch', email: 'ben@example.com', match: { level: 'probable', reason: 'The name and batch year are on the college list', recordId: 'rec-2', record: { batchYear: 2019, department: null } }, waitingDays: 9 });
const CHI = application({ id: 'u3', fullName: 'Chi Stranger', email: 'chi@example.com', match: { level: 'none', reason: 'Not found on the college list' }, waitingDays: 0 });
const DEV = application({ id: 'u4', fullName: 'Dev Unverified', email: 'dev@example.com', emailVerifiedAt: null, waitingDays: 1 });
const EVE = application({ id: 'u5', fullName: 'Eve Exact', email: 'eve@example.com' });

beforeEach(() => {
  realAdapter = api.defaults.adapter;
  calls = [];
  toast.mockReset();
  handlers = {
    'GET /admin/approvals/summary': () => ({ data: { success: true, data: { pending: 5, approved: 40, rejected: 1, overdue: 2, alumniRecords: 300 } } }),
    'GET /admin/approvals': () => ({ data: page([ADA, BEN, CHI, DEV, EVE]) }),
  };
  installServer();
});
afterEach(() => {
  api.defaults.adapter = realAdapter as never;
});

const card = (name: string) => screen.getByRole('article', { name: new RegExp(name, 'i') });

describe('match against the college list', () => {
  it('shows a badge per card with the reason and what the list holds about the match (batch and department only)', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    expect(within(card('ada lovelace')).getByText('Matches the college list')).toBeInTheDocument();
    expect(within(card('ada lovelace')).getByText(/college list: batch 2019, Computer Science/)).toBeInTheDocument();
    expect(within(card('ben batch')).getByText('Possible match')).toBeInTheDocument();
    expect(within(card('chi stranger')).getByText('Not on the list')).toBeInTheDocument();
    expect(within(card('chi stranger')).getByText('Not found on the college list')).toBeInTheDocument();
  });

  it('renders nothing about a match when an older server does not send one', async () => {
    handlers['GET /admin/approvals'] = () => ({ data: page([application({ match: undefined, waitingDays: undefined })]) });
    renderPage();
    const c = await screen.findByRole('article', { name: /ada lovelace/i });
    expect(within(c).queryByText(/college list|possible match|not on the list/i)).not.toBeInTheDocument();
    expect(within(c).queryByText(/waiting/i)).not.toBeInTheDocument();
  });

  it('does not break on a level it does not know', async () => {
    handlers['GET /admin/approvals'] = () => ({ data: page([application({ match: { level: 'strange', reason: 'whatever' } })]) });
    renderPage();
    const c = await screen.findByRole('article', { name: /ada lovelace/i });
    expect(within(c).getByText('Not on the list')).toBeInTheDocument();
  });

  it('points to the import when the college list is empty', async () => {
    handlers['GET /admin/approvals/summary'] = () => ({ data: { success: true, data: { pending: 5, approved: 40, rejected: 1, overdue: 0, alumniRecords: 0 } } });
    renderPage();
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(/has not been imported yet/i);
    expect(within(note).getByRole('link', { name: /import the list/i })).toHaveAttribute('href', '/admin/alumni-list');
  });

  it('links to the college list page from the header', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    expect(screen.getByRole('link', { name: /college alumni list/i })).toHaveAttribute('href', '/admin/alumni-list');
  });
});

describe('waiting', () => {
  it('says how long each application has waited, and marks 7 days or more as overdue', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    expect(within(card('ada lovelace')).getByText('Waiting 3 days')).toBeInTheDocument();
    expect(within(card('ada lovelace')).queryByText(/overdue/i)).not.toBeInTheDocument();
    const overdue = within(card('ben batch')).getByText(/Waiting 9 days/);
    expect(overdue).toHaveTextContent('Waiting 9 days (overdue)');
    expect(overdue.className).toMatch(/text-destructive/);
    expect(within(card('chi stranger')).getByText('Waiting less than a day')).toBeInTheDocument();
    expect(within(card('dev unverified')).getByText('Waiting 1 day')).toBeInTheDocument();
  });

  it('does not say "waiting" for a registration that was decided', async () => {
    handlers['GET /admin/approvals'] = () => ({ data: page([application({ approvalStatus: 'REJECTED', waitingDays: null, match: undefined })]) });
    renderPage();
    const c = await screen.findByRole('article', { name: /ada lovelace/i });
    expect(within(c).queryByText(/waiting/i)).not.toBeInTheDocument();
  });

  it('tells how many have waited 7 days or more and shows them on request', async () => {
    renderPage();
    const note = await screen.findByText(/2 applications have waited 7 days or more/i);
    expect(note).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show them/i }));
    await waitFor(() => expect(listCalls().some((c) => c.params?.waitingDays === 7)).toBe(true));
    expect(screen.getByRole('combobox', { name: /waiting time/i })).toHaveValue('7');
  });
});

describe('filters', () => {
  it('sends batch, department, match and waiting with the request, and can clear them again', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: /batch year/i }), '2019');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /department/i }), 'Civil');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /match with the college list/i }), 'exact');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /waiting time/i }), '14');

    await waitFor(() =>
      expect(listCalls().at(-1)!.params).toMatchObject({ status: 'PENDING', batchYear: 2019, department: 'Civil', match: 'exact', waitingDays: 14, page: 1 })
    );

    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    await waitFor(() => {
      const last = listCalls().at(-1)!.params!;
      expect(last.batchYear).toBeUndefined();
      expect(last.department).toBeUndefined();
      expect(last.match).toBeUndefined();
      expect(last.waitingDays).toBeUndefined();
    });
    expect(screen.getByRole('textbox', { name: /batch year/i })).toHaveValue('');
  });

  it('only accepts digits in the batch year and does not send half a year', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    const batch = screen.getByRole('textbox', { name: /batch year/i });
    await userEvent.type(batch, '20a1');
    expect(batch).toHaveValue('201');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(listCalls().every((c) => c.params?.batchYear === undefined)).toBe(true);
  });

  it('offers the three match levels with the same words as the badges', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    const select = screen.getByRole('combobox', { name: /match with the college list/i });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Any match',
      'Matches the college list',
      'Possible match',
      'Not on the list',
    ]);
  });

  it('says so when the filters match nobody', async () => {
    handlers['GET /admin/approvals'] = (call) => ({ data: page(call.params?.match ? [] : [ADA]) });
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /match with the college list/i }), 'none');
    expect(await screen.findByText('No registrations match these filters')).toBeInTheDocument();
  });
});

describe('selection and the bulk bar', () => {
  it('has a checkbox for every waiting registration and a "select all" for the page', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    expect(screen.getAllByRole('checkbox', { name: /^select (?!all)/i })).toHaveLength(5);
    const bar = screen.getByRole('region', { name: /bulk actions/i });
    expect(within(bar).getByText('None selected')).toBeInTheDocument();
    // no bulk action button before something is selected
    expect(within(bar).queryByRole('button', { name: /approve selected|reject selected/i })).not.toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('checkbox', { name: /select all on this page/i }));
    expect(within(bar).getByText('5 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Ben Batch' })).toBeChecked();
    await userEvent.click(within(bar).getByRole('checkbox', { name: /select all on this page/i }));
    expect(within(bar).getByText('None selected')).toBeInTheDocument();
  });

  it('works with the keyboard: Space toggles the focused checkbox', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    const box = screen.getByRole('checkbox', { name: 'Select Ada Lovelace' });
    box.focus();
    await userEvent.keyboard(' ');
    expect(box).toBeChecked();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('only lets a selection be approved together when every selected registration is an exact match with a verified e-mail', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }));
    expect(screen.getByRole('button', { name: 'Approve selected' })).toBeEnabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ben Batch' }));
    expect(screen.getByRole('button', { name: 'Approve selected' })).toBeDisabled();
    expect(screen.getByText(/only registrations that match the college list exactly and have a verified e-mail/i)).toBeInTheDocument();
    // ...but they can all be rejected, with a reason
    expect(screen.getByRole('button', { name: 'Reject selected' })).toBeEnabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ben Batch' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Dev Unverified' }));
    expect(screen.getByRole('button', { name: 'Approve selected' })).toBeDisabled();
  });

  it('clears the selection with the button and when the filters change', async () => {
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('None selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /department/i }), 'Civil');
    await waitFor(() => expect(screen.getByText('None selected')).toBeInTheDocument());
  });

  it('has no checkboxes and no bulk bar on the Rejected tab', async () => {
    handlers['GET /admin/approvals'] = (call) => ({
      data: page(call.params?.status === 'REJECTED' ? [application({ approvalStatus: 'REJECTED', waitingDays: null })] : [ADA]),
    });
    renderPage();
    await screen.findByRole('article', { name: /ada lovelace/i });
    await userEvent.click(screen.getByRole('tab', { name: /rejected/i }));
    await waitFor(() => expect(listCalls().some((c) => c.params?.status === 'REJECTED')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('region', { name: /bulk actions/i })).not.toBeInTheDocument());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('approve all exact matches on this page', () => {
  it('is offered for exact matches with a verified e-mail only, and says how many', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: /approve all exact matches on this page/i });
    // Ada and Eve are exact and verified; Ben (probable), Chi (none) and Dev (unverified) are left out
    expect(button).toHaveTextContent('(2)');
  });

  it('is not offered when no registration on the page qualifies', async () => {
    handlers['GET /admin/approvals'] = () => ({ data: page([BEN, CHI, DEV]) });
    renderPage();
    await screen.findByRole('article', { name: /ben batch/i });
    expect(screen.queryByRole('button', { name: /approve all exact matches/i })).not.toBeInTheDocument();
  });

  it('is not offered for an exact match whose e-mail is not verified', async () => {
    handlers['GET /admin/approvals'] = () => ({ data: page([DEV]) });
    renderPage();
    await screen.findByRole('article', { name: /dev unverified/i });
    expect(screen.queryByRole('button', { name: /approve all exact matches/i })).not.toBeInTheDocument();
  });

  it('asks first, listing every name, and sends exactly those ids', async () => {
    handlers['POST /admin/approvals/bulk-approve'] = (call) => ({
      data: { success: true, data: { results: call.body.ids.map((id: string) => ({ id, ok: true })), succeeded: call.body.ids.length, failed: 0 } },
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /approve all exact matches on this page/i }));

    const dialog = await screen.findByRole('dialog', { name: /approve 2 registrations/i });
    const names = within(within(dialog).getByRole('list')).getAllByRole('listitem').map((li) => li.textContent);
    expect(names).toEqual(['Ada Lovelace', 'Eve Exact']);
    // nothing has been sent yet
    expect(bulkCalls()).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText(/note/i), 'Matched the list');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve 2' }));

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0]).toMatchObject({ url: '/admin/approvals/bulk-approve', body: { ids: ['u1', 'u5'], note: 'Matched the list' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Approved 2 of 2 registrations' }));
  });

  it('cancelling sends nothing', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /approve all exact matches on this page/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bulkCalls()).toHaveLength(0);
  });

  it('reports what did not work, by name and reason, and refreshes the list and the counts', async () => {
    handlers['POST /admin/approvals/bulk-approve'] = () => ({
      data: {
        success: true,
        data: {
          results: [
            { id: 'u1', ok: true },
            { id: 'u5', ok: false, code: 'ALREADY_APPROVED', message: 'This person is already approved' },
          ],
          succeeded: 1,
          failed: 1,
        },
      },
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /approve all exact matches on this page/i }));
    const dialog = await screen.findByRole('dialog');
    const listsBefore = listCalls().length;
    const summariesBefore = calls.filter((c) => c.url === '/admin/approvals/summary').length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve 2' }));

    const outcome = await screen.findByText('Approved 1 of 2: 1 could not be decided');
    const region = outcome.closest('[role="status"]') as HTMLElement;
    expect(within(region).getByText('Eve Exact')).toBeInTheDocument();
    expect(region).toHaveTextContent('This person is already approved');
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(listsBefore));
    await waitFor(() => expect(calls.filter((c) => c.url === '/admin/approvals/summary').length).toBeGreaterThan(summariesBefore));

    await userEvent.click(within(region).getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('Approved 1 of 2: 1 could not be decided')).not.toBeInTheDocument();
  });

  it('keeps the dialog open with the message when the request as a whole fails, and can be tried again', async () => {
    handlers['POST /admin/approvals/bulk-approve'] = () => apiError(400, 'VALIDATION_ERROR', 'Choose at most 50 registrations at a time');
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /approve all exact matches on this page/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve 2' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose at most 50 registrations at a time');
    expect(within(dialog).getByRole('button', { name: 'Approve 2' })).toBeEnabled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('sends at most one request while it runs', async () => {
    let release!: () => void;
    handlers['POST /admin/approvals/bulk-approve'] = () =>
      new Promise<Reply>((resolve) => {
        release = () => resolve({ data: { success: true, data: { results: [{ id: 'u1', ok: true }, { id: 'u5', ok: true }], succeeded: 2, failed: 0 } } });
      });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /approve all exact matches on this page/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve 2' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /approving/i })).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: /cancel/i })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bulkCalls()).toHaveLength(1);
  });
});

describe('reject selected', () => {
  const openReject = async () => {
    await screen.findByRole('article', { name: /ada lovelace/i });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Chi Stranger' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ben Batch' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject selected' }));
    return screen.findByRole('dialog', { name: /reject 2 registrations/i });
  };

  it('always needs a reason, because every applicant is told why, and sends nothing without one', async () => {
    renderPage();
    const dialog = await openReject();
    expect(within(dialog).getByText(/every applicant receives this reason by e-mail/i)).toBeInTheDocument();
    expect(within(within(dialog).getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ben Batch', 'Chi Stranger']);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject 2' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/give a reason of 3 to 500 characters/i);
    expect(bulkCalls()).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'ab');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject 2' }));
    expect(bulkCalls()).toHaveLength(0);
  });

  it('rejects the selected registrations with the reason, then reports and refreshes', async () => {
    handlers['POST /admin/approvals/bulk-reject'] = (call) => ({
      data: { success: true, data: { results: call.body.ids.map((id: string) => ({ id, ok: true })), succeeded: 2, failed: 0 } },
    });
    renderPage();
    const dialog = await openReject();
    await userEvent.type(within(dialog).getByLabelText(/reason/i), '  We could not find you on the 2019 list  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject 2' }));

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0]).toMatchObject({ url: '/admin/approvals/bulk-reject', body: { ids: ['u2', 'u3'], reason: 'We could not find you on the 2019 list' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rejected 2 of 2 registrations' }));
    // the selection is gone with the decision
    await waitFor(() => expect(screen.getByText('None selected')).toBeInTheDocument());
  });

  it('shows a destructive toast when nobody could be decided', async () => {
    handlers['POST /admin/approvals/bulk-reject'] = () => ({
      data: {
        success: true,
        data: {
          results: [
            { id: 'u2', ok: false, code: 'NOT_PENDING', message: 'Only a registration that is waiting for approval can be rejected' },
            { id: 'u3', ok: false, code: 'NOT_FOUND', message: 'User not found' },
          ],
          succeeded: 0,
          failed: 2,
        },
      },
    });
    renderPage();
    const dialog = await openReject();
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Not on the list');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject 2' }));
    expect(await screen.findByText('Rejected 0 of 2: 2 could not be decided')).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });
});
