/**
 * The college alumni list page, run through the REAL api client against a fake server with the shapes of
 * server/src/services/alumniRecordService.ts:
 *   POST   /admin/alumni-records/import { rows } -> { success, data: { created, updated, skipped, errors: [{ row, message }] } }
 *   GET    /admin/alumni-records?search&page&limit -> { success, data: Record[], pagination }
 *   DELETE /admin/alumni-records/:id -> { success, data: { id } } | 404 NOT_FOUND
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/alumni-list',
  useSearchParams: () => new URLSearchParams(),
}));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import { api } from '@/lib/api';
import AlumniListPage from '@/app/(main)/admin/alumni-list/page';

type Row = Record<string, unknown>;

const record = (over: Row = {}): Row => ({
  id: 'r1',
  fullName: 'Ada Alum',
  batchYear: 2015,
  department: 'Computer Engineering',
  enrollmentNumber: '12CE045',
  createdAt: '2026-11-10T10:00:00.000Z',
  ...over,
});

const page = (rows: Row[], over: Record<string, unknown> = {}) => ({
  success: true,
  data: rows,
  pagination: { page: 1, limit: 25, total: rows.length, totalPages: rows.length ? 1 : 0, hasNextPage: false, hasPrevPage: false, ...over },
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

const listCalls = () => calls.filter((c) => c.method === 'GET' && c.url === '/admin/alumni-records');
const importCalls = () => calls.filter((c) => c.method === 'POST' && c.url === '/admin/alumni-records/import');

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })}>
      <AlumniListPage />
    </QueryClientProvider>
  );

const answerImport = (call: Call): Reply => ({
  data: { success: true, data: { created: call.body.rows.length, updated: 0, skipped: 0, errors: [] } },
});

beforeEach(() => {
  realAdapter = api.defaults.adapter;
  calls = [];
  toast.mockReset();
  handlers = {
    'GET /admin/alumni-records': () => ({ data: page([record(), record({ id: 'r2', fullName: 'Ben Batch', batchYear: 2016, department: null, enrollmentNumber: null })]) }),
    'POST /admin/alumni-records/import': answerImport,
  };
  installServer();
});
afterEach(() => {
  api.defaults.adapter = realAdapter as never;
});

const HEADER = 'fullName,batchYear,department,enrollmentNumber';

/** Setting the value is enough for a big paste (typing 1200 lines one key at a time would take minutes). */
const paste = (text: string) => fireEvent.change(screen.getByLabelText(/paste the csv/i), { target: { value: text } });
const check = () => userEvent.click(screen.getByRole('button', { name: /check the file/i }));

describe('the page', () => {
  it('has one heading, the privacy note and the import and the list on one page', async () => {
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('College alumni list');
    expect(screen.getByText(/personal data of people who may not have registered/i)).toBeInTheDocument();
    expect(screen.getByText(/only administrators can see it/i)).toBeInTheDocument();
    expect(screen.getByText(/deleted when it is no longer needed/i)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Records' })).toBeInTheDocument();
  });

  it('shows the records in a table with column headers and the count', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: /people on the college alumni list/i });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Batch', 'Department', 'Enrolment number', 'Added', 'Actions']);
    const first = within(table).getByRole('row', { name: /ada alum/i });
    expect(within(first).getByText('2015')).toBeInTheDocument();
    expect(within(first).getByText('Computer Engineering')).toBeInTheDocument();
    expect(within(first).getByText('12CE045')).toBeInTheDocument();
    expect(within(first).getByText(/10 Nov 2026/)).toBeInTheDocument();
    expect(within(within(table).getByRole('row', { name: /ben batch/i })).getAllByText('Not given')).toHaveLength(2);
    expect(screen.getByLabelText('2 records on the list')).toBeInTheDocument();
  });

  it('renders what is on the list as plain text, never as HTML', async () => {
    handlers['GET /admin/alumni-records'] = () => ({ data: page([record({ fullName: '<img src=x onerror=alert(1)>Eve', department: '<b>CE</b>' })]) });
    const { container } = renderPage();
    expect(await screen.findByText('<img src=x onerror=alert(1)>Eve')).toBeInTheDocument();
    expect(container.querySelector('img, b, script')).toBeNull();
  });

  it('shows skeletons while loading', () => {
    handlers['GET /admin/alumni-records'] = () => new Promise<Reply>(() => undefined);
    renderPage();
    expect(screen.getByLabelText(/loading the college list/i)).toBeInTheDocument();
  });

  it('says the list is empty and what to do', async () => {
    handlers['GET /admin/alumni-records'] = () => ({ data: page([]) });
    renderPage();
    expect(await screen.findByText('The college list is empty')).toBeInTheDocument();
    expect(screen.getByText(/import the list above/i)).toBeInTheDocument();
  });

  it('shows the error with a way to try again', async () => {
    let fail = true;
    handlers['GET /admin/alumni-records'] = () => (fail ? apiError(500, 'INTERNAL', 'Database is down') : { data: page([record()]) });
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the college list');
    expect(alert).toHaveTextContent(/database is down/i);
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('row', { name: /ada alum/i })).toBeInTheDocument();
  });
});

