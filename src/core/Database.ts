import { Driver } from '../drivers/Driver';
import { BoltConfig, Queryable, ExecuteResult, PaginatedResult, QueryPlanRow, SyncResult } from '../types';
import { QueryBuilder } from './QueryBuilder';
import { Transaction } from './Transaction';
import { MigrationEngine } from './MigrationEngine';
import { SchemaIntrospector } from './SchemaIntrospector';
import { ChangeTracker, parseWriteOperation } from './ChangeTracker';
import { csvToObjects } from './CSVParser';
import { NetworkStatus } from './NetworkStatus';
import { BoltQueue } from './BoltQueue';
import { SyncAdapter } from './SyncAdapter';
import { BackgroundSync } from './BackgroundSync';
import { normalizeParams } from './Sanitizer';
import { DatabaseLockedError } from '../errors';
import { BoltLogger, consoleHandler } from './Logger';
import { BoltEvent } from './BoltEvent';

const SYSTEM_TABLES = new Set(['_bolt_changes', '_bolt_queue', '_bolt_sync_meta']);

export class Database implements Queryable {
  private _open: boolean = false;
  readonly introspect: SchemaIntrospector;
  readonly network: NetworkStatus;
  private tracker?: ChangeTracker;
  private _queue?: BoltQueue;
  private _syncAdapter?: SyncAdapter;
  private _backgroundSync?: BackgroundSync;
  private unbindNetwork?: () => void;

  private logger?: BoltLogger;

  constructor(private driver: Driver, private config: BoltConfig) {
    this.introspect = new SchemaIntrospector(this);
    this.network = new NetworkStatus();
    if (config.debug) {
      this.logger = new BoltLogger();
      this.logger.addHandler(consoleHandler);
    }
  }

  async open(): Promise<void> {
    await this.driver.open();
    this._open = true;

    if (this.config.sync?.enabled) {
      this.tracker = new ChangeTracker(this);
      this._queue = new BoltQueue(this);
      await this.tracker.init();
      await this._queue.init();
      this._syncAdapter = new SyncAdapter(this, this.config.sync, this.network, this.tracker);
      await this._syncAdapter.init();

      if (this.config.sync.autoSync) {
        this.unbindNetwork = this.network.onChange((online) => {
          if (online) this._syncAdapter?.sync().catch(() => {});
        });
      }

      if (this.config.sync.syncInterval) {
        this._backgroundSync = new BackgroundSync(this._syncAdapter, {
          intervalMs: this.config.sync.syncInterval,
          enabled: true,
        });
        this._backgroundSync.start().catch(() => {});
      }
    }
  }

  isOpen(): boolean {
    return this._open && this.driver.isOpen();
  }

  async close(): Promise<void> {
    this.unbindNetwork?.();
    this._backgroundSync?.stop();
    await this.driver.close();
    this._open = false;
  }

  /** Force-persist database state (no-op for drivers that don't support it). */
  async persist(): Promise<void> {
    if (this.driver.persist) {
      await this.driver.persist();
    }
  }

