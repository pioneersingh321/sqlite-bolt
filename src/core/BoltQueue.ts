import { Database } from './Database';
import { QueueRecord } from '../types';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _bolt_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id INTEGER,
  op TEXT NOT NULL,
  payload TEXT NOT NULL,
  checksum TEXT,
  attempts INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(table_name, row_id)
);
CREATE INDEX IF NOT EXISTS idx_bolt_queue_created ON _bolt_queue(created_at);
`;

export interface QueuePayload {
  changedFields?: Record<string, any>;
  fullRow?: Record<string, any>;
}

export class BoltQueue {
  private initialized = false;

  constructor(private db: Database) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    for (const stmt of CREATE_TABLE_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
      await this.db.execute(stmt);
    }
    this.initialized = true;
  }

  /** Enqueue a mutation. Deduplicates by (table, row_id) — replaces previous pending op for same row. */
  async enqueue(
    table: string,
    op: 'insert' | 'update' | 'delete',
    payload: QueuePayload,
    rowId?: number | null,
    checksum?: string | null
  ): Promise<void> {
    const json = JSON.stringify(payload);
    await this.db.execute(
      `INSERT INTO _bolt_queue (table_name, row_id, op, payload, checksum, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(table_name, row_id) DO UPDATE SET
         op = excluded.op,
         payload = excluded.payload,
         checksum = excluded.checksum,
         attempts = 0,
         created_at = excluded.created_at`,
      [table, rowId ?? null, op, json, checksum ?? null, Date.now()]
    );
  }

  /** Get all pending queue items, oldest first. */
  async pending(): Promise<QueueRecord[]> {
    return this.db.query<QueueRecord>(
      `SELECT id, table_name as tableName, row_id as rowId, op, payload, checksum, attempts, created_at as createdAt
       FROM _bolt_queue ORDER BY created_at`
    );
  }

  /** Remove processed items by ID. */
  async remove(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.db.execute(`DELETE FROM _bolt_queue WHERE id IN (${placeholders})`, ids);
  }

  /** Increment attempt counter for retryable items. */
  async incrementAttempts(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.db.execute(
      `UPDATE _bolt_queue SET attempts = attempts + 1 WHERE id IN (${placeholders})`,
      ids
    );
  }

  /** Count pending items. */
  async count(): Promise<number> {
    const row = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM _bolt_queue`
    );
    return row[0]?.count ?? 0;
  }

  /** Clear the entire queue. */
  async clear(): Promise<void> {
    await this.db.execute(`DELETE FROM _bolt_queue`);
  }
}