describe('searching', () => {
  it('searches as you type, from the first page, and says when nothing matches', async () => {
    handlers['GET /admin/alumni-records'] = (call) => ({ data: call.params?.search ? page([]) : page([record()]) });
    renderPage();
    await screen.findByRole('row', { name: /ada alum/i });
    expect(listCalls()[0].params).toMatchObject({ page: 1, limit: 25 });
    expect(listCalls()[0].params?.search).toBeUndefined();

    await userEvent.type(screen.getByRole('searchbox', { name: /search the college list/i }), '  zzz ');
    expect(await screen.findByText('No records match this search')).toBeInTheDocument();
    expect(listCalls().at(-1)!.params).toMatchObject({ search: 'zzz', page: 1 });
  });
});

describe('removing a record', () => {
  const open = async () => {
    await screen.findByRole('row', { name: /ada alum/i });
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ada Alum from the list' }));
    return screen.findByRole('dialog', { name: /remove ada alum from the list/i });
  };

  it('asks first, then removes and refreshes the list', async () => {
    let removed = false;
    handlers['GET /admin/alumni-records'] = () => ({ data: page(removed ? [] : [record()]) });
    handlers['DELETE /admin/alumni-records/r1'] = () => {
      removed = true;
      return { data: { success: true, data: { id: 'r1' } } };
    };
    renderPage();
    const dialog = await open();
    expect(within(dialog).getByText(/nobody is deleted from the platform/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove record' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/admin/alumni-records/r1')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Record removed' }));
    expect(await screen.findByText('The college list is empty')).toBeInTheDocument();
  });

  it('cancelling removes nothing', async () => {
    renderPage();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('keeps the dialog open with the message when it fails', async () => {
    handlers['DELETE /admin/alumni-records/r1'] = () => apiError(500, 'INTERNAL', 'Could not reach the database');
    renderPage();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove record' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not reach the database');
    expect(within(dialog).getByRole('button', { name: 'Remove record' })).toBeEnabled();
  });

  it('treats "already removed" (404) as done and refreshes', async () => {
    handlers['DELETE /admin/alumni-records/r1'] = () => apiError(404, 'NOT_FOUND', 'Record not found');
    renderPage();
    const dialog = await open();
    const before = listCalls().length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove record' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Already removed' }));
  });
});

