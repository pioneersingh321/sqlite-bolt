import { Queryable, WhereClause, JoinClause, ExecuteResult, QueryPlanRow } from '../types';
import { QueryError } from '../errors';
import { sanitizeIdentifier } from './Sanitizer';

export type QueryScope<T> = (qb: QueryBuilder<T>) => QueryBuilder<T>;

export class QueryBuilder<T = Record<string, any>> {
  private _select: string[] = [];
  private _where: WhereClause[] = [];
  private _join: JoinClause[] = [];
  private _orderBy: string[] = [];
  private _groupBy: string[] = [];
  private _having: WhereClause[] = [];
  private _limit?: number;
  private _offset?: number;
  private _distinct: boolean = false;
  private _set: Record<string, any> = {};
  private _mapper?: (row: T) => any;

  constructor(private db: Queryable, private _table: string) {
    this._table = sanitizeIdentifier(this._table);
  }

  // ── Selection ──
  select(...fields: string[]): this {
    this._select.push(...fields);
    return this;
  }
  selectMax(field: string, alias?: string): this {
    this._select.push(`MAX("${sanitizeIdentifier(field)}")${alias ? ` AS "${sanitizeIdentifier(alias)}"` : ''}`);
    return this;
  }
  selectMin(field: string, alias?: string): this {
    this._select.push(`MIN("${sanitizeIdentifier(field)}")${alias ? ` AS "${sanitizeIdentifier(alias)}"` : ''}`);
    return this;
  }
  selectAvg(field: string, alias?: string): this {
    this._select.push(`AVG("${sanitizeIdentifier(field)}")${alias ? ` AS "${sanitizeIdentifier(alias)}"` : ''}`);
    return this;
  }
  selectSum(field: string, alias?: string): this {
    this._select.push(`SUM("${sanitizeIdentifier(field)}")${alias ? ` AS "${sanitizeIdentifier(alias)}"` : ''}`);
    return this;
  }
  distinct(): this {
    this._distinct = true;
    return this;
  }

  /** Post-process each result row through a mapper function. */
  map<R>(fn: (row: T) => R): QueryBuilder<R> {
    const cloned = this.clone() as unknown as QueryBuilder<R>;
    (cloned as any)._mapper = fn;
    return cloned;
  }

  /** Apply a reusable scope function directly to the query builder. */
  scope(fn: QueryScope<T>): this {
    fn(this);
    return this;
  }

  // ── From ──
  from(table: string): this {
    this._table = sanitizeIdentifier(table);
    return this;
  }
  table(table: string): this {
    return this.from(table);
  }

  // ── Joins ──
  join(table: string, on: string, type: string = 'INNER'): this {
    this._join.push({ table, on, type });
    return this;
  }
  leftJoin(table: string, on: string): this { return this.join(table, on, 'LEFT'); }
  rightJoin(table: string, on: string): this { return this.join(table, on, 'RIGHT'); }
  innerJoin(table: string, on: string): this { return this.join(table, on, 'INNER'); }

  // ── Where ──
  where(field: string, value: any): this;
  where(field: string, operator: string, value: any): this;
  where(conditions: Record<string, any>): this;
  where(...args: any[]): this {
    if (args.length === 1 && typeof args[0] === 'object') {
      for (const [k, v] of Object.entries(args[0])) {
        this._where.push({ type: 'and', field: k, operator: '=', value: v });
      }
    } else if (args.length === 2) {
      this._where.push({ type: 'and', field: args[0], operator: '=', value: args[1] });
    } else if (args.length === 3) {
      this._where.push({ type: 'and', field: args[0], operator: args[1], value: args[2] });
    }
    return this;
  }

  orWhere(field: string, value: any): this;
  orWhere(field: string, operator: string, value: any): this;
  orWhere(...args: any[]): this {
    if (args.length === 2) {
      this._where.push({ type: 'or', field: args[0], operator: '=', value: args[1] });
    } else if (args.length === 3) {
      this._where.push({ type: 'or', field: args[0], operator: args[1], value: args[2] });
    }
    return this;
  }

