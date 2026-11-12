import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

let pathname = '/admin';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

let pending: number | null = null;
vi.mock('@/hooks/use-pending-approvals', () => ({ usePendingApprovals: () => pending }));

import { AdminNav, ADMIN_NAV_ITEMS } from '@/components/admin/AdminNav';

const renderNav = (path = '/admin') => {
  pathname = path;
  return render(<AdminNav />);
};

beforeEach(() => {
  pathname = '/admin';
  pending = null;
});

describe('<AdminNav>', () => {
  it('is a labelled navigation landmark', () => {
    renderNav();
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
  });

  it('links every admin section, in the agreed order', () => {
    renderNav();
    const links = within(screen.getByRole('navigation', { name: 'Admin sections' })).getAllByRole('link');
    expect(links.map((a) => [a.textContent?.replace(/\d+\s*registrations.*$/, '').trim(), a.getAttribute('href')])).toEqual([
      ['Overview', '/admin'],
      ['Approvals', '/admin/approvals'],
      ['Alumni list', '/admin/alumni-list'],
      ['Members', '/admin/users'],
      ['Moderation', '/admin/moderation'],
      ['Reports', '/admin/reports'],
      ['Videos', '/admin/videos'],
      ['Magazine', '/admin/magazine'],
      ['Requirements', '/admin/requirements'],
      ['Landing page', '/admin/landing'],
      ['Communications', '/admin/communications'],
      ['Analytics', '/admin/analytics'],
      ['Audit log', '/admin/audit'],
      ['System status', '/admin/status'],
    ]);
    expect(ADMIN_NAV_ITEMS).toHaveLength(14);
  });

  it('marks exactly the current page with aria-current="page"', () => {
    renderNav('/admin/audit');
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', '/admin/audit');
  });

  it('matches /admin exactly, so Overview is not active on every admin page', () => {
    renderNav('/admin/users');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps Overview active on /admin itself', () => {
    renderNav('/admin');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('matches sub-pages by prefix but never a sibling that merely starts with the same letters', () => {
    const first = renderNav('/admin/approvals/some-id');
    expect(screen.getByRole('link', { name: /^Approvals/ })).toHaveAttribute('aria-current', 'page');
    first.unmount();
    renderNav('/admin/auditing');
    expect(screen.getByRole('link', { name: 'Audit log' })).not.toHaveAttribute('aria-current');
  });

  it('shows the number of registrations waiting on the Approvals item', () => {
    pending = 4;
    renderNav();
    const approvals = screen.getByRole('link', { name: /Approvals/ });
    expect(within(approvals).getByText('4')).toBeInTheDocument();
    expect(approvals).toHaveAccessibleName(/4 registrations waiting for approval/);
  });

  it('says "1 registration", not "1 registrations"', () => {
    pending = 1;
    renderNav();
    expect(screen.getByLabelText('1 registration waiting for approval')).toBeInTheDocument();
    expect(screen.queryByLabelText(/1 registrations/)).not.toBeInTheDocument();
  });

  it('shows no badge when nobody is waiting or the count is unknown', () => {
    pending = 0;
    const { unmount } = renderNav();
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/waiting for approval/)).not.toBeInTheDocument();
    unmount();
    pending = null;
    renderNav();
    expect(screen.queryByLabelText(/waiting for approval/)).not.toBeInTheDocument();
  });

  it('scrolls inside its own container on a narrow screen instead of widening the page', () => {
    const { container } = renderNav();
    const scroller = container.querySelector('ul');
    expect(scroller).toHaveClass('overflow-x-auto');
    // the nav itself must be allowed to shrink below the width of its content
    expect(screen.getByRole('navigation')).toHaveClass('min-w-0');
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass('whitespace-nowrap', 'shrink-0');
  });

  it('keeps a visible keyboard focus indicator on every link', () => {
    renderNav();
    for (const link of screen.getAllByRole('link')) expect(link.className).toMatch(/focus-visible:ring/);
  });

  it('hides the decorative icons from assistive technology', () => {
    const { container } = renderNav();
    const icons = container.querySelectorAll('a svg');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'));
  });
});
