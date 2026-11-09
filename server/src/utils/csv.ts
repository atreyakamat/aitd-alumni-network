export interface CsvColumn<T> {
  header: string;
  key?: keyof T & string;
  value?: (row: T) => unknown;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const formatCell = (raw: unknown): string => {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw === 'object' && 'toString' in (raw as object) && (raw as any).constructor?.name === 'Decimal') {
    return String(raw);
  }

  let text = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  // Prevent CSV/formula injection when the export is opened in a spreadsheet
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
};

/** One value as a CSV cell: quoted when needed and neutralised against spreadsheet formula injection. */
export const csvCell = (value: unknown): string => formatCell(value);

/** The header line (no line terminator): the first line of a CSV, also when the rest is streamed. */
export const csvHeaderLine = <T>(columns: CsvColumn<T>[]): string => columns.map((c) => formatCell(c.header)).join(',');

/** One record (no line terminator). Lines are joined with CRLF; there is no trailing newline. */
export const csvRowLine = <T>(row: T, columns: CsvColumn<T>[]): string =>
  columns.map((c) => formatCell(c.value ? c.value(row) : c.key ? (row as any)[c.key] : undefined)).join(',');

export const toCsv = <T>(rows: T[], columns: CsvColumn<T>[]): string =>
  [csvHeaderLine(columns), ...rows.map((row) => csvRowLine(row, columns))].join('\r\n');
