import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { makePost, page } from '@/components/social/__tests__/fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/dashboard' }));
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'me', fullName: 'Me Myself', department: 'CS', batchYear: 2015, profileCompleteness: 40, role: 'MEMBER', userRole: 'MEMBER' },
    logout: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => null }));

const networkApi = vi.hoisted(() => ({ getSuggestions: vi.fn() }));
const eventApi = vi.hoisted(() => ({ getUpcoming: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  networkApi,
  eventApi,
}));
const socialApi = vi.hoisted(() => ({ feed: vi.fn(), react: vi.fn(), trending: vi.fn(), createPost: vi.fn(), mentionSearch: vi.fn() }));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi,
}));

import DashboardPage from '@/app/(main)/dashboard/page';
import { moreItems, navItems } from '@/components/layout/MainNav';

const ok = (data: unknown) => Promise.resolve({ data });

beforeEach(() => {
  socialApi.feed.mockReset().mockResolvedValue(page([makePost({ id: 'p1', content: 'Hello alumni' })]));
  socialApi.trending.mockReset().mockResolvedValue([{ tag: 'reunion2026', postCount: 12 }]);
  socialApi.mentionSearch.mockReset().mockResolvedValue([]);
  networkApi.getSuggestions.mockReset().mockImplementation(() => ok({ success: true, data: [] }));
  eventApi.getUpcoming.mockReset().mockImplementation(() => ok({ success: true, data: [] }));
});

describe('Dashboard layout: no shortcuts that duplicate the header', () => {
  it('has no "Shortcuts" card and none of the former duplicate links', async () => {
    render(<DashboardPage />);
    await screen.findByText('Hello alumni');
    expect(screen.queryByText('Shortcuts')).not.toBeInTheDocument();
    for (const name of ['Videos', 'Saved posts', 'My connections', 'Job board', 'Events']) {
      expect(screen.queryByRole('link', { name }), name).not.toBeInTheDocument();
    }
  });

  it('profile card links only to the member profile, nothing the header already offers', async () => {
    render(<DashboardPage />);
    await screen.findByText('Hello alumni');
    const profile = screen.getByRole('region', { name: 'Your profile' });
    expect(within(profile).getByText('Me Myself')).toBeInTheDocument();
    expect(within(profile).getByText('40%')).toBeInTheDocument();
    const headerHrefs = new Set([...navItems, ...moreItems].map((i) => i.href));
    const hrefs = within(profile)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') as string);
    expect(hrefs).toEqual(['/profile/me']);
    for (const href of hrefs) expect(headerHrefs.has(href)).toBe(false);
  });

  it('is a two-column layout (feed + right sidebar) with no left column to leave a gap', async () => {
    const { container } = render(<DashboardPage />);
    await screen.findByText('Hello alumni');
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain('lg:grid-cols-[minmax(0,1fr)_20rem]');
    // exactly two direct children: the feed column and the right sidebar
    expect(grid.children).toHaveLength(2);
    expect(grid.children[0].querySelector('[role="combobox"][aria-label="Write a post"]')).not.toBeNull();
    expect(within(grid.children[1] as HTMLElement).getByRole('region', { name: 'Your profile' })).toBeInTheDocument();
    expect(grid.querySelector('aside.hidden')).toBeNull();
  });
});
