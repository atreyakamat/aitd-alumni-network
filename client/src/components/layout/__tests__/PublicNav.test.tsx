import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { PublicNav } from '@/components/layout/PublicNav';

describe('PublicNav (the landing page header of a private platform)', () => {
  it('offers sign in and registration, as plain links', () => {
    pathname = '/';
    render(<PublicNav />);
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Join Now' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: /aiem connection/i })).toHaveAttribute('href', '/');
  });

  it('does not carry a return path: there is no public page to return to', () => {
    pathname = '/events/42';
    render(<PublicNav />);
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Join Now' })).toHaveAttribute('href', '/register');
  });

  it.each(['Events', 'Gallery', 'News', 'Donate', 'Chapters'])('has no "%s" link: that section needs an account now', (label) => {
    render(<PublicNav />);
    expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
  });

  it('has no search box: search is for members', () => {
    render(<PublicNav />);
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Search' })).not.toBeInTheDocument();
  });
});
