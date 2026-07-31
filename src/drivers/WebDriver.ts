import { Driver } from './Driver';
import { BoltConfig, ExecuteResult } from '../types';
import { ConnectionError, QueryError, DatabaseLockedError } from '../errors';

const IDB_STORE_DATA = 'data';
const IDB_STORE_TABLES = 'tables';
const IDB_KEY = 'sqlite';

async function idbOpen(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_DATA)) {
        db.createObjectStore(IDB_STORE_DATA);
      }
      if (!db.objectStoreNames.contains(IDB_STORE_TABLES)) {
        db.createObjectStore(IDB_STORE_TABLES);
      }
    };
  });
}

async function idbGet(dbName: string): Promise<Uint8Array | undefined> {
  const db = await idbOpen(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_DATA, 'readonly');
    const store = tx.objectStore(IDB_STORE_DATA);
    const req = store.get(IDB_KEY);
    req.onsuccess = async () => {
      const val = req.result;
      if (val instanceof ArrayBuffer) resolve(new Uint8Array(val));
      else if (val instanceof Uint8Array) resolve(val);
      else {
        // Fallback migration check from legacy 'sqlite-bolt' database store
        try {
          const legacyDbReq = indexedDB.open('sqlite-bolt', 1);
          legacyDbReq.onsuccess = () => {
            const lDb = legacyDbReq.result;
            if (lDb.objectStoreNames.contains('databases')) {
              const lTx = lDb.transaction('databases', 'readonly');
              const lStore = lTx.objectStore('databases');
              const lReq = lStore.get(dbName);
              lReq.onsuccess = () => {
                const lVal = lReq.result;
                if (lVal instanceof ArrayBuffer) resolve(new Uint8Array(lVal));
                else if (lVal instanceof Uint8Array) resolve(lVal);
                else resolve(undefined);
              };
              lReq.onerror = () => resolve(undefined);
            } else {
              resolve(undefined);
            }
          };
          legacyDbReq.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(dbName: string, value: Uint8Array, sqliteDbInstance?: any): Promise<void> {
  const db = await idbOpen(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORE_DATA, IDB_STORE_TABLES], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

    const dataStore = tx.objectStore(IDB_STORE_DATA);
    dataStore.put(value, IDB_KEY);

    if (sqliteDbInstance) {
      try {
        const tablesStore = tx.objectStore(IDB_STORE_TABLES);
        const tblStmt = sqliteDbInstance.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        while (tblStmt.step()) {
          const row = tblStmt.getAsObject();
          if (row.name) {
            const tableName = String(row.name);
            const rows: any[] = [];
            const rStmt = sqliteDbInstance.prepare(`SELECT * FROM "${tableName}"`);
            while (rStmt.step()) {
              rows.push(rStmt.getAsObject());
            }
            rStmt.free();
            tablesStore.put(rows, tableName);
          }
        }
        tblStmt.free();
      } catch {
        // Ignore table inspection errors during store update
      }
    }
  });
}

async function idbDelete(dbName: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
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

  async deleteDatabase(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = undefined;
      this._isOpen = false;
    }
    await idbDelete(this.config.dbName);
    if (this._opfsAvailable) {
      await this.deleteOPFS(this.config.dbName);
    }
    if (this.config.debug) {
      console.log(`[Bolt] WebDriver deleted database ${this.config.dbName}`);
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
        try {
          await this.saveOPFS(data);
        } catch (e) {
          if (this.config.debug) console.warn('[Bolt] OPFS save failed:', e);
        }
      }
      // Always write to IndexedDB so database is visible in DevTools -> Application -> IndexedDB
      await idbSet(this.config.dbName, data, this.db);

      if (this.config.debug) {
        console.log(`[Bolt] WebDriver saved ${this.config.dbName} (${data.byteLength} bytes)`);
      }
    } catch (e) {
      if (this.config.debug) console.error('[Bolt] WebDriver save failed:', e);
    }
  }

  private async load(): Promise<Uint8Array | undefined> {
    try {
      const idbData = await idbGet(this.config.dbName);

      if (this._opfsAvailable) {
        const opfsData = await this.loadOPFS();

        // If IndexedDB was deleted (idbData is undefined), but OPFS file still exists,
        // it means the user deleted the database from DevTools Application console!
        // We must purge the orphaned OPFS file so the fresh schema can be created.
        if (!idbData && opfsData && opfsData.byteLength > 0) {
          if (this.config.debug) {
            console.log(`[Bolt] IndexedDB deleted from console for ${this.config.dbName}. Purging orphaned OPFS file.`);
          }
          await this.deleteOPFS(this.config.dbName);
          return undefined;
        }

        if (opfsData && opfsData.byteLength > 0) return opfsData;
      }

      return idbData;
    } catch {
      return await idbGet(this.config.dbName);
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

  private async deleteOPFS(dbName: string): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(dbName);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

