import { Database } from './Database';
import { Relation } from './Relation';
import { Queryable } from '../types';

export type EntitySaver<T> = (id: any, data: Partial<T>) => Promise<boolean>;

export interface EntityAttachOptions<T> {
  primaryKey?: string;
  save: EntitySaver<T>;
  db?: Queryable;
}

export class BoltEntity<T extends Record<string, any>> {
  private original: T;
  private dirty = new Set<string>();
  private saver?: EntitySaver<T>;
  private pk: string = 'id';
  private db?: Queryable;

  /** Computed property registry — override in subclass. */
  protected computed: Record<string, (data: T) => any> = {};

  constructor(protected data: T) {
    this.original = { ...data };
  }

  /** Attach a saver so `.save()` can persist changes. */
  attach(options: EntityAttachOptions<T>): this {
    this.pk = options.primaryKey ?? 'id';
    this.saver = options.save;
    this.db = options.db;
    return this;
  }

  // ── Property Access ──

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    if (this.data[key] !== value) {
      this.dirty.add(String(key));
      this.data[key] = value;
    }
  }

  /** Read a computed property. */
  getComputed(key: string): any {
    const fn = this.computed[key];
    return fn ? fn(this.data) : undefined;
  }

  // ── Dirty Tracking ──

  /** Check if any (or a specific) field has changed. */
  isDirty(field?: keyof T | string): boolean {
    if (field !== undefined) return this.dirty.has(String(field));
    return this.dirty.size > 0;
  }

  /** Get only the changed fields. */
  getDirty(): Partial<T> {
    const result: Partial<T> = {};
    for (const key of this.dirty) {
      (result as any)[key] = this.data[key as keyof T];
    }
    return result;
  }

  /** Get the original value of a field. */
  getOriginal<K extends keyof T>(field: K): T[K] {
    return this.original[field];
  }

  /** Revert changed field(s) to original values. */
  revert(field?: keyof T | string): void {
    if (field !== undefined) {
      const f = String(field);
      if (this.dirty.has(f)) {
        (this.data as any)[f] = this.original[f as keyof T];
        this.dirty.delete(f);
      }
    } else {
      this.data = { ...this.original };
      this.dirty.clear();
    }
  }

  // ── Persistence ──

  /** Save dirty fields via the attached saver. */
  async save(): Promise<boolean> {
    if (!this.saver) {
      throw new Error('Entity has no saver attached. Call attach() or use model.entity().');
    }
    if (!this.isDirty()) return false;

    const id = this.data[this.pk as keyof T];
    const dirty = this.getDirty();
    delete (dirty as any)[this.pk];

    const ok = await this.saver(id, dirty);
    if (ok) {
      this.original = { ...this.data };
      this.dirty.clear();
    }
    return ok;
  }

  // ── Lazy-loaded Relations ──

  belongsTo<R extends Record<string, any>>(
    table: string,
    foreignKey: keyof T
  ): Relation<R> {
    if (!this.db) throw new Error('Entity has no db attached. Call attach() with db or use model.entity().');
    const fkValue = this.data[foreignKey];
    return new Relation<R>(this.db as Database, table, foreignKey as string, fkValue, 'belongsTo');
  }

  hasMany<R extends Record<string, any>>(
    table: string,
    foreignKey: string
  ): Relation<R> {
    if (!this.db) throw new Error('Entity has no db attached. Call attach() with db or use model.entity().');
    const pkValue = this.data[this.pk as keyof T];
    return new Relation<R>(this.db as Database, table, foreignKey, pkValue, 'hasMany');
  }

  hasOne<R extends Record<string, any>>(
    table: string,
    foreignKey: string
  ): Relation<R> {
    if (!this.db) throw new Error('Entity has no db attached. Call attach() with db or use model.entity().');
    const pkValue = this.data[this.pk as keyof T];
    return new Relation<R>(this.db as Database, table, foreignKey, pkValue, 'hasOne');
  }

  toJSON(): T {
    return { ...this.data };
  }
}
