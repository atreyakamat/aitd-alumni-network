import path from 'path';
import { AppError } from '../middleware/errorHandler';
import { getS3KeyFromUrl, resolveLocalUploadPath } from './storage';

/**
 * References to files this application stored itself (`/uploads/<folder>/<file>` locally, `<folder>/<file>` in the bucket).
 *
 * Several records (college videos, magazines, ...) are created in two steps: the file is uploaded, then its URL is sent
 * back in a second request. Whatever the second request says is user input. Without a check, a member could submit
 * somebody else's file (a profile photo, a post image) as "their" video and then delete the record, which also deletes
 * the file from storage: one member removing another's uploads. A reference is therefore accepted only when it points to
 * a managed file in the exact folder the matching upload endpoint writes to, directly inside it (no nesting, no `..`).
 */

/** The upload folder a managed file lives in, or null when the value is not exactly `<folder>/<file>` of our storage. */
export const uploadFolderOf = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const url = value.trim();

  let relative: string | null = getS3KeyFromUrl(url);
  if (relative === null) {
    const local = resolveLocalUploadPath(url);
    // Derive the folder from the RESOLVED path (what the file system would really touch), and accept only the
    // canonical spelling: "/uploads/a/../b/x" or "/uploads//a/x" are refused, not "corrected"
    relative = local ? path.relative(path.resolve(process.cwd(), 'uploads'), local).split(path.sep).join('/') : null;
    if (relative !== null && url !== `/uploads/${relative}`) return null;
  }
  if (!relative) return null;

  const parts = relative.split('/');
  return parts.length === 2 && parts[0] !== '' && parts[1] !== '' ? parts[0] : null;
};

/** `value` as a stored-file reference from one of `folders`, or a 400. */
export const assertUploadRef = (value: unknown, field: string, folders: readonly string[]): string => {
  const folder = uploadFolderOf(value);
  if (!folder || !folders.includes(folder)) {
    throw new AppError(`${field} must be a file uploaded for this purpose`, 400, 'VALIDATION_ERROR');
  }
  return (value as string).trim();
};

/** undefined stays undefined (not given), null or empty clears the value, anything else must be a valid reference. */
export const optionalUploadRef = (value: unknown, field: string, folders: readonly string[]): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === 'string' && !value.trim())) return null;
  return assertUploadRef(value, field, folders);
};
