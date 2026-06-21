import { Queryable } from '../types';

export class TableDefinition {
  private columns: (string | ColumnBuilder)[] = [];
  private indexes: string[] = [];

  increments(name: string): this {
    this.columns.push(`"${name}" INTEGER PRIMARY KEY AUTOINCREMENT`);
    return this;
  }
  string(name: string, length: number = 255): ColumnBuilder {
    return this.addColumn(name, `VARCHAR(${length})`);
  }
  text(name: string): ColumnBuilder {
    return this.addColumn(name, `TEXT`);
  }
  integer(name: string): ColumnBuilder {
    return this.addColumn(name, `INTEGER`);
  }
  decimal(name: string, precision: number = 10, scale: number = 2): ColumnBuilder {
    return this.addColumn(name, `DECIMAL(${precision}, ${scale})`);
  }
  boolean(name: string): ColumnBuilder {
    return this.addColumn(name, `INTEGER`); // SQLite boolean as 0/1
  }
  json(name: string): ColumnBuilder {
    return this.addColumn(name, `TEXT`); // Store JSON as text
  }
  enum(name: string, values: string[]): ColumnBuilder {
    return this.addColumn(name, `TEXT`).check(`"${name}" IN (${values.map(v => `'${v}'`).join(', ')})`);
  }
  timestamps(): this {
    this.columns.push(`"created_at" TEXT`);
    this.columns.push(`"updated_at" TEXT`);
    return this;
  }
  softDeletes(): this {
    this.columns.push(`"deleted_at" TEXT`);
    return this;
  }

  private addColumn(name: string, type: string): ColumnBuilder {
    const builder = new ColumnBuilder(name, type);
    this.columns.push(builder);
    return builder;
  }

  compileCreate(table: string): string {
    return `CREATE TABLE IF NOT EXISTS "${table}" (${this.columns.join(', ')})`;
  }
}

export class ColumnBuilder {
  private defs: string[] = [];
  private _ref?: string;
  constructor(private name: string, private type: string) {}
  notNullable(): this { this.defs.push('NOT NULL'); return this; }
  nullable(): this { this.defs.push('NULL'); return this; }
  default(value: any): this { this.defs.push(`DEFAULT ${typeof value === 'string' ? `'${value}'` : value}`); return this; }
  unique(): this { this.defs.push('UNIQUE'); return this; }
  primary(): this { this.defs.push('PRIMARY KEY'); return this; }
  check(expression: string): this { this.defs.push(`CHECK(${expression})`); return this; }
  index(): this { /* deferred to v1.1 */ return this; }
  references(column: string): ReferenceBuilder {
    return new ReferenceBuilder(this, column);
  }
  setRef(ref: string): this {
    this._ref = ref;
    return this;
  }
  toString(): string {
    let base = `"${this.name}" ${this.type} ${this.defs.join(' ')}`.trim();
    if (this._ref) base += ` ${this._ref}`;
    return base;
  }
}

export class ReferenceBuilder {
  constructor(private col: ColumnBuilder, private refColumn: string) {}
  on(table: string): ColumnBuilder {
    this.col.setRef(`REFERENCES "${table}"("${this.refColumn}")`);
    return this.col;
  }
}

export class SchemaBuilder {
  constructor(private db: Queryable) {}
  async createTable(name: string, callback: (table: TableDefinition) => void): Promise<void> {
    const def = new TableDefinition();
    callback(def);
    await this.db.execute(def.compileCreate(name));
  }
  async dropTable(name: string): Promise<void> {
    await this.db.execute(`DROP TABLE IF EXISTS "${name}"`);
  }
  async alterTable(name: string, callback: (table: TableAlter) => void): Promise<void> {
    const def = new TableAlter(name);
    callback(def);
    for (const sql of def.compile()) {
      await this.db.execute(sql);
    }
  }
}

export class TableAlter {
  private ops: string[] = [];
  constructor(private table: string) {}
  addColumn(name: string, type: string): this {
    this.ops.push(`ALTER TABLE "${this.table}" ADD COLUMN "${name}" ${type}`);
    return this;
  }
  dropColumn(name: string): this {
    // SQLite limited; use table recreate for full alter in production
    this.ops.push(`ALTER TABLE "${this.table}" DROP COLUMN "${name}"`);
    return this;
  }
  compile(): string[] { return this.ops; }
}
