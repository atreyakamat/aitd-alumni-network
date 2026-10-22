import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

import { PublicNav } from '@/components/layout/PublicNav';

describe('PublicNav auth links', () => {
  it('carries the current public page to both "Sign In" and "Join Now"', () => {
    pathname = '/events/42';
    render(<PublicNav />);
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login?next=%2Fevents%2F42');
    expect(screen.getByRole('link', { name: 'Join Now' })).toHaveAttribute('href', '/register?next=%2Fevents%2F42');
  });

  it('uses plain links on non-public pages', () => {
    pathname = '/';
    render(<PublicNav />);
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Join Now' })).toHaveAttribute('href', '/register');
  });
});
