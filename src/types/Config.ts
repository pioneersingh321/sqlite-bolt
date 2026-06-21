export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
  backoff: 'linear' | 'exponential';
}

export interface BoltConfig {
  dbName: string;
  driver: 'capacitor' | 'web' | 'electron';
  dbLocation?: string;
  version?: number;
  migrations?: import('./Schema').Migration[];
  debug?: boolean;
  camelCase?: boolean;
  cache?: { enabled: boolean; ttl: number; maxSize: number };
  sqlJsWasmPath?: string;
  encrypted?: boolean;
  secret?: string;
  biometricAuth?: boolean;
  retry?: RetryConfig;
  sync?: import('./Sync').SyncConfig;
}
