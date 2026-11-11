import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { PublicNav } from '@/components/layout/PublicNav';

describe('PublicNav (the header of the landing page and of the guest donation page)', () => {
  it('offers sign in and registration, as plain links on the landing page', () => {
    pathname = '/';
    render(<PublicNav />);
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Join Now' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: /aiem connect/i })).toHaveAttribute('href', '/');
  });

  it('has a "Donate" link to /donations, the one section open to visitors', () => {
    pathname = '/';
    render(<PublicNav />);
    expect(screen.getByRole('link', { name: 'Donate' })).toHaveAttribute('href', '/donations');
    expect(screen.getByRole('link', { name: 'Donate' })).not.toHaveAttribute('aria-current');
  });

  it('marks "Donate" as the current page on /donations and brings the visitor back to it after signing in or joining', () => {
    pathname = '/donations';
    render(<PublicNav />);
    expect(screen.getByRole('link', { name: 'Donate' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login?next=%2Fdonations');
    expect(screen.getByRole('link', { name: 'Join Now' })).toHaveAttribute('href', '/register?next=%2Fdonations');
  });

  it('does not carry a return path from a page that is not public', () => {
    pathname = '/events/42';
    render(<PublicNav />);
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Join Now' })).toHaveAttribute('href', '/register');
  });

  it.each(['Events', 'Gallery', 'News', 'Chapters'])('has no "%s" link: that section needs an account', (label) => {
    pathname = '/';
    render(<PublicNav />);
    expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
  });

  it('links to nothing but the landing page, the donation page and the sign-in and registration pages', () => {
    pathname = '/';
    const { container } = render(<PublicNav />);
    const hrefs = Array.from(container.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    expect(hrefs.sort()).toEqual(['/', '/donations', '/login', '/register'].sort());
  });

  it('has no search box: search is for members', () => {
    pathname = '/';
    render(<PublicNav />);
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Search' })).not.toBeInTheDocument();
  });
});
