import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill, priority, ...props }: any) => <img {...props} />,
}));

import HomePage from '@/app/page';
import { api } from '@/lib/api';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import { HeroSection } from '@/components/features/HeroSection';
import { FeaturesSection } from '@/components/features/FeaturesSection';
import { isMemberOnlyPath } from '@/lib/public-paths';

/** Every internal link an anonymous visitor can click must lead to a page they may open (the login page counts). */
function expectNoMemberOnlyLinks(container: HTMLElement) {
  const offenders: string[] = [];
  for (const a of Array.from(container.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    if (!href.startsWith('/')) continue;
    const path = href.split(/[?#]/)[0];
    if (isMemberOnlyPath(path)) offenders.push(`${a.textContent?.trim()} -> ${href}`);
  }
  expect(offenders).toEqual([]);
}

/** The real axios instance (interceptors included) against a fake network that records every request URL. */
let requested: string[] = [];
let realAdapter: typeof api.defaults.adapter;
beforeEach(() => {
  requested = [];
  realAdapter = api.defaults.adapter;
  api.defaults.adapter = async (config) => {
    requested.push(String(config.url));
    const data = String(config.url).startsWith('/users/stats')
      ? { success: true, data: { totalAlumni: 1200, totalCompanies: 40, totalBatches: 25, totalCities: 30 } }
      : { success: true, data: [] };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
});
afterEach(() => {
  api.defaults.adapter = realAdapter;
});

describe('anonymous landing page does not advertise members-only pages', () => {
  it('PublicNav links only to the landing page, the guest donation page and the auth screens', () => {
    const { container } = render(<PublicNav />);
    expectNoMemberOnlyLinks(container);
    // guest donations are the one open section: a visible Donate link
    expect(screen.getByRole('link', { name: 'Donate' })).toHaveAttribute('href', '/donations');
    for (const label of ['Events', 'Gallery', 'News', 'Chapters']) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: /directory|jobs|yearbook/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });

  it('Hero: directory call-to-action is an explicit sign-in link', () => {
    const { container } = render(<HeroSection />);
    expectNoMemberOnlyLinks(container);
    const link = screen.getByRole('link', { name: /sign in to explore the directory/i });
    expect(link).toHaveAttribute('href', '/login?next=%2Fdirectory');
    expect(screen.getByRole('link', { name: /join the network/i })).toHaveAttribute('href', '/register');
  });

  it('Features: every feature says "sign in" and goes through /login?next=', () => {
    const { container } = render(<FeaturesSection />);
    expectNoMemberOnlyLinks(container);
    expect(screen.getByRole('link', { name: /sign in to search members/i })).toHaveAttribute('href', '/login?next=%2Fdirectory');
    expect(screen.getByRole('link', { name: /sign in to view openings/i })).toHaveAttribute('href', '/login?next=%2Fjobs');
    expect(screen.getByRole('link', { name: /sign in to find a mentor/i })).toHaveAttribute('href', '/login?next=%2Fmentorship');
    // events are members-only too now: no more "Browse Calendar" straight to /events
    expect(screen.getByRole('link', { name: /sign in to see the calendar/i })).toHaveAttribute('href', '/login?next=%2Fevents');
    expect(screen.queryByRole('link', { name: /browse calendar/i })).not.toBeInTheDocument();
  });

  it('Footer: every members-only section is labelled and routed through login', () => {
    const { container } = render(<Footer />);
    expectNoMemberOnlyLinks(container);
    const footer = within(container);
    expect(footer.getByRole('link', { name: /directory/i })).toHaveAttribute('href', '/login?next=%2Fdirectory');
    expect(footer.getByRole('link', { name: /yearbook/i })).toHaveAttribute('href', '/login?next=%2Fyearbook');
    expect(footer.getByRole('link', { name: /jobs/i })).toHaveAttribute('href', '/login?next=%2Fjobs');
    expect(footer.getByRole('link', { name: /^events/i })).toHaveAttribute('href', '/login?next=%2Fevents');
    expect(footer.getByRole('link', { name: /^news/i })).toHaveAttribute('href', '/login?next=%2Fnews');
    expect(footer.getAllByText(/members/i).length).toBeGreaterThan(0);
    // donating needs no account: a plain link, not labelled "Members"
    const donate = footer.getByRole('link', { name: /^donate$/i });
    expect(donate).toHaveAttribute('href', '/donations');
    expect(donate).not.toHaveTextContent(/members/i);
    // the legal and contact pages stay open
    expect(footer.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy');
    expect(footer.getByRole('link', { name: /terms of service/i })).toHaveAttribute('href', '/terms');
    expect(footer.getByRole('link', { name: /contact us/i })).toHaveAttribute('href', '/contact');
  });
});

describe('the landing page only calls what is still public', () => {
  it('asks only for /users/stats and /landing: no notable alumni, upcoming events or latest news (they are private now)', async () => {
    const { container } = render(<HomePage />);
    await waitFor(() => {
      expect(requested).toContain('/users/stats');
      expect(requested).toContain('/landing');
    });
    // give any stray component time to fire its own request
    await new Promise((r) => setTimeout(r, 50));
    expect(Array.from(new Set(requested)).sort()).toEqual(['/landing', '/users/stats']);
    expectNoMemberOnlyLinks(container);
  });

  it('no longer shows the notable-alumni, upcoming-events and latest-news sections', async () => {
    render(<HomePage />);
    await waitFor(() => expect(requested).toContain('/landing'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/notable alumni/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/upcoming events/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/latest news|latest from/i)).not.toBeInTheDocument();
    // the sign-up call to action is still there
    expect(screen.getAllByRole('link', { name: /get started|join the network/i }).length).toBeGreaterThan(0);
  });

  it('has a visible Donate call to action that leads to the guest donation page (header, call to action and footer)', async () => {
    const { container } = render(<HomePage />);
    await waitFor(() => expect(requested).toContain('/landing'));
    const donate = screen.getAllByRole('link', { name: /^donate$/i });
    expect(donate.length).toBeGreaterThanOrEqual(3);
    for (const link of donate) expect(link).toHaveAttribute('href', '/donations');
    // every other internal link still goes through login or to an open page
    expectNoMemberOnlyLinks(container);
  });
});
