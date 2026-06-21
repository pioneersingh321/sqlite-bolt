import { Queryable } from '../types';
import {
  TableInfo,
  ColumnInfo,
  IndexInfo,
  IndexColumnInfo,
  ForeignKeyInfo,
  TableSchema,
} from '../types/Introspection';

export class SchemaIntrospector {
  constructor(private db: Queryable) {}

  /** List all user tables (excludes sqlite_internal tables). */
  async tables(): Promise<TableInfo[]> {
    const rows = await this.db.query<{ name: string; sql: string | null }>(
      `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    return rows.map((r) => ({ name: r.name, sql: r.sql ?? undefined }));
  }

  /** List all views. */
  async views(): Promise<TableInfo[]> {
    const rows = await this.db.query<{ name: string; sql: string | null }>(
      `SELECT name, sql FROM sqlite_master WHERE type='view' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    return rows.map((r) => ({ name: r.name, sql: r.sql ?? undefined }));
  }

  /** Get column metadata for a table. */
  async columns(tableName: string): Promise<ColumnInfo[]> {
    const rows = await this.db.query<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: any;
      pk: number;
    }>(`PRAGMA table_info("${tableName}")`);

    return rows.map((r) => ({
      cid: r.cid,
      name: r.name,
      type: r.type,
      notnull: Boolean(r.notnull),
      defaultValue: r.dflt_value,
      primaryKey: Boolean(r.pk),
    }));
  }

  /** Get index metadata for a table. */
  async indexes(tableName: string): Promise<IndexInfo[]> {
    const list = await this.db.query<{
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>(`PRAGMA index_list("${tableName}")`);

    const result: IndexInfo[] = [];
    for (const idx of list) {
      const cols = await this.indexColumns(idx.name);
      result.push({
        name: idx.name,
        unique: Boolean(idx.unique),
        origin: idx.origin,
        partial: Boolean(idx.partial),
        columns: cols,
      });
    }
    return result;
  }

  /** Get column details for a specific index. */
  async indexColumns(indexName: string): Promise<IndexColumnInfo[]> {
    // Try PRAGMA index_xinfo first (SQLite 3.16+), fallback to index_info
    try {
      const rows = await this.db.query<{
        seqno: number;
        cid: number;
        name: string;
        desc: number;
        coll: string;
        key: number;
      }>(`PRAGMA index_xinfo("${indexName}")`);

      return rows
        .filter((r) => r.key === 1)
        .map((r) => ({
          seqno: r.seqno,
          cid: r.cid,
          name: r.name,
          desc: Boolean(r.desc),
          coll: r.coll,
        }));
    } catch {
      const rows = await this.db.query<{
        seqno: number;
        cid: number;
        name: string;
      }>(`PRAGMA index_info("${indexName}")`);

      return rows.map((r) => ({
        seqno: r.seqno,
        cid: r.cid,
        name: r.name,
      }));
    }
  }

  /** Get foreign key metadata for a table. */
  async foreignKeys(tableName: string): Promise<ForeignKeyInfo[]> {
    const rows = await this.db.query<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
      match: string;
    }>(`PRAGMA foreign_key_list("${tableName}")`);

    return rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      table: r.table,
      from: r.from,
      to: r.to,
      onUpdate: r.on_update,
      onDelete: r.on_delete,
      match: r.match,
    }));
  }

  /** Get comprehensive schema info for a single table. */
  async table(tableName: string): Promise<TableSchema> {
    const [meta, columns, indexes, foreignKeys] = await Promise.all([
      this.db
        .query<{ sql: string | null }>(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
          [tableName]
        )
        .then((r) => r[0]),
      this.columns(tableName),
      this.indexes(tableName),
      this.foreignKeys(tableName),
    ]);

    return {
      name: tableName,
      sql: meta?.sql ?? undefined,
      columns,
      indexes,
      foreignKeys,
    };
  }

  /** Get schema info for all user tables. */
  async allTables(): Promise<TableSchema[]> {
    const tables = await this.tables();
    return Promise.all(tables.map((t) => this.table(t.name)));
  }
}
