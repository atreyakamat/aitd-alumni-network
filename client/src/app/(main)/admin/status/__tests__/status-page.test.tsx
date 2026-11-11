import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getSystemStatus = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  adminApi: { getSystemStatus },
  getApiErrorMessage: (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback),
}));

import AdminStatusPage from '@/app/(main)/admin/status/page';

type Service = { key: string; label: string; status: 'ok' | 'warning' | 'error' | 'off'; detail: string };

const report = (overall: 'ok' | 'warning' | 'error', services: Service[], extra: Record<string, unknown> = {}) => ({
  data: {
    success: true,
    data: {
      checkedAt: '2026-11-09T10:32:15.000Z',
      environment: 'production',
      version: '1.4.2',
      uptimeSeconds: 3 * 3600 + 20 * 60,
      overall,
      services,
      ...extra,
    },
  },
});

const OK: Service[] = [
  { key: 'database', label: 'Database', status: 'ok', detail: 'Members, posts and events are being saved normally.' },
  { key: 'email', label: 'E-mail', status: 'ok', detail: 'Registration and approval e-mails are going out.' },
  { key: 'storage', label: 'File storage', status: 'ok', detail: 'Photos and documents can be uploaded.' },
];

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminStatusPage />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  getSystemStatus.mockReset();
});

describe('Admin system status page', () => {
  it('shows a loading skeleton while the check runs', async () => {
    getSystemStatus.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'System status' })).toBeInTheDocument();
    expect(screen.getByLabelText('Checking systems')).toBeInTheDocument();
    expect(screen.queryByText('All systems working')).not.toBeInTheDocument();
  });

  it('says "All systems working" and shows one card per service with its plain-English detail', async () => {
    getSystemStatus.mockResolvedValue(report('ok', OK));
    renderPage();

    const banner = await screen.findByRole('status', { name: 'Overall status' });
    expect(within(banner).getByText('All systems working')).toBeInTheDocument();

    const list = screen.getByRole('list', { name: 'Services' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByRole('heading', { name: 'Database' })).toBeInTheDocument();
    expect(within(cards[0]).getByText('Members, posts and events are being saved normally.')).toBeInTheDocument();
    for (const card of cards) expect(within(card).getByText('Working')).toBeInTheDocument();
  });

  it('shows "Needs attention" for a warning, and "Not in use" for a service that is switched off', async () => {
    getSystemStatus.mockResolvedValue(
      report('warning', [
        ...OK.slice(0, 1),
        { key: 'email', label: 'E-mail', status: 'warning', detail: 'E-mail is slow: messages may arrive late.' },
        { key: 'payments', label: 'Online payments', status: 'off', detail: 'Online payments are not set up on this site.' },
      ])
    );
    renderPage();

    expect(within(await screen.findByRole('status', { name: 'Overall status' })).getByText('Needs attention')).toBeInTheDocument();
    const cards = within(screen.getByRole('list', { name: 'Services' })).getAllByRole('listitem');
    expect(within(cards[1]).getByText('Needs attention')).toBeInTheDocument();
    expect(within(cards[1]).getByText('E-mail is slow: messages may arrive late.')).toBeInTheDocument();
    expect(within(cards[2]).getByText('Not in use')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Working')).toBeInTheDocument();
  });

  it('shows "Problem" for an error', async () => {
    getSystemStatus.mockResolvedValue(
      report('error', [{ key: 'database', label: 'Database', status: 'error', detail: 'The database is not answering.' }, ...OK.slice(1)])
    );
    renderPage();

    expect(within(await screen.findByRole('status', { name: 'Overall status' })).getByText('Problem')).toBeInTheDocument();
    const cards = within(screen.getByRole('list', { name: 'Services' })).getAllByRole('listitem');
    expect(within(cards[0]).getByText('Problem')).toBeInTheDocument();
    expect(within(cards[0]).getByText('The database is not answering.')).toBeInTheDocument();
  });

  it('works out the overall state itself when the server leaves it out', async () => {
    getSystemStatus.mockResolvedValue({
      data: { success: true, data: { checkedAt: '2026-11-09T10:32:15.000Z', services: [{ ...OK[0], status: 'error' }, OK[1]] } },
    });
    renderPage();
    expect(within(await screen.findByRole('status', { name: 'Overall status' })).getByText('Problem')).toBeInTheDocument();
  });

  it('shows when it was checked, and the environment, version and uptime in a quiet footer', async () => {
    getSystemStatus.mockResolvedValue(report('ok', OK));
    renderPage();
    await screen.findByText('All systems working');

    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
    const footer = screen.getByText(/Environment/).closest('p')!;
    expect(footer).toHaveTextContent('Production');
    expect(footer).toHaveTextContent('1.4.2');
    expect(footer).toHaveTextContent('3 hours 20 minutes');
  });

  it('checks again on request, and says so while it is doing it', async () => {
    let release: (value: unknown) => void = () => {};
    getSystemStatus
      .mockResolvedValueOnce(report('ok', OK))
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    renderPage();
    await screen.findByText('All systems working');

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(getSystemStatus).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: /checking/i })).toBeDisabled();

    release(report('warning', [{ key: 'database', label: 'Database', status: 'warning', detail: 'Slow.' }]));
    expect(await within(await screen.findByRole('status', { name: 'Overall status' })).findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
  });

  it('shows a friendly error with a working Retry when the request fails', async () => {
    getSystemStatus.mockRejectedValueOnce(new Error('Cannot reach the server. Check your connection and try again.')).mockResolvedValueOnce(report('ok', OK));
    renderPage();

    expect(await screen.findByText('Could not check the system status')).toBeInTheDocument();
    expect(screen.getByText('Cannot reach the server. Check your connection and try again.')).toBeInTheDocument();
    expect(screen.queryByText('All systems working')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('All systems working')).toBeInTheDocument();
    expect(getSystemStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps the last known result and says the re-check failed when a later check fails', async () => {
    getSystemStatus.mockResolvedValueOnce(report('ok', OK)).mockRejectedValueOnce(new Error('Cannot reach the server.'));
    renderPage();
    await screen.findByText('All systems working');

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/Could not check again/)).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
  });

  it('has nothing a developer would write: no owners, risks, file paths or module lists', async () => {
    getSystemStatus.mockResolvedValue(report('ok', OK));
    const { container } = renderPage();
    await screen.findByText('All systems working');
    expect(container.textContent).not.toMatch(/Platform Team|Risk:|Planned Modules|\.tsx?\b|Control Center|server\/src/);
  });

  it('survives an empty service list', async () => {
    getSystemStatus.mockResolvedValue(report('ok', []));
    renderPage();
    expect(await screen.findByText('All systems working')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Services' })).not.toBeInTheDocument();
  });
});
