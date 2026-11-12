/**
 * One way of writing an enrolment number and a name, shared by the college alumni list (when it is imported) and the
 * review queue (when a registration is matched against it), so that "12ce 045" and "12CE045" are the same number.
 */

/** Letters that have no combining-mark form, so stripping diacritics alone would leave them as they are. */
const FOLDED_LETTERS: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ð: 'd', ß: 'ss', æ: 'ae', œ: 'oe' };

/** Trimmed, upper-cased, with every space removed; null when nothing is left (or the value is not text). */
export const normalizeEnrollment = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalised = value.replace(/\s+/gu, '').toUpperCase();
  return normalised === '' ? null : normalised;
};

/** Case-folded, diacritics stripped, runs of whitespace collapsed to one space. Empty when there is no text. */
export const normalizeName = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[łøđðßæœ]/gu, (letter) => FOLDED_LETTERS[letter] ?? letter)
    .replace(/\s+/gu, ' ')
    .trim();
};
