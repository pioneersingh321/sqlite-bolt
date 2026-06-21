export type NetworkListener = (online: boolean) => void;

export class NetworkStatus {
  private _online: boolean = true;
  private listeners = new Set<NetworkListener>();

  constructor() {
    if (typeof navigator !== 'undefined') {
      this._online = navigator.onLine;
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.setOnline(true));
      window.addEventListener('offline', () => this.setOnline(false));
    }
  }

  isOnline(): boolean {
    return this._online;
  }

  onChange(fn: NetworkListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setOnline(value: boolean): void {
    if (this._online === value) return;
    this._online = value;
    for (const fn of this.listeners) {
      try {
        fn(value);
      } catch {
        // ignore listener errors
      }
    }
  }
}
