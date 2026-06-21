import { Database } from './Database';
import { QueryBuilder } from './QueryBuilder';
import { BoltEntity, EntityAttachOptions } from './BoltEntity';
import { Relation } from './Relation';
import { BoltEvent, EventPayload } from './BoltEvent';
import { ValidationRuleSet, PaginatedResult, ValidationError, SyncPatch } from '../types';
import { ValidationFailedError } from '../errors';
import { rule } from './Validation';
import { Bolt } from '../Bolt';
import { checksum } from './ChangeTracker';

export { rule };

export type QueryScope<T> = (qb: QueryBuilder<T>) => QueryBuilder<T>;

export abstract class BoltModel<T extends Record<string, any>> {
  protected abstract table: string;
  protected dbGroup: string = 'default';
  protected primaryKey: string = 'id';
  protected allowedFields: string[] = [];
  protected returnType: 'array' | 'object' | 'entity' = 'array';

  protected softDelete: boolean = false;
  protected deletedField: string = 'deleted_at';

  protected timestamps: boolean = true;
  protected createdField: string = 'created_at';
  protected updatedField: string = 'updated_at';

  protected validationRules: ValidationRuleSet<T> = {};
  protected skipValidation: boolean = false;

  /** Toggle all callbacks on/off. */
  protected allowCallbacks: boolean = true;

  /** CI4-style callback arrays. Each entry is a function or the name of a method on this class. */
  protected beforeInsertCallbacks: Array<((data: Partial<T>) => Promise<Partial<T>>) | string> = [];
  protected afterInsertCallbacks: Array<((data: T, id: T[keyof T]) => Promise<void>) | string> = [];
  protected beforeUpdateCallbacks: Array<((data: Partial<T>, id?: T[keyof T]) => Promise<Partial<T>>) | string> = [];
  protected afterUpdateCallbacks: Array<((data: Partial<T>, affected: number) => Promise<void>) | string> = [];
  protected beforeFindCallbacks: Array<((builder: QueryBuilder<T>) => Promise<void> | void) | string> = [];
  protected afterFindCallbacks: Array<((result: T | T[] | null) => Promise<void> | void) | string> = [];
  protected beforeDeleteCallbacks: Array<((id: T[keyof T]) => Promise<boolean>) | string> = [];
  protected afterDeleteCallbacks: Array<((id: T[keyof T], purge: boolean) => Promise<void>) | string> = [];

  /** Named query scopes reusable across model queries. */
  protected scopes: Record<string, QueryScope<T>> = {};

  /** Global scopes auto-applied to every query. */
  protected globalScopes: Record<string, QueryScope<T>> = {};

  /** Eager-load relation definitions: `{ user: { type: 'belongsTo', table: 'users', foreignKey: 'user_id' } }` */
  protected relations: Record<string, { type: 'belongsTo' | 'hasMany' | 'hasOne'; table: string; foreignKey: string }> = {};

  private _errors: ValidationError[] = [];
  private _withDeleted: boolean = false;
  private _onlyDeleted: boolean = false;
  private _ignoredScopes: Set<string> = new Set();
  private _eagerLoad: string[] = [];

  /** Hydrated row data used by relation methods for lazy loading. */
  protected _data?: T;

  // Lazy DB resolution via static registry
  protected get db(): Database {
    return Bolt.connection(this.dbGroup);
  }

  /** Attach a row to this model instance for lazy-loaded relations. */
  hydrate(data: T): this {
    this._data = data;
    return this;
  }

  // ── Relations ──
  belongsTo<R extends Record<string, any>>(
    table: string,
    foreignKey: keyof T,
    row?: T
  ): Relation<R> {
    const parentRow = row ?? this._data;
    const fkValue = parentRow?.[foreignKey];
    return new Relation<R>(this.db, table, foreignKey as string, fkValue, 'belongsTo');
  }

  hasMany<R extends Record<string, any>>(
    table: string,
    foreignKey: string,
    row?: T
  ): Relation<R> {
    const parentRow = row ?? this._data;
    const pkValue = parentRow?.[this.primaryKey as keyof T];
    return new Relation<R>(this.db, table, foreignKey, pkValue, 'hasMany');
  }

