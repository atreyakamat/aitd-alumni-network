/**
 * The admin pages that manage content share one frame: the shared <AdminPageHeader> (one h1, no back link: the section
 * navigation does that job), no wrapper of their own that fixes a different width or background, and, when the data cannot
 * be loaded, an error with a Retry button instead of an empty list or a spinner that never ends.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/admin' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'ADMIN', userRole: 'ADMIN' } }) }));
vi.mock('@/components/videos/SubmitVideoDialog', () => ({ SubmitVideoDialog: () => null }));

const m = vi.hoisted(() => ({
  digest: vi.fn(),
  landing: vi.fn(),
  magazine: vi.fn(),
  requirements: vi.fn(),
  videos: vi.fn(),
  pendingJobs: vi.fn(),
  reports: vi.fn(),
}));

vi.mock('@/lib/engagement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/engagement')>()),
  digestApi: { getSettings: m.digest },
  landingApi: { adminBlocks: m.landing },
  requirementsApi: { list: m.requirements },
}));
vi.mock('@/lib/videos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/videos')>()),
  magazineApi: { list: m.magazine },
  videosApi: { list: m.videos },
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  adminApi: { getPendingJobs: m.pendingJobs },
}));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi: { adminReports: m.reports },
}));

interface PageCase {
  name: string;
  title: string;
  load: () => Promise<{ default: React.ComponentType }>;
  mock: ReturnType<typeof vi.fn>;
  ok: unknown;
  /** Text that is on screen once the data has loaded. */
  loaded: string;
  /** Title of the error state shown when the load fails. */
  errorTitle?: RegExp;
  retry: RegExp;
}

const settings = { enabled: true, dayOfWeek: 1, hour: 9, sections: { nearbyAlumni: true, jobs: true, events: true, videos: true, requirements: true }, lastRunAt: null };
const jobsPage = { data: { success: true, data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } } };

const CASES: PageCase[] = [
  { name: 'communications', title: 'Communications', load: () => import('@/app/(main)/admin/communications/page'), mock: m.digest, ok: settings, loaded: 'Weekly digest', errorTitle: /could not load the digest settings/i, retry: /retry/i },
  { name: 'landing', title: 'Landing page builder', load: () => import('@/app/(main)/admin/landing/page'), mock: m.landing, ok: [], loaded: 'No custom blocks yet. Add one to customise the landing page.', errorTitle: /could not load the landing page/i, retry: /retry/i },
  { name: 'magazine', title: 'College Magazine', load: () => import('@/app/(main)/admin/magazine/page'), mock: m.magazine, ok: { items: [] }, loaded: 'No editions yet.', errorTitle: /could not load the magazines/i, retry: /retry/i },
  { name: 'requirements', title: 'College Requirements', load: () => import('@/app/(main)/admin/requirements/page'), mock: m.requirements, ok: { items: [] }, loaded: 'No requirements yet.', errorTitle: /could not load the requirements/i, retry: /retry/i },
  { name: 'videos', title: 'College Videos', load: () => import('@/app/(main)/admin/videos/page'), mock: m.videos, ok: { items: [] }, loaded: 'Nothing here right now.', errorTitle: /could not load the videos/i, retry: /retry/i },
  { name: 'moderation', title: 'Moderation queue', load: () => import('@/app/(main)/admin/moderation/page'), mock: m.pendingJobs, ok: jobsPage, loaded: 'All caught up', retry: /retry/i },
  { name: 'reports', title: 'Reported content', load: () => import('@/app/(main)/admin/reports/page'), mock: m.reports, ok: { items: [], nextCursor: null }, loaded: 'No open reports', retry: /try again/i },
];

const renderCase = async (c: PageCase) => {
  const { default: Page } = await c.load();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Page />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
});

describe.each(CASES)('/admin/$name', (c) => {
  it('starts with the shared header: exactly one h1 with the page title', async () => {
    c.mock.mockResolvedValue(c.ok);
    await renderCase(c);
    await screen.findByText(c.loaded);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(c.title);
  });

  it('has no back link of its own (the section navigation is the way back)', async () => {
    c.mock.mockResolvedValue(c.ok);
    await renderCase(c);
    await screen.findByText(c.loaded);
    expect(screen.queryByRole('link', { name: /admin dashboard|back to admin|^admin$/i })).not.toBeInTheDocument();
  });

  it('brings no page-sized wrapper of its own: the layout sets width, spacing and background', async () => {
    c.mock.mockResolvedValue(c.ok);
    const { container } = await renderCase(c);
    await screen.findByText(c.loaded);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/min-h-screen|bg-slate-50|\bp-6\b|max-w-|mx-auto/);
  });

  it('shows a loading state, then the content', async () => {
    c.mock.mockResolvedValue(c.ok);
    await renderCase(c);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(c.loaded)).toBeInTheDocument();
  });

  it('shows an error with a working Retry when the data cannot be loaded', async () => {
    c.mock.mockRejectedValueOnce(new Error('The server did not answer.')).mockResolvedValue(c.ok);
    await renderCase(c);

    if (c.errorTitle) expect(await screen.findByText(c.errorTitle)).toBeInTheDocument();
    const retry = await screen.findByRole('button', { name: c.retry });
    // an error is not an empty list
    expect(screen.queryByText(c.loaded)).not.toBeInTheDocument();

    await userEvent.click(retry);
    expect(await screen.findByText(c.loaded)).toBeInTheDocument();
  });
});

describe('/admin/moderation', () => {
  it('shows how many jobs are pending next to the title, outside the heading text', async () => {
    m.pendingJobs.mockResolvedValue({ data: { success: true, data: [{ id: 'j1', title: 'Engineer', createdAt: '2026-11-09T10:00:00Z' }], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } } });
    await renderCase(CASES.find((c) => c.name === 'moderation')!);
    expect(await screen.findByText('1 pending')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Moderation queue$/);
  });
});