  whereIn(field: string, values: any[]): this {
    this._where.push({ type: 'and', field, operator: 'IN', value: values });
    return this;
  }
  whereNotIn(field: string, values: any[]): this {
    this._where.push({ type: 'and', field, operator: 'NOT IN', value: values });
    return this;
  }
  whereLike(field: string, pattern: string): this {
    this._where.push({ type: 'and', field, operator: 'LIKE', value: pattern });
    return this;
  }
  orLike(field: string, pattern: string): this {
    this._where.push({ type: 'or', field, operator: 'LIKE', value: pattern });
    return this;
  }
  whereNotLike(field: string, pattern: string): this {
    this._where.push({ type: 'and', field, operator: 'NOT LIKE', value: pattern });
    return this;
  }
  whereNull(field: string): this {
    this._where.push({ type: 'and', field, operator: 'IS NULL' });
    return this;
  }
  whereNotNull(field: string): this {
    this._where.push({ type: 'and', field, operator: 'IS NOT NULL' });
    return this;
  }
  whereBetween(field: string, range: [any, any]): this {
    this._where.push({ type: 'and', field, operator: 'BETWEEN', value: range });
    return this;
  }
  whereNotBetween(field: string, range: [any, any]): this {
    this._where.push({ type: 'and', field, operator: 'NOT BETWEEN', value: range });
    return this;
  }
  whereRaw(sql: string, bindings?: any[]): this {
    this._where.push({ type: 'and', field: sql, operator: 'RAW', raw: true, rawBindings: bindings });
    return this;
  }

  whereInSubquery(field: string, callback: (qb: QueryBuilder<any>) => void): this {
    const { sql, params } = this.buildSubquery(callback);
    this._where.push({ type: 'and', field, operator: 'IN SUBQUERY', subquery: sql, subqueryParams: params });
    return this;
  }

  whereNotInSubquery(field: string, callback: (qb: QueryBuilder<any>) => void): this {
    const { sql, params } = this.buildSubquery(callback);
    this._where.push({ type: 'and', field, operator: 'NOT IN SUBQUERY', subquery: sql, subqueryParams: params });
    return this;
  }

  whereExists(callback: (qb: QueryBuilder<any>) => void): this {
    const { sql, params } = this.buildSubquery(callback);
    this._where.push({ type: 'and', field: '', operator: 'EXISTS', subquery: sql, subqueryParams: params });
    return this;
  }

  whereNotExists(callback: (qb: QueryBuilder<any>) => void): this {
    const { sql, params } = this.buildSubquery(callback);
    this._where.push({ type: 'and', field: '', operator: 'NOT EXISTS', subquery: sql, subqueryParams: params });
    return this;
  }

