import { describe, expect, it } from 'vitest';
import {
  addSkill,
  blankToNull,
  completenessHints,
  contactSchema,
  dateToMonth,
  formatMonth,
  geolocationErrorMessage,
  isHttpUrl,
  monthToDate,
  PHOTO_MAX_BYTES,
  roundCoordinate,
  validatePhotoFile,
} from '@/lib/profile';

describe('validatePhotoFile', () => {
  it('accepts JPG, PNG and GIF up to 5 MB (the server multer limits)', () => {
    expect(validatePhotoFile({ name: 'me.jpg', type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(validatePhotoFile({ name: 'me.PNG', type: 'image/png', size: PHOTO_MAX_BYTES })).toBeNull();
    expect(validatePhotoFile({ name: 'me.gif', type: 'image/gif', size: 10 })).toBeNull();
  });

  it('rejects other types, mismatched extensions and large files', () => {
    expect(validatePhotoFile({ name: 'me.webp', type: 'image/webp', size: 10 })).toMatch(/JPG, PNG or GIF/);
    expect(validatePhotoFile({ name: 'cv.pdf', type: 'application/pdf', size: 10 })).toMatch(/JPG, PNG or GIF/);
    expect(validatePhotoFile({ name: 'me.txt', type: 'image/png', size: 10 })).toMatch(/JPG, PNG or GIF/);
    expect(validatePhotoFile({ name: 'me.jpg', type: 'image/jpeg', size: PHOTO_MAX_BYTES + 1 })).toMatch(/5 MB/);
  });
});

describe('links and contact validation', () => {
  it('only treats absolute http(s) URLs as links', () => {
    expect(isHttpUrl('https://linkedin.com/in/ada')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('linkedin.com/in/ada')).toBe(false);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
  });

  it('allows blanks but rejects bad links, phones and emails', () => {
    const blank = { phoneNumber: '', secondaryEmail: '', linkedinUrl: '', twitterUrl: '', githubUrl: '', websiteUrl: '' };
    expect(contactSchema.safeParse(blank).success).toBe(true);
    expect(contactSchema.safeParse({ ...blank, githubUrl: 'github.com/ada' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...blank, phoneNumber: 'call me' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...blank, secondaryEmail: 'nope' }).success).toBe(false);
  });

  it('blankToNull trims and clears', () => {
    expect(blankToNull('  ')).toBeNull();
    expect(blankToNull(' Pune ')).toBe('Pune');
    expect(blankToNull(undefined)).toBeNull();
  });
});

describe('dates', () => {
  it('converts between month inputs and API dates in UTC', () => {
    expect(monthToDate('2020-03')).toBe('2020-03-01');
    expect(dateToMonth('2020-03-01T00:00:00.000Z')).toBe('2020-03');
    expect(dateToMonth(null)).toBe('');
    expect(formatMonth('2020-03-01T00:00:00.000Z')).toBe('Mar 2020');
  });
});

describe('location helpers', () => {
  it('rounds coordinates to 2 decimals (about 1 km) for privacy', () => {
    expect(roundCoordinate(28.6139391)).toBe(28.61);
    expect(roundCoordinate(-77.2090212)).toBe(-77.21);
    expect(roundCoordinate(28.6139391, 3)).toBe(28.614);
  });

  it('explains geolocation failures', () => {
    expect(geolocationErrorMessage({ code: 1 })).toMatch(/permission was denied/i);
    expect(geolocationErrorMessage({ code: 3 })).toMatch(/too long/i);
    expect(geolocationErrorMessage(undefined)).toMatch(/could not/i);
  });
});

describe('addSkill', () => {
  it('normalises whitespace and rejects case-insensitive duplicates', () => {
    expect(addSkill(['React'], '  Node   JS ')).toEqual({ skills: ['React', 'Node JS'] });
    const dup = addSkill(['React'], 'react');
    expect(dup.skills).toEqual(['React']);
    expect(dup.error).toMatch(/already/);
    expect(addSkill(['React'], '   ')).toEqual({ skills: ['React'] });
  });

  it('enforces the length and count limits', () => {
    expect(addSkill([], 'x'.repeat(51)).error).toMatch(/at most 50 characters/);
    const full = Array.from({ length: 50 }, (_, i) => `S${i}`);
    expect(addSkill(full, 'One more').error).toMatch(/at most 50 skills/);
  });
});

describe('completenessHints', () => {
  it('mirrors the server scoring fields', () => {
    const hints = completenessHints({ profilePhotoUrl: 'x', shortBio: 'short', city: 'Pune' });
    expect(hints.filter((h) => !h.done).map((h) => h.id)).toEqual(['bio', 'linkedin', 'designation']);
    expect(hints.reduce((sum, h) => sum + h.points, 20)).toBe(100);
  });
});
