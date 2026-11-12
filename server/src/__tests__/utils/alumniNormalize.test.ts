import { normalizeEnrollment, normalizeName } from '../../utils/alumniNormalize';

describe('normalizeEnrollment', () => {
  it('trims, upper-cases and removes every space', () => {
    expect(normalizeEnrollment('  12ce 045 ')).toBe('12CE045');
    expect(normalizeEnrollment('aiem / 2019 / 042')).toBe('AIEM/2019/042');
    expect(normalizeEnrollment('12CE\t045\n')).toBe('12CE045');
  });

  it('is null for blank or missing values and for anything that is not text', () => {
    expect(normalizeEnrollment('   ')).toBeNull();
    expect(normalizeEnrollment('')).toBeNull();
    expect(normalizeEnrollment(undefined)).toBeNull();
    expect(normalizeEnrollment(null)).toBeNull();
    expect(normalizeEnrollment(42 as unknown)).toBeNull();
  });

  it('gives the same result for the registration form and for the college list', () => {
    expect(normalizeEnrollment('16ce099')).toBe(normalizeEnrollment(' 16 CE 099 '));
  });
});

describe('normalizeName', () => {
  it('ignores case and collapses runs of spaces', () => {
    expect(normalizeName('  ada    LOVELACE ')).toBe('ada lovelace');
    expect(normalizeName('Ada\tLovelace')).toBe('ada lovelace');
  });

  it('strips diacritics, so a name typed without accents still matches', () => {
    expect(normalizeName('José Álvarez')).toBe('jose alvarez');
    expect(normalizeName('Zoë Müller')).toBe('zoe muller');
    expect(normalizeName('Łukasz Dvořák')).toBe(normalizeName('Lukasz Dvorak'));
  });

  it('matches names whose accents were composed or decomposed differently', () => {
    expect(normalizeName('émile')).toBe(normalizeName('émile'));
  });

  it('is empty for anything that is not text', () => {
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(7 as unknown)).toBe('');
  });
});
