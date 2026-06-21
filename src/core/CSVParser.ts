export interface CSVOptions {
  delimiter?: string;
  hasHeader?: boolean;
}

/** Lightweight RFC-4180-ish CSV parser. No external deps. */
export function parseCSV(csv: string, options: CSVOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const next = csv[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        if (field !== '' || row.length > 0) {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        }
      } else if (char === '\r') {
        if (field !== '' || row.length > 0) {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        }
        if (next === '\n') i++;
      } else {
        field += char;
      }
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Convert parsed CSV rows to objects using the first row as headers. */
export function csvToObjects(csv: string, options: CSVOptions = {}): Record<string, string>[] {
  const rows = parseCSV(csv, options);
  if (rows.length === 0) return [];
  const hasHeader = options.hasHeader !== false;
  const headers = hasHeader ? rows[0] : rows[0].map((_, i) => `col${i}`);
  const data = hasHeader ? rows.slice(1) : rows;

  return data.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? '';
    });
    return obj;
  });
}
