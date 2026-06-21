import { QueryBuilder } from './QueryBuilder';
import { Database } from './Database';

export class Relation<R extends Record<string, any>> implements PromiseLike<any> {
  private builder: QueryBuilder<R>;

  constructor(
    private db: Database,
    private relatedTable: string,
    private foreignKey: string,
    private parentKeyValue: any,
    private type: 'belongsTo' | 'hasMany' | 'hasOne'
  ) {
    this.builder = db.table<R>(relatedTable);
    if (type === 'belongsTo') {
      this.builder.where('id', parentKeyValue);
    } else {
      this.builder.where(foreignKey, parentKeyValue);
    }
    if (type === 'hasOne') {
      this.builder.limit(1);
    }
  }

  /** Makes the Relation awaitable. belongsTo/hasOne → first(); hasMany → get(). */
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    const promise = this.type === 'hasMany' ? this.get() : this.first();
    return promise.then(onfulfilled, onrejected) as Promise<TResult1 | TResult2>;
  }

  // ── Proxied QueryBuilder methods ──

  where(field: string, value: any): this;
  where(field: string, operator: string, value: any): this;
  where(conditions: Record<string, any>): this;
  where(...args: any[]): this {
    (this.builder.where as any)(...args);
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.builder.orderBy(field, direction);
    return this;
  }

  limit(n: number): this {
    this.builder.limit(n);
    return this;
  }

  // ── Execution ──

  async first(): Promise<R | null> {
    return this.builder.first();
  }

  async get(): Promise<R[]> {
    return this.builder.get();
  }

  async count(): Promise<number> {
    return this.builder.countAllResults();
  }
}
