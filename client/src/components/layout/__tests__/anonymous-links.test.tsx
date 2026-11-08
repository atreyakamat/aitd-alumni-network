import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

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

import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import { HeroSection } from '@/components/features/HeroSection';
import { FeaturesSection } from '@/components/features/FeaturesSection';
import { isMemberOnlyPath } from '@/lib/public-paths';

/** Every internal link an anonymous visitor can click must lead to a page they may open. */
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

describe('anonymous landing page does not advertise members-only pages', () => {
  it('PublicNav links only to public sections and auth pages', () => {
    const { container } = render(<PublicNav />);
    expectNoMemberOnlyLinks(container);
    for (const label of ['Home', 'Events', 'Gallery', 'News', 'Donate', 'Chapters']) {
      expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('link', { name: /directory|jobs|yearbook/i })).not.toBeInTheDocument();
  });

  it('PublicNav has ONE search box, and it leads to the public search page (not a sign-in wall)', () => {
    const { container } = render(<PublicNav />);
    expect(screen.getAllByRole('search')).toHaveLength(1);
    expect(screen.getByRole('searchbox', { name: /search/i })).toHaveAttribute('placeholder', expect.stringMatching(/events, news, chapters/i));
    // the narrow-screen icon opens the same page
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search');
    expectNoMemberOnlyLinks(container);
  });

  it('Hero: directory call-to-action is an explicit sign-in link', () => {
    const { container } = render(<HeroSection />);
    expectNoMemberOnlyLinks(container);
    const link = screen.getByRole('link', { name: /sign in to explore the directory/i });
    expect(link).toHaveAttribute('href', '/login?next=%2Fdirectory');
    expect(screen.getByRole('link', { name: /join the network/i })).toHaveAttribute('href', '/register');
  });

  it('Features: member-only features say "sign in" and go through /login?next=', () => {
    const { container } = render(<FeaturesSection />);
    expectNoMemberOnlyLinks(container);
    expect(screen.getByRole('link', { name: /sign in to search members/i })).toHaveAttribute('href', '/login?next=%2Fdirectory');
    expect(screen.getByRole('link', { name: /sign in to view openings/i })).toHaveAttribute('href', '/login?next=%2Fjobs');
    expect(screen.getByRole('link', { name: /sign in to find a mentor/i })).toHaveAttribute('href', '/login?next=%2Fmentorship');
    // events are genuinely public
    expect(screen.getByRole('link', { name: /browse calendar/i })).toHaveAttribute('href', '/events');
  });

  it('Footer: member sections are labelled and routed through login; public ones stay direct', () => {
    const { container } = render(<Footer />);
    expectNoMemberOnlyLinks(container);
    const footer = within(container);
    expect(footer.getByRole('link', { name: /directory/i })).toHaveAttribute('href', '/login?next=%2Fdirectory');
    expect(footer.getByRole('link', { name: /yearbook/i })).toHaveAttribute('href', '/login?next=%2Fyearbook');
    expect(footer.getByRole('link', { name: /jobs/i })).toHaveAttribute('href', '/login?next=%2Fjobs');
    expect(footer.getByRole('link', { name: /^events$/i })).toHaveAttribute('href', '/events');
    expect(footer.getByRole('link', { name: /^news$/i })).toHaveAttribute('href', '/news');
    expect(footer.getAllByText(/members/i).length).toBeGreaterThan(0);
  });
});
