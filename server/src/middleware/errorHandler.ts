import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { log } from '../utils/logger';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public code?: string;

  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

const CLIENT_ERROR_NAMES = new Set(['MulterError', 'ZodError', 'JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError']);
const CLIENT_PRISMA_CODES = new Set(['P2002', 'P2003', 'P2000', 'P2025']);
/** What the multipart parser (busboy, under multer) throws, as plain Errors, for a damaged upload body (a NUL byte in a file name, a cut-off body). */
const MULTIPART_PARSE_ERROR = /^(Malformed part header|Unexpected end of form|Multipart: Boundary not found|Unexpected end of multipart data|Malformed urlencoded form|Missing Content-Type)/;
const isMultipartParseError = (err: Error) => !(err instanceof AppError) && MULTIPART_PARSE_ERROR.test(err.message);

/** Errors that end in a 4xx for the caller: expected traffic, not an incident. */
const isClientError = (err: Error | AppError): boolean => {
  if (err instanceof AppError) return err.statusCode < 500;
  const e = err as { type?: unknown; code?: unknown; status?: unknown; statusCode?: unknown };
  if (e.type === 'entity.parse.failed' || e.type === 'entity.too.large') return true;
  if (isMultipartParseError(err)) return true;
  if (CLIENT_ERROR_NAMES.has(err.name) || err instanceof ZodError) return true;
  if (err.name === 'PrismaClientKnownRequestError' && CLIENT_PRISMA_CODES.has(String(e.code))) return true;
  const status = e.status ?? e.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
};

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Only real failures are logged as errors (with the request id, so a report can be matched to its log line). A wrong
  // password or a missing page used to print a stack trace each, which buried the failures that matter.
  if (isClientError(err)) {
    log.debug('request rejected', { id: req.id, status: err instanceof AppError ? err.statusCode : undefined, error: err.message });
  } else {
    log.error('Unhandled error', { id: req.id, method: req.method, err });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        code: err.code,
      },
    });
  }

  // Malformed / oversized request bodies rejected by body-parser are client errors, not 500s
  const bodyErrorType = (err as any).type;
  if (bodyErrorType === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { message: 'Malformed JSON in request body', code: 'INVALID_JSON' },
    });
  }
  if (bodyErrorType === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: { message: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' },
    });
  }

  // A damaged multipart body (the parser throws a plain Error): the client's fault, not an incident
  if (isMultipartParseError(err)) {
    return res.status(400).json({
      success: false,
      error: { message: 'The upload could not be read', code: 'INVALID_MULTIPART' },
    });
  }

  // File uploads (multer): size and field limits are the client's fault
  if (err.name === 'MulterError') {
    const tooLarge = (err as any).code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      error: {
        message: tooLarge ? 'File is too large (max 5 MB)' : err.message,
        code: tooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
      },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
      },
    });
  }

  // Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as any;
    if (prismaErr.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: {
          message: 'A record with this value already exists',
          code: 'DUPLICATE_ENTRY',
        },
      });
    }
    if (prismaErr.code === 'P2003') {
      // Foreign key: the request names a record (event, user, chapter ...) that does not exist
      return res.status(400).json({
        success: false,
        error: {
          message: 'A referenced record does not exist',
          code: 'INVALID_REFERENCE',
        },
      });
    }
    if (prismaErr.code === 'P2000') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'A value is too long',
          code: 'VALUE_TOO_LONG',
        },
      });
    }
    if (prismaErr.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Record not found',
          code: 'NOT_FOUND',
        },
      });
    }
  }

  // Client errors raised by Express itself (http-errors style), e.g. a malformed %-escape in the URL
  const httpStatus = (err as { status?: unknown; statusCode?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) {
    return res.status(httpStatus).json({
      success: false,
      error: { message: 'Bad request', code: 'BAD_REQUEST' },
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Invalid token',
        code: 'INVALID_TOKEN',
      },
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Token expired',
        code: 'TOKEN_EXPIRED',
      },
    });
  }

  // Default error
  return res.status(500).json({
    success: false,
    error: {
      message: process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message,
      code: 'INTERNAL_ERROR',
    },
  });
};