  table<T = Record<string, any>>(name: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this, name);
  }

  async ping(): Promise<{ ok: true; latencyMs: number }> {
    const start = Date.now();
    await this.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch {
      return false;
    }
  }

  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    const normalized = params ? normalizeParams(params) : params;
    await BoltEvent.emit('db.beforeQuery', { event: 'db.beforeQuery', table: '', data: { sql, params: normalized }, timestamp: Date.now() });
    const result = await this.withRetry(() =>
      this.logger
        ? this.logger.timeAsync('query', sql, normalized, () => this.driver.query<T>(sql, normalized))
        : this.driver.query<T>(sql, normalized)
    );
    await BoltEvent.emit('db.afterQuery', { event: 'db.afterQuery', table: '', data: { sql, params: normalized, result }, timestamp: Date.now() });
    return result;
  }

  async explain(sql: string, params?: any[]): Promise<QueryPlanRow[]> {
    return this.query<QueryPlanRow>(`EXPLAIN QUERY PLAN ${sql}`, params);
  }

  async execute(sql: string, params?: any[]): Promise<ExecuteResult> {
    const normalized = params ? normalizeParams(params) : params;
    await BoltEvent.emit('db.beforeExecute', { event: 'db.beforeExecute', table: '', data: { sql, params: normalized }, timestamp: Date.now() });
    const result = await this.withRetry(() =>
      this.logger
        ? this.logger.timeAsync('execute', sql, normalized, () => this.driver.execute(sql, normalized))
        : this.driver.execute(sql, normalized)
    );
    await BoltEvent.emit('db.afterExecute', { event: 'db.afterExecute', table: '', data: { sql, params: normalized, result }, timestamp: Date.now() });
    if (this.tracker && this.config.sync?.enabled) {
      const writeInfo = parseWriteOperation(sql);
      if (writeInfo && !SYSTEM_TABLES.has(writeInfo.table)) {
        await this.tracker.trackExecute(sql, result);
      }
    }
    return result;
  }

  async transaction<T>(fn: (trx: Transaction) => Promise<T>): Promise<T> {
    const trx = new Transaction(this.driver);
    await trx.begin();
    try {
      const result = await fn(trx);
      await trx.commit();
      return result;
    } catch (e) {
      await trx.rollback();
      throw e;
    }
  }

  async migrate(): Promise<void> {
    if (this.config.migrations && this.config.migrations.length > 0) {
      const engine = new MigrationEngine(this, this.config.migrations);
      await engine.run(this.config.version || 1);
      await this.persist();
    }
  }

  /** Explicitly track a change (used by BoltModel for enriched row_id tracking). */
  async trackChange(
    op: 'insert' | 'update' | 'delete',
    table: string,
    rowId?: number | null,
    checksum?: string | null,
    payload?: Record<string, any> | null
  ): Promise<void> {
    if (this.tracker && !SYSTEM_TABLES.has(table)) {
      await this.tracker.track(op, table, rowId, checksum, payload);
    }
  }

  /** Get current sync status. */
  async syncStatus(): Promise<{ pending: number; lastSync: Date | null; conflicts: number; online: boolean }> {
    const pending = this.tracker ? await this.tracker.countPending() : 0;
    const lastSyncRaw = this._syncAdapter
      ? await (this._syncAdapter as any).getMeta('lastSync')
      : null;
    const lastSync = lastSyncRaw ? new Date(Number(lastSyncRaw)) : null;
    return { pending, lastSync, conflicts: 0, online: this.network.isOnline() };
  }

  /** Trigger a manual sync (push + pull). */
  async sync(): Promise<SyncResult> {
    if (!this._syncAdapter) {
      return { pushed: 0, pulled: 0, conflicts: 0, errors: ['Sync not enabled'] };
    }
    return this._syncAdapter.sync();
  }

  /** Access the offline queue (only available when sync is enabled). */
  getQueue(): BoltQueue | undefined {
    return this._queue;
  }

  // ── Data Seeding ──

  /** Bulk insert rows from a JSON array into a table. */
  async seedFromJSON(data: Record<string, any>[], table: string): Promise<number> {
    if (data.length === 0) return 0;
    const fields = Object.keys(data[0]);
    const placeholders = fields.map(() => '?').join(', ');
    const columns = fields.map((f) => `"${f}"`).join(', ');
    const sql = `INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`;

    let total = 0;
    for (const row of data) {
      const values = fields.map((f) => row[f]);
      const result = await this.execute(sql, values);
      total += result.changes;
    }
    return total;
  }

  /** Parse CSV and insert rows into a table. */
  async seedFromCSV(csv: string, table: string, options?: import('./CSVParser').CSVOptions): Promise<number> {
    const rows = csvToObjects(csv, options);
    return this.seedFromJSON(rows, table);
  }

  // ── Export / Import ──

  /** Export selected tables (or all user tables) to JSON. */
  async exportToJSON(tables?: string[]): Promise<Record<string, any[]>> {
    const targets = tables?.length
      ? tables
      : (await this.introspect.tables()).map((t) => t.name).filter((n) => !n.startsWith('_bolt_'));

    const result: Record<string, any[]> = {};
    for (const table of targets) {
      result[table] = await this.query(`SELECT * FROM "${table}"`);
    }
    return result;
  }

  /** Import tables from a JSON dump. */
  async importFromJSON(
    data: Record<string, any[]>,
    options: { clearBeforeImport?: boolean; skipErrors?: boolean } = {}
  ): Promise<{ inserted: number; errors: string[] }> {
    let inserted = 0;
    const errors: string[] = [];

    for (const [table, rows] of Object.entries(data)) {
      if (options.clearBeforeImport) {
        try {
          await this.execute(`DELETE FROM "${table}"`);
        } catch (e: any) {
          errors.push(`Failed to clear ${table}: ${e.message}`);
          if (!options.skipErrors) throw new Error(errors[errors.length - 1]);
          continue;
        }
      }

      for (const row of rows) {
        try {
          const fields = Object.keys(row);
          const placeholders = fields.map(() => '?').join(', ');
          const columns = fields.map((f) => `"${f}"`).join(', ');
          const sql = `INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`;
          const result = await this.execute(sql, Object.values(row));
          inserted += result.changes;
        } catch (e: any) {
          errors.push(`Import failed for ${table}: ${e.message}`);
          if (!options.skipErrors) throw new Error(errors[errors.length - 1]);
        }
      }
    }

    return { inserted, errors };
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const cfg = this.config.retry;
    const maxRetries = cfg?.maxRetries ?? 3;
    const delayMs = cfg?.delayMs ?? 100;
    const backoff = cfg?.backoff ?? 'exponential';
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof DatabaseLockedError && attempt < maxRetries) {
          const wait = backoff === 'exponential' ? delayMs * Math.pow(2, attempt) : delayMs * (attempt + 1);
          await new Promise((r) => setTimeout(r, wait));
          lastError = e;
          continue;
        }
        throw e;
      }
    }
    throw lastError!;
  }
}