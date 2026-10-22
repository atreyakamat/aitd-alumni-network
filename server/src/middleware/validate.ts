import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './errorHandler';

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
        const messages = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
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