describe('importing', () => {
  it('shows a preview with the problems of the file before anything is sent', async () => {
    renderPage();
    await screen.findByRole('row', { name: /ada alum/i });
    paste([HEADER, 'Cara Cohort,2017,Civil,17CV001', 'X,2017,,', 'Dan Dept,soon,,'].join('\n'));
    await check();

    const preview = await screen.findByRole('region', { name: /preview of the import/i });
    expect(within(preview).getByRole('status')).toHaveTextContent('1 row is ready to import. 2 rows have problems and will be left out.');
    expect(within(preview).getByText('Line 3: The name must be at least 2 characters')).toBeInTheDocument();
    expect(within(preview).getByText('Line 4: The batch year must be a four-digit year')).toBeInTheDocument();
    expect(within(preview).getByRole('cell', { name: 'Cara Cohort' })).toBeInTheDocument();
    expect(importCalls()).toHaveLength(0);
    expect(within(preview).getByRole('button', { name: 'Import 1 row' })).toBeEnabled();
  });

  it('says what is wrong with the file as a whole, and offers no import', async () => {
    renderPage();
    paste('Ada Alum,2015\nBen,2016');
    await check();
    expect(await screen.findByRole('alert')).toHaveTextContent(/first line must be the header row/i);
    expect(screen.queryByRole('region', { name: /preview of the import/i })).not.toBeInTheDocument();
  });

  it('has nothing to check while the box is empty', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /check the file/i })).toBeDisabled();
  });

  it('sends only the valid rows, without the line numbers, then reports and reloads the list', async () => {
    renderPage();
    await screen.findByRole('row', { name: /ada alum/i });
    paste([HEADER, 'Cara Cohort,2017,Civil,17CV001', 'X,2017,,', 'Eli Elec,2018,,'].join('\n'));
    await check();
    const before = listCalls().length;
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 rows' }));

    await waitFor(() => expect(importCalls()).toHaveLength(1));
    expect(importCalls()[0].body).toEqual({
      rows: [
        { fullName: 'Cara Cohort', batchYear: 2017, department: 'Civil', enrollmentNumber: '17CV001' },
        { fullName: 'Eli Elec', batchYear: 2018 },
      ],
    });
    const result = await screen.findByRole('region', { name: /result of the import/i });
    expect(within(result).getByText('Import finished: 2 added, 0 updated, 1 left out.')).toBeInTheDocument();
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
    // the box is emptied: the same file cannot be sent twice by accident
    expect(screen.getByLabelText(/paste the csv/i)).toHaveValue('');
    expect(screen.queryByRole('region', { name: /preview of the import/i })).not.toBeInTheDocument();
  });

  it('sends a big file in chunks of 500, one after the other, with progress', async () => {
    const sizes: number[] = [];
    let release!: () => void;
    handlers['POST /admin/alumni-records/import'] = (call) => {
      sizes.push(call.body.rows.length);
      if (sizes.length === 2) {
        return new Promise<Reply>((resolve) => {
          release = () => resolve(answerImport(call));
        });
      }
      return answerImport(call);
    };
    renderPage();
    const lines = Array.from({ length: 1200 }, (_, i) => `Person ${i},2015,,E${i}`);
    paste([HEADER, ...lines].join('\n'));
    await check();
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1,200 rows' }));

    expect(await screen.findByText(/Imported 500 of 1,200 rows/)).toBeInTheDocument();
    await waitFor(() => expect(sizes).toEqual([500, 500]));
    expect(screen.getByRole('button', { name: /importing/i })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(sizes).toEqual([500, 500, 200]));
    const result = await screen.findByRole('region', { name: /result of the import/i });
    expect(within(result).getByText('Import finished: 1,200 added, 0 updated, 0 left out.')).toBeInTheDocument();
  });

  it('puts the problems the server found back on the lines of the file, whichever chunk they were in', async () => {
    let n = 0;
    handlers['POST /admin/alumni-records/import'] = (call) => {
      n += 1;
      return n === 2
        ? { data: { success: true, data: { created: call.body.rows.length - 1, updated: 0, skipped: 1, errors: [{ row: 3, message: 'Same enrolment number as row 1' }] } } }
        : answerImport(call);
    };
    renderPage();
    const lines = Array.from({ length: 600 }, (_, i) => `Person ${i},2015,,E${i}`);
    paste([HEADER, ...lines].join('\n'));
    await check();
    await userEvent.click(await screen.findByRole('button', { name: 'Import 600 rows' }));
    const result = await screen.findByRole('region', { name: /result of the import/i });
    // row 3 of the second chunk is the 503rd data row = line 504 of the file (the header is line 1)
    expect(within(result).getByText('Line 504: Same enrolment number as row 1')).toBeInTheDocument();
    expect(within(result).getByText(/Import finished: 599 added, 0 updated, 1 left out/)).toBeInTheDocument();
  });

  it('stops at the first request that fails, says how far it got, and that importing again is safe', async () => {
    let n = 0;
    handlers['POST /admin/alumni-records/import'] = (call) => {
      n += 1;
      return n === 2 ? apiError(500, 'INTERNAL', 'Database is down') : answerImport(call);
    };
    renderPage();
    const lines = Array.from({ length: 1200 }, (_, i) => `Person ${i},2015,,E${i}`);
    paste([HEADER, ...lines].join('\n'));
    await check();
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1,200 rows' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The import stopped after 500 rows of 1,200');
    expect(alert).toHaveTextContent(/database is down/i);
    expect(alert).toHaveTextContent(/importing the file again is safe/i);
    expect(importCalls()).toHaveLength(2);
    // the preview is still there, so it can be started again
    expect(screen.getByRole('button', { name: 'Import 1,200 rows' })).toBeEnabled();
  });

  it('reads a chosen file in the browser, and refuses one that is far too big', async () => {
    renderPage();
    const input = screen.getByLabelText(/choose a csv file/i) as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'file');
    await userEvent.upload(input, new File([`${HEADER}\nGia Grad,2019,Chemical,19CH001\n`], 'list.csv', { type: 'text/csv' }));
    const preview = await screen.findByRole('region', { name: /preview of the import/i });
    expect(within(preview).getByRole('cell', { name: 'Gia Grad' })).toBeInTheDocument();
    expect(screen.getByLabelText(/paste the csv/i)).toHaveValue(`${HEADER}\nGia Grad,2019,Chemical,19CH001\n`);
    // the file itself is never sent: only JSON rows
    expect(importCalls()).toHaveLength(0);

    const big = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await userEvent.upload(input, big);
    expect(await screen.findByText(/that file is too big/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /preview of the import/i })).not.toBeInTheDocument();
  });

  it('never writes the rows to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    renderPage();
    paste([HEADER, 'Secret Person,2015,Civil,SECRET-1'].join('\n'));
    await check();
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 row' }));
    await screen.findByRole('region', { name: /result of the import/i });
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Secret Person|SECRET-1/);
      spy.mockRestore();
    }
  });
});
