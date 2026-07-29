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
  ) { }

  async start(): Promise<void> {
    if (this.options.enabled === false) return;
    const interval = this.options.intervalMs ?? 5 * 60 * 1000;

    // Optional Capacitor BackgroundTask integration (resolved via global Capacitor bridge to avoid Webpack warnings)
    try {
      const winCap = typeof window !== 'undefined' ? (window as any).Capacitor : null;
      const bgTaskPlugin = winCap?.Plugins?.BackgroundTask;

      if (bgTaskPlugin && typeof bgTaskPlugin.beforeExit === 'function') {
        this.handlerRef = await bgTaskPlugin.beforeExit(async () => {
          await this.run();
          if (typeof bgTaskPlugin.finish === 'function' && this.handlerRef) {
            await bgTaskPlugin.finish({ taskId: this.handlerRef });
          }
        });
      }
    } catch {
      // Background task unavailable — gracefully fall through to interval
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
