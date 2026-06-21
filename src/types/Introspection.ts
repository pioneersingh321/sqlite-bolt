export interface TableInfo {
  name: string;
  sql?: string;
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  defaultValue: any;
  primaryKey: boolean;
  hidden?: number;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: IndexColumnInfo[];
}

export interface IndexColumnInfo {
  seqno: number;
  cid: number;
  name: string;
  desc?: boolean;
  coll?: string;
  key?: boolean;
}

export interface ForeignKeyInfo {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
  match: string;
}

export interface TableSchema {
  name: string;
  sql?: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}