  hasOne<R extends Record<string, any>>(
    table: string,
    foreignKey: string,
    row?: T
  ): Relation<R> {
    const parentRow = row ?? this._data;
    const pkValue = parentRow?.[this.primaryKey as keyof T];
    return new Relation<R>(this.db, table, foreignKey, pkValue, 'hasOne');
  }

  /** Wrap a raw row in a BoltEntity with dirty tracking and save capability. */
  entity(data: T): BoltEntity<T> {
    return new BoltEntity<T>(data).attach({
      primaryKey: this.primaryKey,
      save: (id, d) => this.update(id, d),
      db: this.db,
    });
  }

  /** Find a row and return it as a hydrated BoltEntity. */
  async findEntity(id: T[keyof T]): Promise<BoltEntity<T> | null> {
    const row = await this.find(id);
    return row ? this.entity(row) : null;
  }

  /** Find all rows and return them as BoltEntity instances. */
  async findAllEntities(where?: Partial<T> | Record<string, any>): Promise<BoltEntity<T>[]> {
    const rows = await this.findAll(where);
    return rows.map((r) => this.entity(r));
  }

  // ── Core CRUD ──
  async find(id: T[keyof T]): Promise<T | null> {
    const builder = this.query().where(this.primaryKey, id);
    await this.runCallbacks('beforeFind', builder);
    const row = await builder.first();
    if (row) await this.eagerLoadRelations([row]);
    await this.runCallbacks('afterFind', row);
    return row;
  }

  async findAll(where?: Partial<T> | Record<string, any>): Promise<T[]> {
    const builder = this.query();
    if (where) builder.where(where as any);
    await this.runCallbacks('beforeFind', builder);
    const rows = await builder.get();
    await this.eagerLoadRelations(rows);
    await this.runCallbacks('afterFind', rows);
    return rows;
  }

  async first(where?: Partial<T> | Record<string, any>): Promise<T | null> {
    const builder = this.query();
    if (where) builder.where(where as any);
    await this.runCallbacks('beforeFind', builder);
    const row = await builder.first();
    if (row) await this.eagerLoadRelations([row]);
    await this.runCallbacks('afterFind', row);
    return row;
  }

