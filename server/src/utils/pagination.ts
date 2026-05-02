/**
 * Pagination utilities for standardized pagination
 */

export interface PaginationParams {
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * Parse pagination parameters from query string
 * @param query - Query parameters
 * @returns Parsed pagination parameters with defaults
 */
export const parsePagination = (query: any): PaginationParams => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const sort = query.sort || 'createdAt';
  const order = (query.order?.toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';

  return { page, limit, sort, order };
};

/**
 * Calculate pagination skip and take for database queries
 */
export const getPaginationSkipTake = (
  page: number,
  limit: number
): { skip: number; take: number } => ({
  skip: (page - 1) * limit,
  take: limit,
});

/**
 * Build pagination metadata
 */
export const buildPaginationMeta = (
  page: number,
  limit: number,
  total: number
) => {
  const pages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    pages,
    hasNext: page < pages,
    hasPrev: page > 1,
  };
};

/**
 * Build order by object for Prisma
 */
export const buildOrderBy = (sort?: string, order?: 'asc' | 'desc') => {
  const sortField = sort || 'createdAt';
  const sortOrder = order || 'desc';

  return {
    [sortField]: sortOrder,
  };
};

/**
 * Validate pagination limit
 */
export const validateLimit = (limit: number, max: number = 100): number => {
  return Math.min(max, Math.max(1, limit));
};

/**
 * Validate page number
 */
export const validatePage = (page: number): number => {
  return Math.max(1, Math.floor(page));
};
