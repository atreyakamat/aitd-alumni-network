import { z } from 'zod';

/**
 * Request bodies of the college alumni list and of the bulk decisions of the review queue.
 *
 * The strings are bounded generously here (the request cannot carry megabytes of text per field); the service applies
 * the precise per-row rules and reports each bad row by its number, so one bad row never rejects a whole import.
 */

export const IMPORT_MAX_ROWS = 1000;
export const BULK_MAX_IDS = 50;

const row = z.object({
  fullName: z.string().max(200).nullish(),
  batchYear: z.union([z.number(), z.string().max(12)]).nullish(),
  department: z.string().max(200).nullish(),
  enrollmentNumber: z.string().max(200).nullish(),
});

export const importAlumniRecordsSchema = z.object({
  body: z.object({
    rows: z.array(row).min(1, 'Send at least one row').max(IMPORT_MAX_ROWS, `Send at most ${IMPORT_MAX_ROWS} rows per request`),
  }),
});

const ids = z
  .array(z.string().min(1).max(128))
  .min(1, 'Choose at least one registration')
  .max(BULK_MAX_IDS, `Choose at most ${BULK_MAX_IDS} registrations at a time`);

export const bulkApproveSchema = z.object({
  body: z.object({
    ids,
    note: z.string().max(500, 'The note can be at most 500 characters').optional(),
  }),
});

export const bulkRejectSchema = z.object({
  body: z.object({
    ids,
    reason: z.string().min(3, 'Give the reason: the people are told why').max(500, 'The reason can be at most 500 characters'),
  }),
});
