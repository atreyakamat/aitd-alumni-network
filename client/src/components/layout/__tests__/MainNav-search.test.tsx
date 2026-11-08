import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', fullName: 'Asha Rao', email: 'asha@example.com', userRole: 'MEMBER' }, logout: vi.fn() }),
}));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => <button type="button">Notifications</button> }));

import { MainNav } from '@/components/layout/MainNav';

describe('MainNav search', () => {
  it('has exactly one search box (not a second one beside it) plus one icon link for narrow screens', () => {
    render(<MainNav />);
    expect(screen.getAllByRole('search')).toHaveLength(1);
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    const icons = screen.getAllByRole('link', { name: 'Search' });
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('href', '/search');
    expect(icons[0].className).toMatch(/md:hidden/);
  });

  it('does not repeat header destinations on the search control', () => {
    render(<MainNav />);
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', expect.stringMatching(/people, jobs, events/i));
  });
});
