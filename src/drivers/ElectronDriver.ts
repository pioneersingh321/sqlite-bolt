import { Driver } from './Driver';
import { BoltConfig, ExecuteResult } from '../types';
import { ConnectionError } from '../errors';

// STUB: v1.3 — better-sqlite3 deferred
export class ElectronDriver extends Driver {
  constructor(private config: BoltConfig) { super(); }
  async open(): Promise<void> {
    throw new ConnectionError('Electron driver is stubbed. Target: v1.3');
  }
  async close(): Promise<void> {}
  isOpen(): boolean { return false; }
  async query<T>(): Promise<T[]> { return []; }
  async execute(): Promise<ExecuteResult> { return { changes: 0 }; }
  async beginTransaction(): Promise<void> {}
  async commit(): Promise<void> {}
  async rollback(): Promise<void> {}
}
