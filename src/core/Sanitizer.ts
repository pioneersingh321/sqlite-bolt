import { QueryError } from '../errors';

const DANGEROUS_ID_CHARS = /[";]|--|\/\*|\x00/;

/**
 * Validate an identifier (table name, column name, alias) before it is
 * double-quoted into SQL. Rejects characters that could break out of the
 * quoted identifier and inject additional statements.
 */
export function sanitizeIdentifier(name: string): string {
  if (DANGEROUS_ID_CHARS.test(name)) {
    throw new QueryError(
      `Unsafe identifier detected: "${name}". Identifiers may not contain quotes, semicolons, or comment sequences.`
    );
  }
  return name;
}

/**
 * Normalize a single bound value so it is safe for SQLite parameter binding.
 * - boolean → 0 / 1
 * - Date → ISO-8601 string
 * - undefined → null
 * - NaN / Infinity → null
 * - plain objects / arrays → JSON string (shallow heuristic)
 */
export function normalizeValue(value: any): any {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) return null;
    return value;
  }
  if (value === null || typeof value === 'string' || typeof value === 'bigint') {
    return value;
  }
  // Arrays and plain objects → JSON (deep conversion left to driver/user)
  return JSON.stringify(value);
}

/** Normalize an array of bound parameters. */
export function normalizeParams(params: any[]): any[] {
  return params.map(normalizeValue);
}
