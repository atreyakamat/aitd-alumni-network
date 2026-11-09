import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pagination } from '@/components/shared/Pagination';

const meta = (total: number, totalPages = 1, page = 1) => ({ page, limit: 20, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 });

describe('Pagination count', () => {
  it.each([
    ['registrations', 'registration'],
    ['users', 'user'],
    ['pending jobs', 'pending job'],
    ['entries', 'entry'],
    ['results', 'result'],
  ])('says "1 %s" correctly as "1 %s"', (plural, singular) => {
    render(<Pagination pagination={meta(1)} onPageChange={vi.fn()} noun={plural} />);
    expect(screen.getByText(`1 ${singular}`)).toBeInTheDocument();
  });

  it('keeps the plural for zero and for many', () => {
    const { rerender } = render(<Pagination pagination={meta(0)} onPageChange={vi.fn()} noun="registrations" />);
    expect(screen.getByText('0 registrations')).toBeInTheDocument();
    rerender(<Pagination pagination={meta(2)} onPageChange={vi.fn()} noun="registrations" />);
    expect(screen.getByText('2 registrations')).toBeInTheDocument();
  });

  it('shows the page position when there is more than one page', () => {
    render(<Pagination pagination={meta(45, 3, 2)} onPageChange={vi.fn()} noun="users" />);
    expect(screen.getByText(/Page 2 of 3 · 45 users/)).toBeInTheDocument();
  });
});
