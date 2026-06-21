import { Database } from './Database';
import { ChangeRecord } from '../types';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _bolt_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_id INTEGER,
  checksum TEXT,
  payload TEXT,
  synced INTEGER DEFAULT 0,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bolt_changes_unsynced ON _bolt_changes(synced, timestamp);
`;

export interface WriteOp {
  op: 'insert' | 'update' | 'delete';
  table: string;
}

/** Parse INSERT/UPDATE/DELETE SQL to extract operation type and table name. */
export function parseWriteOperation(sql: string): WriteOp | null {
  const insert = sql.match(/^\s*(?:INSERT|REPLACE)\s+INTO\s+["`]?(\w+)["`]?/i);
  if (insert) return { op: 'insert', table: insert[1] };

  const update = sql.match(/^\s*UPDATE\s+["`]?(\w+)["`]?/i);
  if (update) return { op: 'update', table: update[1] };

  const del = sql.match(/^\s*DELETE\s+FROM\s+["`]?(\w+)["`]?/i);
  if (del) return { op: 'delete', table: del[1] };

  return null;
}

/** Simple djb2 hash of canonical JSON. */
export function checksum(data: Record<string, any>): string {
  const str = JSON.stringify(data, Object.keys(data).sort());
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export class ChangeTracker {
  private initialized = false;

  constructor(private db: Database) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    for (const stmt of CREATE_TABLE_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
      await this.db.execute(stmt);
    }
    this.initialized = true;
  }

  /**
   * Auto-track a change from a raw SQL execution.
   * Call this immediately after a successful Database.execute().
   */
  async trackExecute(sql: string, result: { changes: number; lastId?: number }): Promise<void> {
    const parsed = parseWriteOperation(sql);
    if (!parsed) return;

    const rowId = parsed.op === 'insert' ? result.lastId ?? null : null;
    await this.track(parsed.op, parsed.table, rowId);
  }

  /** Explicitly track a change with full metadata. */
  async track(
    op: 'insert' | 'update' | 'delete',
    table: string,
    rowId?: number | null,
    checksumValue?: string | null,
    payload?: Record<string, any> | null
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO _bolt_changes (op, table_name, row_id, checksum, payload, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        op,
        table,
        rowId ?? null,
        checksumValue ?? null,
        payload ? JSON.stringify(payload) : null,
        Date.now(),
      ]
    );
  }

  /** Get all unsynced changes, oldest first. */
  async pending(): Promise<ChangeRecord[]> {
    return this.db.query<ChangeRecord>(
      `SELECT id, op, table_name as tableName, row_id as rowId, checksum, payload, synced, timestamp FROM _bolt_changes WHERE synced = 0 ORDER BY timestamp`
    );
  }

  /** Mark changes as synced by ID. */
  async markSynced(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.db.execute(
      `UPDATE _bolt_changes SET synced = 1 WHERE id IN (${placeholders})`,
      ids
    );
  }

  /** Count unsynced changes. */
  async countPending(): Promise<number> {
    const row = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM _bolt_changes WHERE synced = 0`
    );
    return row[0]?.count ?? 0;
  }

  /** Clear all synced changes older than a cutoff. */
  async prune(cutoffMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = Date.now() - cutoffMs;
    await this.db.execute(
      `DELETE FROM _bolt_changes WHERE synced = 1 AND timestamp < ?`,
      [cutoff]
    );
  }
}
