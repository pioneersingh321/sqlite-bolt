import { Database } from './Database';
import { ChangeTracker } from './ChangeTracker';
import { NetworkStatus } from './NetworkStatus';
import { SyncConfig, SyncResult, SyncPatch, ChangeRecord, PullPayload } from '../types';
import { QueryError } from '../errors';

const META_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _bolt_sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export class SyncAdapter {
  constructor(
    private db: Database,
    private config: SyncConfig,
    private network: NetworkStatus,
    private tracker: ChangeTracker
  ) {}

  async init(): Promise<void> {
    for (const stmt of META_TABLE_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
      await this.db.execute(stmt);
    }
  }

  /** Push local changes to the server, then mark them synced. */
  async push(): Promise<SyncResult> {
    if (!this.network.isOnline()) {
      return { pushed: 0, pulled: 0, conflicts: 0, errors: ['Offline'] };
    }

    const changes = await this.tracker.pending();
    if (changes.length === 0) {
      return { pushed: 0, pulled: 0, conflicts: 0, errors: [] };
    }

    const payload = await this.buildPushPayload(changes);

    try {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.headers || {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return {
          pushed: 0,
          pulled: 0,
          conflicts: 0,
          errors: [`Push failed: HTTP ${res.status}`],
        };
      }

      // Mark all as synced
      await this.tracker.markSynced(changes.map((c) => c.id));
      return { pushed: changes.length, pulled: 0, conflicts: 0, errors: [] };
    } catch (e: any) {
      return {
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: [`Push error: ${e.message}`],
      };
    }
  }

  /** Pull server patches and apply to local DB. */
  async pull(): Promise<SyncResult> {
    if (!this.network.isOnline()) {
      return { pushed: 0, pulled: 0, conflicts: 0, errors: ['Offline'] };
    }

    const lastSync = await this.getMeta('lastSync');
    const since = lastSync ? `?since=${encodeURIComponent(lastSync)}` : '';

    try {
      const res = await fetch(`${this.config.endpoint}${since}`, {
        method: 'GET',
        headers: this.config.headers || {},
      });

      if (!res.ok) {
        return {
          pushed: 0,
          pulled: 0,
          conflicts: 0,
          errors: [`Pull failed: HTTP ${res.status}`],
        };
      }

      const payload: PullPayload = await res.json();
      const result = await this.applyPatches(payload.patches);
      await this.setMeta('lastSync', String(payload.serverTimestamp));
      return result;
    } catch (e: any) {
      return {
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: [`Pull error: ${e.message}`],
      };
    }
  }

  /** Push then pull in sequence. */
  async sync(): Promise<SyncResult> {
    const pushResult = await this.push();
    if (pushResult.errors.length > 0 && pushResult.pushed === 0) {
      return pushResult;
    }
    const pullResult = await this.pull();
    return {
      pushed: pushResult.pushed,
      pulled: pullResult.pulled,
      conflicts: pullResult.conflicts,
      errors: [...pushResult.errors, ...pullResult.errors].filter(Boolean),
    };
  }

  // ── Helpers ──

  private async buildPushPayload(changes: ChangeRecord[]): Promise<{ changes: any[]; lastSync: number | null }> {
    const useDelta = this.config.deltaSync !== false;

    // Group by table+rowId; if delta is on, keep only the latest change per row
    const groups = new Map<string, ChangeRecord>();
    for (const c of changes) {
      const key = `${c.tableName}:${c.rowId ?? 'null'}`;
      const existing = groups.get(key);
      if (!existing || c.timestamp > existing.timestamp) {
        groups.set(key, c);
      }
    }

    const items = Array.from(groups.values()).map((c) => {
      const base: any = {
        op: c.op,
        table: c.tableName,
        rowId: c.rowId,
        timestamp: c.timestamp,
      };
      if (useDelta && c.payload) {
        try {
          base.delta = JSON.parse(c.payload);
        } catch {
          base.delta = null;
        }
      }
      if (c.checksum) base.checksum = c.checksum;
      return base;
    });

    const lastSync = await this.getMeta('lastSync').then((v) => (v ? Number(v) : null));
    return { changes: items, lastSync };
  }

  private async applyPatches(patches: SyncPatch[]): Promise<SyncResult> {
    let pulled = 0;
    let conflicts = 0;
    const errors: string[] = [];

    for (const patch of patches) {
      try {
        const hasLocalConflict = await this.hasLocalConflict(patch.table, patch.rowId);

        if (hasLocalConflict) {
          conflicts++;
          const resolution = await this.resolveConflict(patch);
          if (!resolution) {
            continue; // strategy = 'local' or manual skipped
          }
        }

        await this.applyPatch(patch);
        pulled++;
      } catch (e: any) {
        errors.push(`Patch failed (${patch.table}:${patch.rowId}): ${e.message}`);
      }
    }

    return { pushed: 0, pulled, conflicts, errors };
  }

  private async hasLocalConflict(table: string, rowId: number | null): Promise<boolean> {
    if (rowId == null) return false;
    const rows = await this.db.query(
      `SELECT 1 FROM _bolt_changes WHERE table_name = ? AND row_id = ? AND synced = 0 LIMIT 1`,
      [table, rowId]
    );
    return rows.length > 0;
  }

  private async resolveConflict(patch: SyncPatch): Promise<boolean> {
    const strategy = this.config.conflictStrategy;

    if (strategy === 'local') {
      return false; // keep local, skip server patch
    }

    if (strategy === 'remote') {
      return true; // overwrite local
    }

    if (strategy === 'merge') {
      // Shallow merge: server fields overlay on top of local row
      if (patch.rowId == null) return true;
      const localRows = await this.db.query<Record<string, any>>(
        `SELECT * FROM "${patch.table}" WHERE id = ? LIMIT 1`,
        [patch.rowId]
      );
      if (localRows.length === 0) return true;
      patch.data = { ...localRows[0], ...patch.data };
      return true;
    }

    // 'manual' — skip by default; user handles via hooks elsewhere
    return false;
  }

  private async applyPatch(patch: SyncPatch): Promise<void> {
    const table = patch.table;

    if (patch.op === 'delete') {
      if (patch.rowId != null) {
        await this.db.execute(`DELETE FROM "${table}" WHERE id = ?`, [patch.rowId]);
      }
      return;
    }

    const fields = Object.keys(patch.data);
    if (fields.length === 0) return;

    if (patch.op === 'insert') {
      const placeholders = fields.map(() => '?').join(', ');
      const values = Object.values(patch.data);
      await this.db.execute(
        `INSERT INTO "${table}" (${fields.map((f) => `"${f}"`).join(', ')}) VALUES (${placeholders})`,
        values
      );
      return;
    }

    if (patch.op === 'update') {
      if (patch.rowId == null) return;
      const setClause = fields.map((f) => `"${f}" = ?`).join(', ');
      const values = [...Object.values(patch.data), patch.rowId];
      await this.db.execute(
        `UPDATE "${table}" SET ${setClause} WHERE id = ?`,
        values
      );
      return;
    }
  }

  private async getMeta(key: string): Promise<string | null> {
    const rows = await this.db.query<{ value: string }>(
      `SELECT value FROM _bolt_sync_meta WHERE key = ?`,
      [key]
    );
    return rows[0]?.value ?? null;
  }

  private async setMeta(key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO _bolt_sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  }
}
