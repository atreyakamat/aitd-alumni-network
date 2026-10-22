/**
 * Input sanitization middleware
 *
 * Strips markup from user supplied strings so stored content can never carry
 * executable HTML. Output encoding is still the client's job (React escapes by
 * default); this layer removes tags rather than HTML-encoding them so URLs,
 * quotes and comparison operators in plain text survive untouched.
 */

import { Request, Response, NextFunction } from 'express';

// Fields that must reach handlers byte-for-byte (credentials, signatures, tokens)
const RAW_FIELD_PATTERN = /(password|token|signature|secret|otp|code)$/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const SCRIPT_BLOCK = /<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const HTML_TAG = /<\/?[a-z!][^<>]*>/gi;
const DANGEROUS_PROTOCOL = /^\s*(javascript|vbscript|data:text\/html)\s*:?/i;

export const sanitizeValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;

  return value
    // eslint-disable-next-line no-control-regex -- stripping NUL bytes is intentional
    .replace(/\u0000/g, '')
    .replace(SCRIPT_BLOCK, '')
    .replace(HTML_TAG, '')
    .replace(DANGEROUS_PROTOCOL, '')
    // Close gaps left by removed tags; line breaks are content (bios, posts) and stay
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .trim();
};

const sanitizeObject = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeValue(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      sanitized[key] = RAW_FIELD_PATTERN.test(key) ? obj[key] : sanitizeObject(obj[key]);
    }
    return sanitized;
  }

  return obj;
};

/**
 * Middleware to sanitize all request inputs
 */
export const sanitizeInput = (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }
    next();
  } catch (error) {
    next(error);
  }
};

export default sanitizeInput;
