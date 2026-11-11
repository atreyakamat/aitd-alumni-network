import { describe, expect, it } from 'vitest';
import { formatDate, formatInr, formatInrCompact, formatNumber, formatUptime, pluralize } from '@/lib/format';

describe('formatInr', () => {
  it('writes the full amount with Indian digit grouping and no decimals', () => {
    expect(formatInr(0)).toBe('₹0');
    expect(formatInr(800)).toBe('₹800');
    expect(formatInr(150000)).toBe('₹1,50,000');
    expect(formatInr(1234567.89)).toBe('₹12,34,568');
  });

  it('never prints NaN for a missing value', () => {
    expect(formatInr(undefined)).toBe('₹0');
    expect(formatInr(null)).toBe('₹0');
    expect(formatInr(Number.NaN)).toBe('₹0');
    expect(formatInr('2500')).toBe('₹2,500');
  });
});

describe('formatInrCompact (chart axis ticks)', () => {
  it.each([
    [0, '₹0'],
    [5, '₹5'],
    [800, '₹800'],
    [1000, '₹1K'],
    [1500, '₹1.5K'],
    [25000, '₹25K'],
    [100000, '₹1L'],
    [250000, '₹2.5L'],
    [10000000, '₹1Cr'],
    [12000000, '₹1.2Cr'],
    [250000000, '₹25Cr'],
  ])('%s -> %s', (value, expected) => {
    expect(formatInrCompact(value)).toBe(expected);
  });

  it('never prints a fraction of a thousand', () => {
    for (const tiny of [0.004, 0.003, 0.5, 4, 999.4]) {
      expect(formatInrCompact(tiny)).not.toMatch(/0\.\d+K/i);
      expect(formatInrCompact(tiny)).not.toMatch(/K$/);
    }
    expect(formatInrCompact(0.004)).toBe('₹0');
  });

  it('carries into the next unit instead of printing 100K or 1000K', () => {
    expect(formatInrCompact(99960)).toBe('₹1L');
    expect(formatInrCompact(999999)).toBe('₹10L');
    expect(formatInrCompact(999.6)).toBe('₹1K');
  });

  it('handles negatives and junk', () => {
    expect(formatInrCompact(-1500)).toBe('-₹1.5K');
    expect(formatInrCompact(undefined)).toBe('₹0');
    expect(formatInrCompact(Number.NaN)).toBe('₹0');
  });
});

describe('formatNumber', () => {
  it('groups digits the Indian way and tolerates missing values', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(1234567)).toBe('12,34,567');
    expect(formatNumber(undefined)).toBe('0');
  });
});

describe('formatDate', () => {
  it('prints day, short month and year, never the ambiguous 11/9/2026', () => {
    expect(formatDate('2026-11-09T10:00:00.000Z')).toBe('9 Nov 2026');
    expect(formatDate(new Date(2026, 0, 5, 12))).toBe('5 Jan 2026');
  });

  it('shows a dash for a missing or invalid date', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });
});

describe('pluralize', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'upcoming event')).toBe('1 upcoming event');
    expect(pluralize(1, 'registration')).toBe('1 registration');
  });

  it('uses the plural for zero and for many', () => {
    expect(pluralize(0, 'registration')).toBe('0 registrations');
    expect(pluralize(2, 'upcoming event')).toBe('2 upcoming events');
    expect(pluralize(1200, 'member')).toBe('1,200 members');
  });

  it('handles words ending in y and irregular plurals', () => {
    expect(pluralize(1, 'entry')).toBe('1 entry');
    expect(pluralize(3, 'entry')).toBe('3 entries');
    expect(pluralize(3, 'day')).toBe('3 days');
    expect(pluralize(2, 'person', 'people')).toBe('2 people');
  });
});

describe('formatUptime', () => {
  it.each([
    [0, 'less than a minute'],
    [59, 'less than a minute'],
    [60, '1 minute'],
    [300, '5 minutes'],
    [3600, '1 hour'],
    [3 * 3600 + 20 * 60, '3 hours 20 minutes'],
    [86400, '1 day'],
    [2 * 86400 + 3 * 3600, '2 days 3 hours'],
  ])('%s seconds -> %s', (seconds, expected) => {
    expect(formatUptime(seconds)).toBe(expected);
  });

  it('tolerates junk', () => {
    expect(formatUptime(undefined)).toBe('less than a minute');
    expect(formatUptime(-5)).toBe('less than a minute');
  });
});
