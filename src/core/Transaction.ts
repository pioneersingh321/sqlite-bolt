import { Driver } from '../drivers/Driver';
import { Queryable, ExecuteResult } from '../types';
import { normalizeParams } from './Sanitizer';

export class Transaction implements Queryable {
  constructor(private driver: Driver) {}

  async begin(): Promise<void> { await this.driver.beginTransaction(); }
  async commit(): Promise<void> { await this.driver.commit(); }
  async rollback(): Promise<void> { await this.driver.rollback(); }

  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    return this.driver.query<T>(sql, params ? normalizeParams(params) : params);
  }

  async execute(sql: string, params?: any[]): Promise<ExecuteResult> {
    return this.driver.execute(sql, params ? normalizeParams(params) : params);
  }
}