  async insert(data: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<T[keyof T] | false> {
    let payload: Partial<T> = { ...data as any };
    payload = this.filterAllowed(payload);
    payload = await this.runCallbacks('beforeInsert', payload) as Partial<T>;
    payload = await this.beforeInsert(payload);
    if (!(await this.validate(payload))) return false;
    payload = this.stampInsert(payload);

    const id = await this.query().insert(payload);
    await this.db.trackChange('insert', this.table, id as any, checksum(payload as Record<string, any>));
    const inserted = await this.find(id as any);
    if (inserted) {
      await this.afterInsert(inserted, id as any);
      await this.runCallbacks('afterInsert', inserted, id);
      await this.emitEvent(`${this.table}.created`, inserted);
    }
    return id as any;
  }

  async insertBatch(data: Partial<T>[], batchSize: number = 100): Promise<number> {
    const payload = data.map(row => {
      let item = this.filterAllowed({ ...row as any });
      item = this.stampInsert(item);
      return item;
    });
    return this.query().insertBatch(payload, batchSize);
  }

  async update(id: T[keyof T], data: Partial<T>): Promise<boolean> {
    let payload = this.filterAllowed(data);
    payload = await this.runCallbacks('beforeUpdate', payload, id) as Partial<T>;
    payload = await this.beforeUpdate(payload, id);
    if (!(await this.validate(payload))) return false;
    payload = this.stampUpdate(payload);

    const affected = await this.query()
      .where(this.primaryKey, id as any)
      .set(payload as any)
      .update();
    await this.db.trackChange('update', this.table, id as any, checksum(payload as Record<string, any>));
    await this.afterUpdate(payload, affected);
    await this.runCallbacks('afterUpdate', payload, affected);
    if (affected > 0) {
      const updated = await this.find(id as any);
      if (updated) await this.emitEvent(`${this.table}.updated`, updated);
    }
    return affected > 0;
  }

  async updateWhere(where: Record<string, any>, data: Partial<T>): Promise<number> {
    let payload = this.filterAllowed(data);
    payload = await this.beforeUpdate(payload);
    if (!(await this.validate(payload))) return 0;
    payload = this.stampUpdate(payload);

    return this.query().where(where).set(payload as any).update();
  }

  async save(data: Partial<T>): Promise<T[keyof T] | boolean> {
    const pk = this.primaryKey as keyof T;
    if (data[pk]) {
      const id = data[pk];
      const updateData = { ...data };
      delete (updateData as any)[pk];
      return this.update(id as any, updateData);
    }
    return this.insert(data as any);
  }

  async delete(id: T[keyof T], purge: boolean = false): Promise<boolean> {
    const cbOk = await this.runCallbacks('beforeDelete', id);
    if (cbOk === false) return false;
    const ok = await this.beforeDelete(id);
    if (!ok) return false;

    if (this.softDelete && !purge) {
      const affected = await this.query()
        .where(this.primaryKey, id as any)
        .set({ [this.deletedField]: new Date().toISOString() } as any)
        .update();
      await this.db.trackChange('update', this.table, id as any);
      await this.afterDelete(id, false);
      await this.runCallbacks('afterDelete', id, false);
      if (affected > 0) {
        const row = await this.find(id as any);
        if (row) await this.emitEvent(`${this.table}.updated`, row);
      }
      return affected > 0;
    } else {
      const affected = await this.query().where(this.primaryKey, id as any).delete();
      await this.db.trackChange('delete', this.table, id as any);
      await this.afterDelete(id, true);
      await this.runCallbacks('afterDelete', id, true);
      if (affected > 0) {
        await this.emitEvent(`${this.table}.deleted`, { [this.primaryKey]: id });
      }
      return affected > 0;
    }
  }

  async deleteWhere(where: Record<string, any>, purge: boolean = false): Promise<number> {
    if (this.softDelete && !purge) {
      return this.query().where(where).set({ [this.deletedField]: new Date().toISOString() } as any).update();
    }
    return this.query().where(where).delete();
  }

  // ── Query Scopes ──
  /**
   * Apply a reusable query scope.
   * Pass a function: `model.scope((qb) => qb.where('status', 'active')).get()`
   * Or a registered name: `model.scope('active').get()`
   */
  scope(scopeOrName: QueryScope<T> | string): QueryBuilder<T> {
    const qb = this.query();
    if (typeof scopeOrName === 'string') {
      const fn = this.scopes[scopeOrName];
      if (!fn) throw new Error(`Scope [${scopeOrName}] not defined on ${this.table}`);
      return fn(qb);
    }
    return scopeOrName(qb);
  }

  /** Ignore a global scope for the next query. */
  withoutScope(name: string): this {
    this._ignoredScopes.add(name);
    return this;
  }

  /** Ignore all global scopes for the next query. */
  withoutScopes(): this {
    this._ignoredScopes.add('*');
    return this;
  }

  /** Eager load relations for the next query (batch fetch to avoid N+1). */
  with(...relations: string[]): this {
    this._eagerLoad.push(...relations);
    return this;
  }

  // ── Builder Access ──
  query(): QueryBuilder<T> {
    const builder = this.db.table<T>(this.table);

    // Apply global scopes
    const skipAll = this._ignoredScopes.has('*');
    if (!skipAll) {
      for (const [name, scope] of Object.entries(this.globalScopes)) {
        if (!this._ignoredScopes.has(name)) {
          scope(builder);
        }
      }
    }

    // Legacy soft-delete logic (kept for backward compatibility)
    if (this.softDelete && !this._withDeleted && !this._onlyDeleted) {
      builder.whereNull(this.deletedField);
    }
    if (this.softDelete && this._onlyDeleted) {
      builder.whereNotNull(this.deletedField);
    }

    this.resetIgnoredScopes();
    this.resetModifiers();
    return builder;
  }

  // ── Result Modifiers ──
  withDeleted(): this {
    this._withDeleted = true;
    return this;
  }
  onlyDeleted(): this {
    this._onlyDeleted = true;
    return this;
  }

  // ── Batch & Pagination ──
  async chunk(size: number, callback: (rows: T[]) => Promise<void> | void): Promise<void> {
    // Build the base query (scopes + soft-delete) once, then clone per page so
    // query()'s per-call modifier reset doesn't drop them on later iterations.
    const base = this.query();
    let offset = 0;
    while (true) {
      const rows = await base.clone().limit(size).offset(offset).get();
      if (rows.length === 0) break;
      await callback(rows);
      offset += size;
    }
  }

  async paginate(page: number = 1, perPage: number = 20): Promise<PaginatedResult<T>> {
    // Build the base query once so modifiers/scopes apply to both the count and
    // the data query (query() resets modifiers after each call).
    const base = this.query();
    const total = await base.clone().countAllResults();
    const data = await base.clone().page(page, perPage).get();
    return {
      data,
      pagination: {
        page,
        perPage,
        total,
        lastPage: Math.ceil(total / perPage)
      }
    };
  }

  // ── Aggregation ──
  async countAll(): Promise<number> {
    return this.query().countAllResults();
  }
  async countAllResults(where?: Record<string, any>): Promise<number> {
    const builder = this.query();
    if (where) builder.where(where);
    return builder.countAllResults();
  }

  // ── Validation ──
  errors(): ValidationError[] {
    return this._errors;
  }

  /**
   * Validate `data` against `validationRules`.
   * CI4-style contract: returns `true` when valid, `false` otherwise.
   * On failure, collected errors are available via `errors()`; nothing is thrown.
   * Use `validateOrFail()` if you prefer an exception-based flow.
   */
  async validate(data: Partial<T>): Promise<boolean> {
    if (this.skipValidation) return true;
    this._errors = [];

    for (const [field, rules] of Object.entries(this.validationRules)) {
      const value = data[field as keyof T];
      for (const rule of rules || []) {
        const ok = await Promise.resolve(rule.test(value, this.db));
        if (!ok) {
          this._errors.push({
            field,
            rule: rule.name,
            message: rule.message || `${String(field)} failed ${rule.name}`
          });
        }
      }
    }

    return this._errors.length === 0;
  }

  /** Validate `data`; throws `ValidationFailedError` with `errors()` when invalid. */
  async validateOrFail(data: Partial<T>): Promise<true> {
    if (await this.validate(data)) return true;
    throw new ValidationFailedError(this._errors);
  }

  // ── Callbacks ──
  // ── Callbacks ──
  protected async beforeInsert(data: Partial<T>): Promise<Partial<T>> { return data; }
  protected async afterInsert(data: T, id: T[keyof T]): Promise<void> {}
  protected async beforeUpdate(data: Partial<T>, id?: T[keyof T]): Promise<Partial<T>> { return data; }
  protected async afterUpdate(data: Partial<T>, affected: number): Promise<void> {}
  protected async beforeDelete(id: T[keyof T]): Promise<boolean> { return true; }
  protected async afterDelete(id: T[keyof T], purge: boolean): Promise<void> {}

  // ── Sync Hooks ──
  protected async beforeSync(data: Partial<T>, direction: 'push' | 'pull'): Promise<Partial<T>> { return data; }
  protected async afterSync(data: Partial<T>, direction: 'push' | 'pull'): Promise<void> {}
  protected async onConflict(local: Partial<T>, remote: Partial<T>): Promise<Partial<T>> { return local; }

  // ── Event Helpers ──
  protected async emitEvent(event: string, data: any): Promise<void> {
    await BoltEvent.emit(event, {
      event,
      table: this.table,
      data,
      timestamp: Date.now(),
    });
  }

  // ── Callback Runner ──
  private async runCallbacks(
    event: 'beforeInsert' | 'afterInsert' | 'beforeUpdate' | 'afterUpdate' | 'beforeFind' | 'afterFind' | 'beforeDelete' | 'afterDelete',
    ...args: any[]
  ): Promise<any> {
    if (!this.allowCallbacks) return event === 'beforeDelete' ? true : args[0];
    const callbacks = (this as any)[`${event}Callbacks`] as Array<(...a: any[]) => any | string>;
    let result = args[0];
    for (const cb of callbacks) {
      const fn = typeof cb === 'string' ? (this as any)[cb].bind(this) : cb;
      if (typeof fn !== 'function') continue;
      const r = await Promise.resolve(fn(...args));
      if (event === 'beforeInsert' || event === 'beforeUpdate') {
        if (r !== undefined) result = r;
      } else if (event === 'beforeDelete') {
        if (r === false) return false;
      }
    }
    return result;
  }

  // ── Helpers ──
  private filterAllowed(data: Partial<T>): Partial<T> {
    if (!this.allowedFields || this.allowedFields.length === 0) return data;
    const filtered: Partial<T> = {};
    for (const key of this.allowedFields) {
      if (key in data) {
        (filtered as any)[key] = (data as any)[key];
      }
    }
    return filtered;
  }

  private stampInsert(data: Partial<T>): Partial<T> {
    if (!this.timestamps) return data;
    const now = new Date().toISOString();
    return { ...data, [this.createdField]: now, [this.updatedField]: now } as Partial<T>;
  }

  private stampUpdate(data: Partial<T>): Partial<T> {
    if (!this.timestamps) return data;
    const now = new Date().toISOString();
    return { ...data, [this.updatedField]: now } as Partial<T>;
  }

  private resetModifiers(): void {
    this._withDeleted = false;
    this._onlyDeleted = false;
  }

  private resetIgnoredScopes(): void {
    this._ignoredScopes.clear();
  }

  /** Batch-fetch related rows and attach them to the primary result set. */
  private async eagerLoadRelations(rows: T[]): Promise<void> {
    if (rows.length === 0 || this._eagerLoad.length === 0) {
      this._eagerLoad = [];
      return;
    }

    for (const name of this._eagerLoad) {
      const def = this.relations[name];
      if (!def) continue;

      if (def.type === 'belongsTo') {
        const ids = [...new Set(rows.map((r) => (r as any)[def.foreignKey]).filter(Boolean))];
        if (ids.length === 0) continue;
        const placeholders = ids.map(() => '?').join(',');
        const related = await this.db.query<Record<string, any>>(
          `SELECT * FROM "${def.table}" WHERE "id" IN (${placeholders})`,
          ids
        );
        const map = new Map(related.map((r) => [r.id, r]));
        for (const row of rows) {
          (row as any)[name] = map.get((row as any)[def.foreignKey]) ?? null;
        }
      } else if (def.type === 'hasMany') {
        const ids = [...new Set(rows.map((r) => (r as any)[this.primaryKey]).filter(Boolean))];
        if (ids.length === 0) continue;
        const placeholders = ids.map(() => '?').join(',');
        const related = await this.db.query<Record<string, any>>(
          `SELECT * FROM "${def.table}" WHERE "${def.foreignKey}" IN (${placeholders})`,
          ids
        );
        const map = new Map<number, Record<string, any>[]>();
        for (const r of related) {
          const key = (r as any)[def.foreignKey];
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(r);
        }
        for (const row of rows) {
          (row as any)[name] = map.get((row as any)[this.primaryKey]) ?? [];
        }
      } else if (def.type === 'hasOne') {
        const ids = [...new Set(rows.map((r) => (r as any)[this.primaryKey]).filter(Boolean))];
        if (ids.length === 0) continue;
        const placeholders = ids.map(() => '?').join(',');
        const related = await this.db.query<Record<string, any>>(
          `SELECT * FROM "${def.table}" WHERE "${def.foreignKey}" IN (${placeholders})`,
          ids
        );
        const map = new Map(related.map((r) => [(r as any)[def.foreignKey], r]));
        for (const row of rows) {
          (row as any)[name] = map.get((row as any)[this.primaryKey]) ?? null;
        }
      }
    }

    this._eagerLoad = [];
  }
}