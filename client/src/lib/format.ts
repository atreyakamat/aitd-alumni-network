/**
 * Display formatting for the admin screens: rupees, counts, dates, plurals and uptime.
 *
 * Money and dates build on the helpers in `utils.ts` (en-IN: "₹1,50,000", "9 Nov 2026") so the whole app prints them
 * one way; what is added here is tolerance for missing values (nothing prints "NaN" or "Invalid Date") and the compact
 * rupee form for chart axes.
 */
import { formatCurrency, formatDate as formatDateValue } from '@/lib/utils';

const finite = (value: unknown): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** The full amount in rupees, Indian digit grouping, no decimals: `₹1,50,000`. */
export const formatInr = (value: unknown): string => formatCurrency(finite(value));

const UNITS = [
  { size: 10_000_000, suffix: 'Cr' },
  { size: 100_000, suffix: 'L' },
  { size: 1_000, suffix: 'K' },
] as const;

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/**
 * A short rupee amount for chart axes: 800 -> `₹800`, 1500 -> `₹1.5K`, 250000 -> `₹2.5L`, 12000000 -> `₹1.2Cr`.
 * Amounts are rounded to whole rupees first, so tiny values read `₹0` and never a fraction of a thousand.
 */
export const formatInrCompact = (value: unknown): string => {
  const amount = Math.round(finite(value));
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);

  let index = UNITS.findIndex((unit) => abs >= unit.size);
  if (index === -1) return `${sign}₹${abs}`;

  let scaled = oneDecimal(abs / UNITS[index].size);
  // Rounding can reach the next unit (99.96K is 1L): print that instead of "100K".
  if (index > 0 && scaled * UNITS[index].size >= UNITS[index - 1].size) {
    index -= 1;
    scaled = oneDecimal(abs / UNITS[index].size);
  }
  return `${sign}₹${scaled}${UNITS[index].suffix}`;
};

/** A whole number with Indian digit grouping: `12,34,567`. */
export const formatNumber = (value: unknown): string => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(finite(value));

/** `9 Nov 2026`, or a dash when there is no (valid) date. */
export const formatDate = (value: string | number | Date | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : formatDateValue(date);
};

/** `10:32:15 am` in the viewer's time zone, or a dash when there is no (valid) time. */
export const formatTime = (value: string | number | Date | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
};

const pluralOf = (singular: string) => (/[^aeiou]y$/i.test(singular) ? `${singular.slice(0, -1)}ies` : `${singular}s`);

/** "1 upcoming event", "2 upcoming events": the count with the noun in the right number. */
export const pluralize = (count: number, singular: string, plural?: string): string => {
  const n = finite(count);
  return `${formatNumber(n)} ${n === 1 ? singular : plural ?? pluralOf(singular)}`;
};

const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** How long something has been running, for people: "3 hours 20 minutes", "2 days 3 hours". */
export const formatUptime = (seconds: unknown): string => {
  const total = Math.floor(finite(seconds));
  if (total < 60) return 'less than a minute';
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${part(days, 'day')} ${part(hours, 'hour')}` : part(days, 'day');
  if (hours > 0) return minutes > 0 ? `${part(hours, 'hour')} ${part(minutes, 'minute')}` : part(hours, 'hour');
  return part(minutes, 'minute');
};
