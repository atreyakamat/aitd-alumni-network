/**
 * Unified API Response Helper
 * Standardizes response format across all endpoints
 */

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
    page?: number;
    limit?: number;
    total?: number;
    pages?: number;
  };
}

/**
 * Create a success response
 */
export const successResponse = <T>(
  data: T,
  meta?: Record<string, any>
): ApiResponse<T> => ({
  success: true,
  data,
  meta: {
    timestamp: new Date().toISOString(),
    ...meta,
  },
});

/**
 * Create a paginated success response
 */
export const paginatedResponse = <T>(
  data: T[],
  page: number,
  limit: number,
  total: number
): ApiResponse<T[]> => ({
  success: true,
  data,
  meta: {
    timestamp: new Date().toISOString(),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  },
});

/**
 * Create an error response
 */
export const errorResponse = (
  code: string,
  message: string,
  details?: Record<string, any>
): ApiResponse<null> => ({
  success: false,
  error: {
    code,
    message,
    details,
  },
  meta: {
    timestamp: new Date().toISOString(),
  },
});

/**
 * Error codes for consistent error handling
 */
export enum ErrorCode {
  // Authentication errors
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  
  // User errors
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS',
  USER_UNAUTHORIZED = 'USER_UNAUTHORIZED',
  
  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  
  // Resource errors
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  
  // Permission errors
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // Server errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',
}

/**
 * Extended Error class with code and details
 */
export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    public statusCode: number,
    message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * HTTP Status Codes mapping
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;
