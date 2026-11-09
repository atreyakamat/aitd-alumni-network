import { csvCell, csvHeaderLine, csvRowLine, toCsv } from '../../utils/csv';

describe('toCsv', () => {
  it('renders a header row from the column definitions', () => {
    const csv = toCsv([{ a: 1, b: 'x' }], [
      { key: 'a', header: 'Alpha' },
      { key: 'b', header: 'Beta' },
    ]);
    expect(csv.split('\r\n')[0]).toBe('Alpha,Beta');
    expect(csv.split('\r\n')[1]).toBe('1,x');
  });

  it('quotes values containing commas, quotes and newlines', () => {
    const csv = toCsv([{ v: 'a,b' }, { v: 'say "hi"' }, { v: 'line1\nline2' }], [{ key: 'v', header: 'V' }]);
    const rows = csv.split('\r\n');
    expect(rows[1]).toBe('"a,b"');
    expect(rows[2]).toBe('"say ""hi"""');
    expect(rows[3]).toBe('"line1\nline2"');
  });

  it('neutralises spreadsheet formula injection', () => {
    const csv = toCsv([{ v: '=HYPERLINK("x")' }, { v: '+1' }, { v: '-2' }, { v: '@SUM(A1)' }], [{ key: 'v', header: 'V' }]);
    const rows = csv.split('\r\n').slice(1);
    expect(rows[0]).toBe(`"'=HYPERLINK(""x"")"`);
    expect(rows[1]).toBe("'+1");
    expect(rows[2]).toBe("'-2");
    expect(rows[3]).toBe("'@SUM(A1)");
  });

  it('keeps plain negative numbers numeric', () => {
    const csv = toCsv([{ v: -5 }], [{ key: 'v', header: 'V' }]);
    expect(csv.split('\r\n')[1]).toBe('-5');
  });

  it('formats dates as ISO strings and blanks null/undefined', () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    const csv = toCsv([{ d, n: null, u: undefined }], [
      { key: 'd', header: 'D' },
      { key: 'n', header: 'N' },
      { key: 'u', header: 'U' },
    ]);
    expect(csv.split('\r\n')[1]).toBe('2026-01-02T03:04:05.000Z,,');
  });

  it('supports computed columns', () => {
    const csv = toCsv([{ user: { name: 'Ann' } }], [{ header: 'Name', value: (r: any) => r.user.name }]);
    expect(csv.split('\r\n')[1]).toBe('Ann');
  });
});

describe('line helpers used to stream a CSV', () => {
  const columns = [
    { key: 'a' as const, header: 'Alpha' },
    { key: 'b' as const, header: 'Be,ta' },
  ];

  it('csvHeaderLine and csvRowLine produce exactly the lines toCsv joins', () => {
    const rows = [{ a: 1, b: 'x' }, { a: '=cmd', b: 'say "hi"' }];
    const streamed = [csvHeaderLine(columns), ...rows.map((row) => csvRowLine(row, columns))].join('\r\n');
    expect(streamed).toBe(toCsv(rows, columns));
    expect(csvHeaderLine(columns)).toBe('Alpha,"Be,ta"');
  });

  it('csvCell quotes and neutralises a single value', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=1+1')).toBe("'=1+1");
  });
});
