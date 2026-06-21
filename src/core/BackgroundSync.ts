import { SyncAdapter } from './SyncAdapter';

export interface BackgroundSyncOptions {
  intervalMs?: number;     // default: 5 minutes
  enabled?: boolean;
}

export class BackgroundSync {
  private timer?: ReturnType<typeof setInterval>;
  private handlerRef?: any;
  private lastSync = 0;

  constructor(
    private syncAdapter: SyncAdapter,
    private options: BackgroundSyncOptions = {}
  ) {}

  async start(): Promise<void> {
    if (this.options.enabled === false) return;
    const interval = this.options.intervalMs ?? 5 * 60 * 1000;

    // Try Capacitor Background Task (optional peer dep)
    try {
      // @ts-ignore optional peer dependency
      const { BackgroundTask } = await import('@capacitor-community/background-tasks');
      this.handlerRef = await BackgroundTask.beforeExit(async () => {
        await this.run();
        await BackgroundTask.finish({ taskId: this.handlerRef });
      });
    } catch {
      // Plugin not installed — fall through to interval
    }

    // Foreground interval fallback (also works on web)
    this.timer = setInterval(() => this.run(), interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async run(): Promise<void> {
    const now = Date.now();
    const interval = this.options.intervalMs ?? 5 * 60 * 1000;
    if (now - this.lastSync < interval) return;

    try {
      await this.syncAdapter.sync();
      this.lastSync = now;
    } catch {
      // Silently ignore sync errors in background
    }
  }
}
