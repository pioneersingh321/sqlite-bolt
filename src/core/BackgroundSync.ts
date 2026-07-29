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

    // Try Capacitor Background Task (optional peer dep — safely loaded without bundler errors)
    try {
      let bgTaskPlugin: any = null;

      // 1. Check window.Capacitor.Plugins (native bridge)
      const winCap = typeof window !== 'undefined' ? (window as any).Capacitor : null;
      if (winCap?.Plugins?.BackgroundTask) {
        bgTaskPlugin = winCap.Plugins.BackgroundTask;
      } else if (winCap?.isPluginAvailable?.('BackgroundTask')) {
        // 2. Dynamic import with webpackIgnore so Webpack will not fail if missing
        const capawesomePkg = '@capawesome/capacitor-background-task';
        const communityPkg = '@capacitor-community/background-tasks';
        try {
          const mod = await import(/* webpackIgnore: true */ capawesomePkg);
          bgTaskPlugin = mod?.BackgroundTask;
        } catch {
          try {
            const mod = await import(/* webpackIgnore: true */ communityPkg);
            bgTaskPlugin = mod?.BackgroundTask;
          } catch {
            // Plugin not installed
          }
        }
      }

      if (bgTaskPlugin && typeof bgTaskPlugin.beforeExit === 'function') {
        this.handlerRef = await bgTaskPlugin.beforeExit(async () => {
          await this.run();
          if (typeof bgTaskPlugin.finish === 'function' && this.handlerRef) {
            await bgTaskPlugin.finish({ taskId: this.handlerRef });
          }
        });
      }
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
