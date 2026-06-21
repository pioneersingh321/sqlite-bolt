import { Driver } from './Driver';
import { BoltConfig, ExecuteResult } from '../types';
import { ConnectionError, QueryError, DatabaseLockedError } from '../errors';

const IDB_DB_NAME = 'sqlite-bolt';
const IDB_STORE = 'databases';

async function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
  });
}

async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
    req.onsuccess = () => {
      const val = req.result;
      if (val instanceof ArrayBuffer) resolve(new Uint8Array(val));
      else if (val instanceof Uint8Array) resolve(val);
      else resolve(undefined);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: Uint8Array): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(IDB_STORE);
    store.put(value, key);
  });
}

export class WebDriver extends Driver {
  private SQL?: any;
  private db?: any;
  private config: BoltConfig;
  private _isOpen: boolean = false;
  private _opfsAvailable: boolean = false;

  constructor(config: BoltConfig) {
    super();
    this.config = config;
  }

  async open(): Promise<void> {
    try {
      const { default: initSqlJs } = await import('sql.js');
      this.SQL = await initSqlJs({
        locateFile: (file: string) => {
          const base = this.config.sqlJsWasmPath || this.config.dbLocation || '';
          return base ? `${base.replace(/\/$/, '')}/${file}` : `/${file}`;
        }
      });

      this._opfsAvailable = typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;

      const saved = await this.load();
      this.db = new this.SQL.Database(saved);
      this._isOpen = true;

      if (this.config.debug) {
        console.log(`[Bolt] WebDriver opened ${this.config.dbName}`, saved ? `(${saved.byteLength} bytes)` : '(fresh)');
      }
    } catch (e: any) {
      const msg = e.message || String(e);
      if (msg.includes('wasm') || msg.includes('WebAssembly')) {
        throw new ConnectionError(
          `Failed to load sql.js WASM for ${this.config.dbName}. ` +
          `Copy sql-wasm.wasm from node_modules/sql.js/dist/ to your public directory and set ` +
          `sqlJsWasmPath in BoltConfig. Original error: ${msg}`
        );
      }
      throw new ConnectionError(`Failed to open ${this.config.dbName}: ${msg}`);
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.save();
      this.db.close();
      this.db = undefined;
      this._isOpen = false;
    }
  }

  isOpen(): boolean {
    return this._isOpen && !!this.db;
  }

  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.db) throw new ConnectionError('Database not open');
    try {
      const stmt = this.db.prepare(sql, params || []);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      stmt.free();
      return rows;
    } catch (e: any) {
      throw this.classifyError(e.message, sql, params);
    }
  }

  async execute(sql: string, params?: any[]): Promise<ExecuteResult> {
    if (!this.db) throw new ConnectionError('Database not open');
    try {
      this.db.run(sql, params || []);
      const changes = this.db.getRowsModified();
      let lastId: number | undefined;
      if (/^\s*INSERT\s+/i.test(sql)) {
        const stmt = this.db.prepare('SELECT last_insert_rowid() as id');
        stmt.step();
        lastId = Number((stmt.getAsObject() as any).id);
        stmt.free();
      }
      await this.save();
      return { changes, lastId };
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

  /* ── Persistence ── */

  private async save(): Promise<void> {
    if (!this.db) return;
    try {
      const data: Uint8Array = this.db.export();
      if (this._opfsAvailable) {
        await this.saveOPFS(data);
      } else {
        await idbSet(this.config.dbName, data);
      }
      if (this.config.debug) {
        console.log(`[Bolt] WebDriver saved ${this.config.dbName} (${data.byteLength} bytes)`);
      }
    } catch (e) {
      if (this.config.debug) console.error('[Bolt] WebDriver save failed:', e);
    }
  }

  private async load(): Promise<Uint8Array | undefined> {
    try {
      if (this._opfsAvailable) {
        return await this.loadOPFS();
      }
      return await idbGet(this.config.dbName);
    } catch {
      return undefined;
    }
  }

  /* OPFS */

  private async saveOPFS(data: Uint8Array): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(this.config.dbName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data as BufferSource);
    await writable.close();
  }

  private async loadOPFS(): Promise<Uint8Array | undefined> {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(this.config.dbName);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return undefined;
    }
  }
}
