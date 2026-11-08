import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();
let pathname = '/dashboard';
let query = '';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(query ? `q=${encodeURIComponent(query)}` : ''),
}));

import { HeaderSearch, MobileSearchLink } from '@/components/layout/HeaderSearch';

beforeEach(() => {
  push.mockClear();
  pathname = '/dashboard';
  query = '';
});

const box = () => screen.getByRole('searchbox', { name: /search/i }) as HTMLInputElement;
const submit = (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.submit(box().closest('form')!);
};

describe('HeaderSearch', () => {
  it('is one labelled search landmark with the given placeholder', () => {
    render(<HeaderSearch placeholder="Search events, news and chapters" />);
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(box()).toHaveAttribute('placeholder', 'Search events, news and chapters');
  });

  it('goes to the results page with the encoded, cleaned query', () => {
    render(<HeaderSearch placeholder="Search" />);
    submit('  data   science & ML ');
    expect(push).toHaveBeenCalledWith('/search?q=data%20science%20%26%20ML');
  });

  it('does nothing for a query that is too short to run', () => {
    render(<HeaderSearch placeholder="Search" />);
    submit('a');
    submit('   ');
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the current query on the results page so the header box is the single place to refine it', () => {
    pathname = '/search';
    query = 'machine learning';
    render(<HeaderSearch placeholder="Search" />);
    expect(box().value).toBe('machine learning');
  });

  it('starts empty on every other page, even if some other ?q= is in the URL', () => {
    pathname = '/directory';
    query = 'leftover';
    render(<HeaderSearch placeholder="Search" />);
    expect(box().value).toBe('');
  });

  it('caps what can be typed', () => {
    render(<HeaderSearch placeholder="Search" />);
    expect(box()).toHaveAttribute('maxlength', '100');
  });
});

describe('MobileSearchLink', () => {
  it('disappears on the search page itself, where it would only link to where you already are', () => {
    pathname = '/search';
    render(<MobileSearchLink />);
    expect(screen.queryByRole('link', { name: 'Search' })).not.toBeInTheDocument();
  });

  it('is a single labelled link to the search page, shown only where the header box is hidden', () => {
    render(<MobileSearchLink />);
    const link = screen.getByRole('link', { name: 'Search' });
    expect(link).toHaveAttribute('href', '/search');
    expect(link.className).toMatch(/md:hidden/);
  });
});
