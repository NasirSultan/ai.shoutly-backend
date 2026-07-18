// Hard cap on rows per export — protects memory/response size; large data sets
// should get a paginated/background export mechanism instead, not this endpoint.
export const CSV_EXPORT_ROW_LIMIT = 5000;

export interface CsvColumn<T> {
  key: string;
  header: string;
  value?: (row: T) => string | number | boolean | null | undefined;
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv<T extends Record<string, any>>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvCell(c.header)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvCell(c.value ? c.value(row) : row[c.key])).join(','),
  );
  return [header, ...lines].join('\r\n');
}
