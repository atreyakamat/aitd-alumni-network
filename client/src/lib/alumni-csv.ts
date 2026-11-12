/**
 * The college alumni list is imported from a CSV file that is parsed HERE, in the browser, and sent as JSON in chunks:
 * the server has no file upload route for it. The rules below mirror the server (alumniRecordService), so the preview
 * shows the problems before anything is sent, and the server still checks every row again.
 *
 * Header row (any column order, any case): `fullName,batchYear,department,enrollmentNumber`. `fullName` and `batchYear`
 * are required columns; the other two are optional. Nothing from the file is ever rendered as HTML or logged.
 */
import type { AlumniImportRow } from '@/lib/api';

/** The server takes at most 1000 rows per request; the page sends 500. */
export const IMPORT_CHUNK_SIZE = 500;
/** More than this in one file is almost certainly the wrong file. */
export const MAX_IMPORT_FILE_ROWS = 20_000;
/** Reading a file that is bigger than this is refused before it is read. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

const MIN_NAME = 2;
const MAX_NAME = 100;
const MAX_DEPARTMENT = 100;
const MAX_ENROLLMENT = 50;
const MIN_BATCH_YEAR = 1950;
const MAX_YEARS_AHEAD = 5;

export interface ParsedAlumniRow extends AlumniImportRow {
  /** The line of the file this row starts on (the header is line 1). */
  line: number;
}

export interface AlumniCsvResult {
  rows: ParsedAlumniRow[];
  /** Rows that cannot be imported, by line. They are never sent. */
  errors: Array<{ line: number; message: string }>;
  /** Set when the file as a whole cannot be used (no header, empty, too big, broken quotes). */
  fatal?: string;
}

interface RawRecord {
  line: number;
  cells: string[];
}

type Split = { records: RawRecord[] } | { fatal: string };

const detectDelimiter = (text: string): string => {
  const firstLine = text.split(/\r\n|\n|\r/u).find((l) => l.trim() !== '') ?? '';
  if (firstLine.includes(',')) return ',';
  if (firstLine.includes(';')) return ';';
  if (firstLine.includes('\t')) return '\t';
  return ',';
};

/** RFC 4180 style: quoted cells may hold the delimiter, doubled quotes and line breaks. Blank lines are dropped. */
const splitRecords = (text: string, delimiter: string): Split => {
  const records: RawRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let line = 1;
  let recordLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
    wasQuoted = false;
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '' && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
      cell = '';
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (quoted) return { fatal: `A quote opened on line ${recordLine} is never closed. Check that line.` };
  if (cell !== '' || cells.length > 0) endRecord();
  return { records };
};

const normaliseNumber = (value: string) => value.replace(/\s+/gu, '').toUpperCase();

const COLUMN_KEYS = { fullname: 'fullName', batchyear: 'batchYear', department: 'department', enrollmentnumber: 'enrollmentNumber' } as const;
type Column = (typeof COLUMN_KEYS)[keyof typeof COLUMN_KEYS];

export function parseAlumniCsv(input: string): AlumniCsvResult {
  const text = input.replace(/^﻿/u, '');
  const empty: AlumniCsvResult = { rows: [], errors: [] };
  if (text.trim() === '') return { ...empty, fatal: 'The file is empty: there is nothing to import.' };

  const split = splitRecords(text, detectDelimiter(text));
  if ('fatal' in split) return { ...empty, fatal: split.fatal };
  const [header, ...body] = split.records;
  if (!header) return { ...empty, fatal: 'The file is empty: there is nothing to import.' };

  const columns = new Map<Column, number>();
  header.cells.forEach((name, index) => {
    const key = COLUMN_KEYS[name.trim().toLowerCase().replace(/[\s_-]+/gu, '') as keyof typeof COLUMN_KEYS];
    if (key && !columns.has(key)) columns.set(key, index);
  });
  for (const required of ['fullName', 'batchYear'] as const) {
    if (!columns.has(required)) {
      return {
        ...empty,
        fatal: `The first line must be the header row ${'fullName,batchYear,department,enrollmentNumber'}; the column ${required} is missing.`,
      };
    }
  }
  if (body.length === 0) return { ...empty, fatal: 'The file has a header but no rows.' };
  if (body.length > MAX_IMPORT_FILE_ROWS) {
    return { ...empty, fatal: `The file has too many rows (more than ${MAX_IMPORT_FILE_ROWS.toLocaleString('en-IN')}). Split it into smaller files.` };
  }

  const latest = new Date().getFullYear() + MAX_YEARS_AHEAD;
  const rows: ParsedAlumniRow[] = [];
  const errors: AlumniCsvResult['errors'] = [];
  const seenNumbers = new Map<string, number>();
  const cell = (record: RawRecord, column: Column) => {
    const index = columns.get(column);
    return index === undefined ? '' : (record.cells[index] ?? '').trim();
  };

  for (const record of body) {
    const fullName = cell(record, 'fullName').replace(/\s+/gu, ' ');
    const year = cell(record, 'batchYear');
    const department = cell(record, 'department').replace(/\s+/gu, ' ');
    const enrollmentNumber = cell(record, 'enrollmentNumber');
    const fail = (message: string) => errors.push({ line: record.line, message });

    if (fullName.length < MIN_NAME) fail(fullName ? `The name must be at least ${MIN_NAME} characters` : 'The name is missing');
    else if (fullName.length > MAX_NAME) fail(`The name must be at most ${MAX_NAME} characters`);
    else if (!/^\d{4}$/u.test(year)) fail('The batch year must be a four-digit year');
    else if (Number(year) < MIN_BATCH_YEAR || Number(year) > latest) fail(`The batch year must be between ${MIN_BATCH_YEAR} and ${latest}`);
    else if (department.length > MAX_DEPARTMENT) fail(`The department must be at most ${MAX_DEPARTMENT} characters`);
    else if (normaliseNumber(enrollmentNumber).length > MAX_ENROLLMENT) fail(`The enrolment number must be at most ${MAX_ENROLLMENT} characters`);
    else {
      const key = enrollmentNumber ? normaliseNumber(enrollmentNumber) : '';
      const earlier = key ? seenNumbers.get(key) : undefined;
      if (earlier !== undefined) {
        fail(`Same enrolment number as line ${earlier}`);
        continue;
      }
      if (key) seenNumbers.set(key, record.line);
      rows.push({
        line: record.line,
        fullName,
        batchYear: Number(year),
        ...(department ? { department } : {}),
        ...(enrollmentNumber ? { enrollmentNumber } : {}),
      });
    }
  }
  return { rows, errors };
}

/** Requests of at most IMPORT_CHUNK_SIZE rows each, in order. */
export function chunkRows<T>(rows: readonly T[], size = IMPORT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}
