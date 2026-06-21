import { ExecuteResult } from '../types';

export abstract class Driver {
  abstract open(): Promise<void>;
  abstract close(): Promise<void>;
  abstract isOpen(): boolean;
  abstract query<T>(sql: string, params?: any[]): Promise<T[]>;
  abstract execute(sql: string, params?: any[]): Promise<ExecuteResult>;
  abstract beginTransaction(): Promise<void>;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  /** Optional: force-persist database state (used by WebDriver). */
  persist?(): Promise<void>;
}