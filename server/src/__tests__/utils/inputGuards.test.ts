import { AppError } from '../../middleware/errorHandler';
import { firstQueryText, idText, optionalBoolean, optionalInt, optionalText, queryText, requiredText } from '../../utils/inputGuards';

const code400 = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(400);
    expect((error as AppError).code).toBe('VALIDATION_ERROR');
    return;
  }
  throw new Error('expected a 400 AppError');
};

describe('inputGuards', () => {
  describe('optionalText', () => {
    it('passes undefined, null and strings through', () => {
      expect(optionalText(undefined, 'f')).toBeUndefined();
      expect(optionalText(null, 'f')).toBeNull();
      expect(optionalText('', 'f')).toBe('');
      expect(optionalText('hi', 'f')).toBe('hi');
    });
    it.each([5, true, ['a'], { a: 1 }])('rejects %p', (value) => code400(() => optionalText(value, 'city')));
  });

  describe('requiredText', () => {
    it('trims', () => expect(requiredText('  Pune ', 'region')).toBe('Pune'));
    it.each([undefined, null, '', '   ', 5, ['x'], {}])('rejects %p', (value) => code400(() => requiredText(value, 'region')));
  });

  describe('optionalBoolean', () => {
    it('accepts booleans and undefined', () => {
      expect(optionalBoolean(undefined, 'f')).toBeUndefined();
      expect(optionalBoolean(false, 'f')).toBe(false);
    });
    it.each([null, 'true', 1, [], {}])('rejects %p', (value) => code400(() => optionalBoolean(value, 'isPublic')));
  });

  describe('idText', () => {
    it('accepts a string id', () => expect(idText(' abc ', 'id')).toBe('abc'));
    it.each([undefined, null, '', 5, ['x'], {}, 'x'.repeat(129)])('rejects %p', (value) => code400(() => idText(value, 'id')));
  });

  describe('optionalInt', () => {
    it('accepts integers and numeric strings in range', () => {
      expect(optionalInt(undefined, 'f')).toBeUndefined();
      expect(optionalInt(2015, 'f', 1900, 2200)).toBe(2015);
      expect(optionalInt('2015', 'f', 1900, 2200)).toBe(2015);
    });
    it.each([null, 'abc', 1.5, 1800, 2300, [], {}, true])('rejects %p', (value) => code400(() => optionalInt(value, 'batchYear', 1900, 2200)));
  });

  describe('query values', () => {
    it('queryText only accepts one non-blank string', () => {
      expect(queryText(' a ')).toBe('a');
      expect(queryText('')).toBeUndefined();
      expect(queryText(['a', 'b'])).toBeUndefined();
      expect(queryText({ x: 'y' })).toBeUndefined();
    });
    it('firstQueryText takes the first of a repeated value', () => {
      expect(firstQueryText(['a', 'b'])).toBe('a');
      expect(firstQueryText({ x: 'y' })).toBeUndefined();
    });
  });
});
