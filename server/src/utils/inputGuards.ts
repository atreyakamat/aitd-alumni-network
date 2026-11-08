/**
 * Type guards for request fields that reach Prisma without passing through a zod schema.
 *
 * JSON bodies and Express query strings can carry any type (`{"city": 5}`, `?search[]=a&search[]=b`);
 * handing such a value to Prisma raises a validation error that surfaces as a 500. These helpers turn
 * every wrong type into a 400 VALIDATION_ERROR that names the field, and never throw for absent values.
 */
import { AppError } from '../middleware/errorHandler';

const invalid = (message: string) => new AppError(message, 400, 'VALIDATION_ERROR');

/** Optional text column: `undefined` = leave alone, `null` = clear, otherwise it must be a string. */
export const optionalText = (value: unknown, field: string): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw invalid(`${field} must be text`);
  return value;
};

/** A required, non-blank string (trimmed). */
export const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${field} is required`);
  return value.trim();
};

/** Optional boolean: `undefined` = leave alone; anything but true/false is rejected. */
export const optionalBoolean = (value: unknown, field: string): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw invalid(`${field} must be true or false`);
  return value;
};

/** A record id (or any short opaque key): a non-empty string, never an array or object. */
export const idText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw invalid(`${field} must be a valid id`);
  return value.trim();
};

/** Optional integer within [min, max]; `null`/`''` are rejected by callers that cannot clear the column. */
export const optionalInt = (value: unknown, field: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number | undefined => {
  if (value === undefined) return undefined;
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw invalid(`${field} must be a whole number between ${min} and ${max}`);
  }
  return n;
};

/** A string query-string value, or undefined for absent, blank, repeated (`?a=1&a=2`) or nested (`?a[x]=1`) values. */
export const queryText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** First string of a possibly repeated query value (`?a=1&a=2` -> '1'), undefined for objects. */
export const firstQueryText = (value: unknown): string | undefined =>
  queryText(Array.isArray(value) ? value[0] : value);
