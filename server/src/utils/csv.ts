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

export const toCsv = <T>(rows: T[], columns: CsvColumn<T>[]): string => {
  const header = columns.map((c) => formatCell(c.header)).join(',');
  const body = rows.map((row) =>
    columns
      .map((c) => formatCell(c.value ? c.value(row) : c.key ? (row as any)[c.key] : undefined))
      .join(',')
  );
  return [header, ...body].join('\r\n');
};
