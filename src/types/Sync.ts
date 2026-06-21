export interface SyncConfig {
  enabled: boolean;
  endpoint: string;
  conflictStrategy: 'local' | 'remote' | 'merge' | 'manual';
  headers?: Record<string, string>;
  autoSync?: boolean;
  syncInterval?: number;
  deltaSync?: boolean;
}

export interface ChangeRecord {
  id: number;
  op: 'insert' | 'update' | 'delete';
  tableName: string;
  rowId: number | null;
  checksum: string | null;
  payload: string | null;
  synced: number;
  timestamp: number;
}

export interface QueueRecord {
  id: number;
  tableName: string;
  rowId: number | null;
  op: 'insert' | 'update' | 'delete';
  payload: string;
  checksum: string | null;
  attempts: number;
  createdAt: number;
}

export interface SyncStatus {
  pending: number;
  lastSync: Date | null;
  conflicts: number;
  online: boolean;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
}

export interface SyncPatch {
  table: string;
  rowId: number | null;
  op: 'insert' | 'update' | 'delete';
  data: Record<string, any>;
  checksum?: string;
}

export interface PushPayload {
  changes: ChangeRecord[];
  lastSync: number | null;
}

export interface PullPayload {
  patches: SyncPatch[];
  serverTimestamp: number;
}
