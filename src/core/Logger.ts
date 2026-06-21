export interface LogEvent {
  type: 'query' | 'execute' | 'migration' | 'transaction';
  sql: string;
  params?: any[];
  durationMs: number;
  timestamp: Date;
}

export type LogHandler = (event: LogEvent) => void;

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export class BoltLogger {
  private handlers: LogHandler[] = [];

  addHandler(handler: LogHandler): void {
    this.handlers.push(handler);
  }

  removeHandler(handler: LogHandler): void {
    const idx = this.handlers.indexOf(handler);
    if (idx !== -1) this.handlers.splice(idx, 1);
  }

  log(event: LogEvent): void {
    for (const h of this.handlers) h(event);
  }

  time<T>(
    type: LogEvent['type'],
    sql: string,
    params: any[] | undefined,
    fn: () => T
  ): T {
    const start = now();
    try {
      return fn();
    } finally {
      const durationMs = now() - start;
      this.log({ type, sql, params, durationMs, timestamp: new Date() });
    }
  }

  async timeAsync<T>(
    type: LogEvent['type'],
    sql: string,
    params: any[] | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = now();
    try {
      return await fn();
    } finally {
      const durationMs = now() - start;
      this.log({ type, sql, params, durationMs, timestamp: new Date() });
    }
  }
}

/** Default console handler: `[Bolt] 12.34ms QUERY: SELECT ...` */
export const consoleHandler: LogHandler = (event) => {
  const params = event.params?.length
    ? ` | params: ${JSON.stringify(event.params)}`
    : '';
  console.log(
    `[Bolt] ${event.durationMs.toFixed(2)}ms ${event.type.toUpperCase()}: ${event.sql}${params}`
  );
};
