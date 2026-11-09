'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PaginationMeta } from '@/lib/api';

interface PaginationProps {
  pagination?: PaginationMeta | null;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  /** e.g. "users", "jobs" */
  noun?: string;
}

/** "1 entries" reads as a mistake: say "1 entry". Only the plural forms used by the lists (...ies, ...s) are handled. */
const forCount = (noun: string, count: number) => {
  if (count !== 1) return noun;
  if (noun.endsWith('ies')) return `${noun.slice(0, -3)}y`;
  return noun.endsWith('s') ? noun.slice(0, -1) : noun;
};

export function Pagination({ pagination, onPageChange, disabled, noun = 'results' }: PaginationProps) {
  if (!pagination || pagination.totalPages <= 1) {
    return pagination ? (
      <p className="text-sm text-muted-foreground">
        {pagination.total} {forCount(noun, pagination.total)}
      </p>
    ) : null;
  }
  const { page, totalPages, total } = pagination;
  const hasPrev = pagination.hasPrevPage ?? page > 1;
  const hasNext = pagination.hasNextPage ?? page < totalPages;

  return (
    <nav className="flex items-center justify-between gap-4" aria-label="Pagination">
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages} · {total} {forCount(noun, total)}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || !hasPrev}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || !hasNext}
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </nav>
  );
}
