import { Driver } from './Driver';
import { BoltConfig, ExecuteResult } from '../types';
import { ConnectionError, QueryError, DatabaseLockedError } from '../errors';

// Peer dependency: @capacitor-community/sqlite
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

export class CapacitorDriver extends Driver {
  private sqlite: SQLiteConnection;
  private db?: SQLiteDBConnection;
  private config: BoltConfig;
  private _isOpen: boolean = false;

  constructor(config: BoltConfig) {
    super();
    this.config = config;
    this.sqlite = new SQLiteConnection(CapacitorSQLite);
  }

  async open(): Promise<void> {
    try {
      // initWebStore is only required for web platform (jeep-sqlite/IndexedDB).
      // Native iOS/Android do not implement this method.
      try {
        await this.sqlite.initWebStore();
      } catch (e: any) {
        if (!e.message?.includes('not implemented')) throw e;
      }

      this.db = await this.sqlite.createConnection(
        this.config.dbName,
        this.config.encrypted || false,
        this.config.encrypted ? 'secret' : 'no-encryption',
        this.config.version || 1,
        false
      );
      await this.db.open();
      this._isOpen = true;
    } catch (e: any) {
      if (e.message?.includes('jeep-sqlite')) {
        throw new ConnectionError(
          `Web platform requires jeep-sqlite. ` +
          `Install it (npm install jeep-sqlite) and add <jeep-sqlite></jeep-sqlite> to your DOM. ` +
          `Original error: ${e.message}`
        );
      }
      throw new ConnectionError(`Failed to open ${this.config.dbName}: ${e.message}`);
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      await this.sqlite.closeConnection(this.config.dbName, false);
      this._isOpen = false;
      this.db = undefined;
    }
  }

  isOpen(): boolean {
    return this._isOpen && !!this.db;
  }

  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.db) throw new ConnectionError('Database not open');
    try {
      const result = await this.db.query(sql, params || []);
      return (result.values || []) as T[];
    } catch (e: any) {
      throw this.classifyError(e.message, sql, params);
    }
  }

  async execute(sql: string, params?: any[]): Promise<ExecuteResult> {
    if (!this.db) throw new ConnectionError('Database not open');
    try {
      const result = await this.db.run(sql, params || [], false);
      return {
        changes: result.changes?.changes || 0,
        lastId: result.changes?.lastId
      };
    } catch (e: any) {
      throw this.classifyError(e.message, sql, params);
    }
  }

  private classifyError(message: string, sql?: string, params?: any[]): QueryError | DatabaseLockedError {
    const m = message.toLowerCase();
    if (m.includes('database is locked') || m.includes('busy')) {
      return new DatabaseLockedError(message);
    }
    return new QueryError(message, sql, params);
  }

  async beginTransaction(): Promise<void> {
    await this.execute('BEGIN TRANSACTION');
  }

  async commit(): Promise<void> {
    await this.execute('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.execute('ROLLBACK');
  }
}
