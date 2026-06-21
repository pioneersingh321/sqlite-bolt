import { Queryable, Migration } from '../types';
import { SchemaBuilder } from './SchemaBuilder';
import { MigrationError } from '../errors';

export class MigrationEngine {
  constructor(private db: Queryable, private migrations: Migration[]) {}

  async run(targetVersion: number): Promise<void> {
    await this.ensureTable();
    const rows = await this.db.query<{ version: number }>(
      'SELECT MAX(version) as version FROM _bolt_migrations'
    );
    const current = rows[0]?.version || 0;
    if (current >= targetVersion) return;

    const pending = this.migrations
      .filter(m => m.version > current && m.version <= targetVersion)
      .sort((a, b) => a.version - b.version);

    for (const m of pending) {
      try {
        await m.up(new SchemaBuilder(this.db), this.db);
        await this.db.execute(
          'INSERT INTO _bolt_migrations (version, name, executed_at) VALUES (?, ?, ?)',
          [m.version, m.name || `migration_${m.version}`, new Date().toISOString()]
        );
      } catch (e: any) {
        throw new MigrationError(`Migration ${m.version} failed: ${e.message}`);
      }
    }
  }

  private async ensureTable(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS _bolt_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT,
        executed_at TEXT
      )
    `);
  }
}