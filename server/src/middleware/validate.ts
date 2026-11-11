import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './errorHandler';

/** At most this many field errors are returned to the client. */
const MAX_DETAILS = 20;

export const validate = (schema: ZodSchema) => {
  // Named so tooling (docs/API_REFERENCE.md generator) can tell validated routes apart
  return function validateRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      // Use the parsed body downstream: z.object strips unknown keys (no mass assignment,
      // e.g. a smuggled userRole) and applies normalisation such as email trimming.
      // query/params are intentionally left untouched.
      if (parsed && typeof parsed === 'object' && (parsed as { body?: unknown }).body !== undefined) {
        req.body = (parsed as { body: unknown }).body;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // A hostile body can fail in thousands of places: say so for the first few, never echo them all
        const messages = error.errors.slice(0, MAX_DETAILS).map((e) => ({
          field: e.path.join('.').slice(0, 80),
          message: e.message.slice(0, 200),
        }));
        return res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: messages,
          },
        });
      }
      next(error);
    }
  };
};
