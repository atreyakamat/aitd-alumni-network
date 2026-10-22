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

export function Pagination({ pagination, onPageChange, disabled, noun = 'results' }: PaginationProps) {
  if (!pagination || pagination.totalPages <= 1) {
    return pagination ? (
      <p className="text-sm text-muted-foreground">
        {pagination.total} {noun}
      </p>
    ) : null;
  }
  const { page, totalPages, total } = pagination;
  const hasPrev = pagination.hasPrevPage ?? page > 1;
  const hasNext = pagination.hasNextPage ?? page < totalPages;

  return (
    <nav className="flex items-center justify-between gap-4" aria-label="Pagination">
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages} · {total} {noun}
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
