import { describe, expect, it } from 'vitest';
import { IMPORT_CHUNK_SIZE, MAX_IMPORT_FILE_ROWS, chunkRows, parseAlumniCsv } from '@/lib/alumni-csv';

const HEADER = 'fullName,batchYear,department,enrollmentNumber';

describe('parseAlumniCsv', () => {
  it('reads the rows under the header, with the line each one came from', () => {
    const result = parseAlumniCsv(`${HEADER}\nAda Alum,2015,Computer Engineering,12CE045\nBen Batch,2016,,`);
    expect(result.fatal).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, fullName: 'Ada Alum', batchYear: 2015, department: 'Computer Engineering', enrollmentNumber: '12CE045' },
      { line: 3, fullName: 'Ben Batch', batchYear: 2016 },
    ]);
  });

  it('copes with Windows line ends, a byte-order mark, blank lines and spaces around the cells', () => {
    const result = parseAlumniCsv(`﻿${HEADER}\r\n  Ada Alum , 2015 ,  Civil  , 12ce045 \r\n\r\n\r\nBen Batch,2016\r\n`);
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => [r.line, r.fullName, r.batchYear, r.department, r.enrollmentNumber])).toEqual([
      [2, 'Ada Alum', 2015, 'Civil', '12ce045'],
      [5, 'Ben Batch', 2016, undefined, undefined],
    ]);
  });

  it('reads quoted cells: commas, doubled quotes and line breaks inside them (a line break in a cell becomes a space)', () => {
    const result = parseAlumniCsv(`${HEADER}\n"Alum, Ada",2015,"Computer ""Eng""\nineering",\n"O'Neil",2016,,`);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ line: 2, fullName: 'Alum, Ada', department: 'Computer "Eng" ineering' });
    // the next record starts on the line after the multi-line cell
    expect(result.rows[1]).toMatchObject({ line: 4, fullName: "O'Neil" });
  });

  it('accepts the columns in any order, ignores header case and extra columns, and the department and number may be missing altogether', () => {
    const result = parseAlumniCsv('BatchYear,ignored,FULLNAME\n2015,x,Ada Alum');
    expect(result.rows).toEqual([{ line: 2, fullName: 'Ada Alum', batchYear: 2015 }]);
  });

  it('needs the header row with fullName and batchYear, and says what is missing instead of guessing', () => {
    expect(parseAlumniCsv('Ada Alum,2015\nBen,2016').fatal).toMatch(/header/i);
    expect(parseAlumniCsv('fullName,department\nAda,Civil').fatal).toMatch(/batchYear/);
    expect(parseAlumniCsv('batchYear,department\n2015,Civil').fatal).toMatch(/fullName/);
    expect(parseAlumniCsv('').fatal).toMatch(/nothing|empty/i);
    expect(parseAlumniCsv('   \n\n').fatal).toMatch(/nothing|empty/i);
  });

  it('a file with a header and no rows is an error too', () => {
    expect(parseAlumniCsv(HEADER).fatal).toMatch(/no rows/i);
  });

  it('keeps the bad rows out of the rows, each with its line and what is wrong', () => {
    const result = parseAlumniCsv(
      [
        HEADER,
        'Good One,2015,,',
        'X,2015,,',
        ',2015,,',
        'No Year,,,',
        'Far Past,1800,,',
        'Far Future,3000,,',
        'Half Year,2015.5,,',
        'Text Year,soon,,',
        `Long Department,2015,${'d'.repeat(101)},`,
        `Long Number,2015,,${'9'.repeat(51)}`,
        `${'N'.repeat(101)},2015,,`,
        'Another Good,2016,,',
      ].join('\n')
    );
    expect(result.rows.map((r) => r.fullName)).toEqual(['Good One', 'Another Good']);
    expect(result.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result.errors.every((e) => e.message.length > 0)).toBe(true);
  });

  it('flags a repeated enrolment number inside the file (the second one is not sent)', () => {
    const result = parseAlumniCsv(`${HEADER}\nAda Alum,2015,,12ce 045\nSomebody Else,2015,,12CE045`);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([{ line: 3, message: expect.stringMatching(/line 2/) }]);
  });

  it('flags an unterminated quote instead of swallowing the rest of the file', () => {
    const result = parseAlumniCsv(`${HEADER}\n"Ada Alum,2015,,\nBen Batch,2016,,`);
    expect(result.fatal ?? result.errors[0]?.message).toMatch(/quote/i);
  });

  it('refuses a file with more rows than the page will handle', () => {
    const rows = Array.from({ length: MAX_IMPORT_FILE_ROWS + 1 }, (_, i) => `Person ${i},2015,,E${i}`).join('\n');
    expect(parseAlumniCsv(`${HEADER}\n${rows}`).fatal).toMatch(/too many/i);
  });

  it('treats a cell that starts with = + - @ as plain text (nothing here is ever opened in a spreadsheet, but it stays text)', () => {
    const result = parseAlumniCsv(`${HEADER}\n=HYPERLINK("x"),2015,,`);
    expect(result.rows[0].fullName).toBe('=HYPERLINK("x")');
  });
});

describe('chunkRows', () => {
  it(`splits into requests of at most ${IMPORT_CHUNK_SIZE} rows`, () => {
    const rows = Array.from({ length: 1201 }, (_, i) => i);
    const chunks = chunkRows(rows);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 201]);
    expect(chunks.flat()).toEqual(rows);
    expect(chunkRows([])).toEqual([]);
  });
});