  // ── Group / Having / Order ──
  groupBy(...fields: string[]): this {
    this._groupBy.push(...fields.map(f => `"${sanitizeIdentifier(f)}"`));
    return this;
  }
  having(field: string, value: any): this;
  having(field: string, operator: string, value: any): this;
  having(...args: any[]): this {
    if (args.length === 2) {
      this._having.push({ type: 'and', field: args[0], operator: '=', value: args[1] });
    } else if (args.length === 3) {
      this._having.push({ type: 'and', field: args[0], operator: args[1], value: args[2] });
    }
    return this;
  }
  orHaving(field: string, value: any): this {
    this._having.push({ type: 'or', field, operator: '=', value });
    return this;
  }
  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this._orderBy.push(`"${sanitizeIdentifier(field)}" ${direction}`);
    return this;
  }
  orderByRaw(sql: string): this {
    this._orderBy.push(sql);
    return this;
  }

  // ── Pagination ──
  limit(n: number): this {
    this._limit = n;
    return this;
  }
  offset(n: number): this {
    this._offset = n;
    return this;
  }
  page(page: number, perPage: number): this {
    this._limit = perPage;
    this._offset = (page - 1) * perPage;
    return this;
  }

  // ── Insert / Update / Delete setters ──
  insert(data: Record<string, any>): Promise<number | string> {
    const { sql, params } = this.compileInsert(data);
    return this.db.execute(sql, params).then(r => r.lastId ?? r.changes);
  }
  async insertBatch(data: Record<string, any>[], batchSize: number = 100): Promise<number> {
    if (data.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < data.length; i += batchSize) {
      const chunk = data.slice(i, i + batchSize);
      const { sql, params } = this.compileInsertBatch(chunk);
      await this.runInTransaction(async () => {
        const result = await this.db.execute(sql, params);
        total += result.changes;
      });
    }
    return total;
  }

  async updateBatch(
    data: Record<string, any>[],
    whereField: string,
    batchSize: number = 100
  ): Promise<number> {
    const safeWhere = sanitizeIdentifier(whereField);
    if (data.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < data.length; i += batchSize) {
      const chunk = data.slice(i, i + batchSize);
      await this.runInTransaction(async () => {
        for (const row of chunk) {
          const whereValue = row[safeWhere];
          const payload = { ...row };
          delete payload[safeWhere];
          const fields = Object.keys(payload).map(sanitizeIdentifier);
          const values = Object.values(payload);
          const setClause = fields.map(f => `"${f}" = ?`).join(', ');
          const sql = `UPDATE "${this._table}" SET ${setClause} WHERE "${safeWhere}" = ?`;
          const result = await this.db.execute(sql, [...values, whereValue]);
          total += result.changes;
        }
      });
    }
    return total;
  }

  set(field: string, value: any): this;
  set(data: Record<string, any>): this;
  set(...args: any[]): this {
    if (args.length === 2) {
      this._set[args[0]] = args[1];
    } else if (args.length === 1 && typeof args[0] === 'object') {
      Object.assign(this._set, args[0]);
    }
    return this;
  }

  update(where?: Record<string, any>): Promise<number> {
    if (where) this.where(where);
    const { sql, params } = this.compileUpdate();
    return this.db.execute(sql, params).then(r => r.changes);
  }

  delete(where?: Record<string, any>): Promise<number> {
    if (where) this.where(where);
    const { sql, params } = this.compileDelete();
    return this.db.execute(sql, params).then(r => r.changes);
  }

  replace(data: Record<string, any>): Promise<number> {
    const fields = Object.keys(data).map(sanitizeIdentifier);
    const values = Object.values(data);
    const sql = `REPLACE INTO "${this._table}" (${fields.map(f => `"${f}"`).join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`;
    return this.db.execute(sql, values).then(r => r.changes);
  }

  upsert(data: Record<string, any>, uniqueField: string): Promise<number> {
    const safeUnique = sanitizeIdentifier(uniqueField);
    const fields = Object.keys(data).map(sanitizeIdentifier);
    const values = Object.values(data);
    const updates = fields.filter(f => f !== safeUnique).map(f => `"${f}" = excluded."${f}"`).join(', ');
    const sql = `INSERT INTO "${this._table}" (${fields.map(f => `"${f}"`).join(', ')}) VALUES (${fields.map(() => '?').join(', ')}) ON CONFLICT("${safeUnique}") DO UPDATE SET ${updates}`;
    return this.db.execute(sql, values).then(r => r.changes);
  }

  // ── Execution ──
  explain(): Promise<QueryPlanRow[]> {
    const { sql, params } = this.compileSelect();
    return this.db.query<QueryPlanRow>(`EXPLAIN QUERY PLAN ${sql}`, params);
  }

  get(): Promise<T[]> {
    const { sql, params } = this.compileSelect();
    return this.db.query<T>(sql, params).then(rows => this._mapper ? rows.map(this._mapper) : rows);
  }
  getWhere(where: Record<string, any>): Promise<T[]> {
    return this.where(where).get();
  }
  first(): Promise<T | null> {
    this._limit = 1;
    return this.get().then(rows => rows[0] ?? null);
  }
  countAllResults(): Promise<number> {
    const cloned = this.clone();
    cloned._select = ['COUNT(*) as count'];
    return cloned.first().then(row => (row as any)?.count ?? 0);
  }

  // ── Debug ──
  getCompiledSelect(): string {
    return this.compileSelect().sql;
  }
  getCompiledInsert(data: Record<string, any>): string {
    return this.compileInsert(data).sql;
  }
  getCompiledUpdate(): string {
    return this.compileUpdate().sql;
  }
  getCompiledDelete(): string {
    return this.compileDelete().sql;
  }

  reset(): this {
    this._select = [];
    this._where = [];
    this._join = [];
    this._orderBy = [];
    this._groupBy = [];
    this._having = [];
    this._limit = undefined;
    this._offset = undefined;
    this._distinct = false;
    this._set = {};
    this._mapper = undefined;
    return this;
  }

  clone(): QueryBuilder<T> {
    const cloned = new QueryBuilder<T>(this.db, this._table);
    cloned._select = [...this._select];
    cloned._where = [...this._where];
    cloned._join = [...this._join];
    cloned._orderBy = [...this._orderBy];
    cloned._groupBy = [...this._groupBy];
    cloned._having = [...this._having];
    cloned._limit = this._limit;
    cloned._offset = this._offset;
    cloned._distinct = this._distinct;
    cloned._set = { ...this._set };
    cloned._mapper = this._mapper;
    return cloned;
  }

  private async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.db.execute('BEGIN TRANSACTION');
    try {
      const result = await fn();
      await this.db.execute('COMMIT');
      return result;
    } catch (e) {
      await this.db.execute('ROLLBACK');
      throw e;
    }
  }

  private compileInsertBatch(data: Record<string, any>[]): { sql: string; params: any[] } {
    const fields = Object.keys(data[0]).map(sanitizeIdentifier);
    const placeholders = data
      .map(() => `(${fields.map(() => '?').join(', ')})`)
      .join(', ');
    const params = data.flatMap(row => fields.map(f => row[f]));
    const sql = `INSERT INTO "${this._table}" (${fields.map(f => `"${f}"`).join(', ')}) VALUES ${placeholders}`;
    return { sql, params };
  }

  // ── Compilers ──
  private compileSelect(): { sql: string; params: any[] } {
    const distinct = this._distinct ? 'DISTINCT ' : '';
    const fields = this._select.length > 0 ? this._select.join(', ') : '*';
    const joins = this._join.map(j => `${j.type} JOIN "${j.table}" ON ${j.on}`).join(' ');
    const where = this.compileClauses(this._where);
    const groupBy = this._groupBy.length > 0 ? `GROUP BY ${this._groupBy.join(', ')}` : '';
    const having = this.compileClauses(this._having, true);
    const orderBy = this._orderBy.length > 0 ? `ORDER BY ${this._orderBy.join(', ')}` : '';
    const limit = this._limit !== undefined ? `LIMIT ${this._limit}` : '';
    const offset = this._offset !== undefined ? `OFFSET ${this._offset}` : '';

    const sql = [
      `SELECT ${distinct}${fields}`,
      `FROM "${this._table}"`,
      joins,
      where.sql,
      groupBy,
      having.sql,
      orderBy,
      limit,
      offset
    ].filter(Boolean).join(' ');

    return { sql, params: [...where.params, ...having.params] };
  }

  private compileInsert(data: Record<string, any>): { sql: string; params: any[] } {
    const fields = Object.keys(data).map(sanitizeIdentifier);
    const values = Object.values(data);
    const sql = `INSERT INTO "${this._table}" (${fields.map(f => `"${f}"`).join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`;
    return { sql, params: values };
  }

  private compileUpdate(): { sql: string; params: any[] } {
    const setFields = Object.keys(this._set).map(sanitizeIdentifier);
    if (setFields.length === 0) throw new QueryError('No data to update. Use set() first.');
    const setClause = setFields.map(f => `"${f}" = ?`).join(', ');
    const setParams = Object.values(this._set);
    const where = this.compileClauses(this._where);
    const sql = [`UPDATE "${this._table}" SET ${setClause}`, where.sql].filter(Boolean).join(' ');
    return { sql, params: [...setParams, ...where.params] };
  }

  private compileDelete(): { sql: string; params: any[] } {
    const where = this.compileClauses(this._where);
    const sql = [`DELETE FROM "${this._table}"`, where.sql].filter(Boolean).join(' ');
    return { sql, params: where.params };
  }

  private buildSubquery(callback: (qb: QueryBuilder<any>) => void): { sql: string; params: any[] } {
    const qb = new QueryBuilder<any>(this.db, '');
    callback(qb);
    return qb.compileSelect();
  }

  private compileClauses(clauses: WhereClause[], isHaving: boolean = false): { sql: string; params: any[] } {
    if (clauses.length === 0) return { sql: '', params: [] };
    const parts: string[] = [];
    const params: any[] = [];

    for (const c of clauses) {
      const prefix = c.type === 'or' ? 'OR' : 'AND';
      if (c.raw) {
        parts.push(`${prefix} (${c.field})`);
        if (c.rawBindings) params.push(...c.rawBindings);
      } else if (c.operator === 'IN' || c.operator === 'NOT IN') {
        const ph = (c.value as any[]).map(() => '?').join(', ');
        parts.push(`${prefix} "${sanitizeIdentifier(c.field)}" ${c.operator} (${ph})`);
        params.push(...c.value);
      } else if (c.operator === 'BETWEEN' || c.operator === 'NOT BETWEEN') {
        parts.push(`${prefix} "${sanitizeIdentifier(c.field)}" ${c.operator} ? AND ?`);
        params.push(c.value[0], c.value[1]);
      } else if (c.operator === 'IS NULL' || c.operator === 'IS NOT NULL') {
        parts.push(`${prefix} "${sanitizeIdentifier(c.field)}" ${c.operator}`);
      } else if (c.operator === 'IN SUBQUERY' || c.operator === 'NOT IN SUBQUERY') {
        parts.push(`${prefix} "${sanitizeIdentifier(c.field)}" ${c.operator === 'IN SUBQUERY' ? 'IN' : 'NOT IN'} (${c.subquery})`);
        if (c.subqueryParams) params.push(...c.subqueryParams);
      } else if (c.operator === 'EXISTS' || c.operator === 'NOT EXISTS') {
        parts.push(`${prefix} ${c.operator} (${c.subquery})`);
        if (c.subqueryParams) params.push(...c.subqueryParams);
      } else {
        parts.push(`${prefix} "${sanitizeIdentifier(c.field)}" ${c.operator} ?`);
        params.push(c.value);
      }
    }

    let sql = parts.join(' ');
    if (sql.startsWith('AND ')) sql = sql.slice(4);
    if (sql.startsWith('OR ')) sql = sql.slice(3);

    return { sql: `${isHaving ? 'HAVING' : 'WHERE'} ${sql}`, params };
  }
}