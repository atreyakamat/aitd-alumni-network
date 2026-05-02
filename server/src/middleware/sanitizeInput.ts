/**
 * Input sanitization middleware
 * Sanitizes user inputs to prevent XSS attacks
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Sanitize string inputs
 */
const sanitizeString = (str: string): string => {
  if (typeof str !== 'string') return str;

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

/**
 * Sanitize object recursively
 */
const sanitizeObject = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
};

/**
 * Middleware to sanitize all request inputs
 */
export const sanitizeInput = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }

    if (req.query) {
      req.query = sanitizeObject(req.query);
    }

    if (req.params) {
      req.params = sanitizeObject(req.params);
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Sanitize specific fields
 */
export const sanitizeFields = (fields: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      fields.forEach(field => {
        if (req.body && req.body[field]) {
          req.body[field] = sanitizeString(req.body[field]);
        }
      });

      next();
    } catch (error) {
      next(error);
    }
  };
};

export default sanitizeInput;
