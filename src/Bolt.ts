import { Database } from './core/Database';
import { QueryBuilder } from './core/QueryBuilder';
import { BoltModel } from './core/BoltModel';
import { BoltEntity } from './core/BoltEntity';
import { BoltPlugin } from './core/BoltPlugin';
import { BoltConfig, Queryable, ExecuteResult } from './types';
import { ConnectionError } from './errors';
import { CapacitorDriver } from './drivers/CapacitorDriver';
import { WebDriver } from './drivers/WebDriver';
import { ElectronDriver } from './drivers/ElectronDriver';

export { Database, QueryBuilder, BoltModel, BoltEntity };
export { rule } from './core/Validation';
export * from './types';
export * from './errors';

export class Bolt {
  private static connections: Map<string, Database> = new Map();
  private static defaultGroup: string = 'default';
  private static plugins: Map<string, BoltPlugin> = new Map();

  static async create(config: BoltConfig): Promise<Database> {
    let driver;
    switch (config.driver) {
      case 'capacitor':
        driver = new CapacitorDriver(config);
        break;
      case 'web':
        driver = new WebDriver(config);
        break;
      case 'electron':
        driver = new ElectronDriver(config);
        break;
      default:
        throw new ConnectionError(`Unsupported driver: ${config.driver}`);
    }

    const db = new Database(driver, config);
    await db.open();

    if (config.migrations && config.migrations.length > 0) {
      await db.migrate();
    }

    return db;
  }

  static addConnection(name: string, db: Database): void {
    this.connections.set(name, db);
  }

  /** Register a plugin. Installs it immediately on all existing connections. */
  static use(plugin: BoltPlugin): void {
    this.plugins.set(plugin.name, plugin);
    for (const db of this.connections.values()) {
      plugin.install({ bolt: this, db });
    }
  }

  /** Get a registered plugin by name. */
  static plugin<T extends BoltPlugin>(name: string): T | undefined {
    return this.plugins.get(name) as T;
  }

  static setDefaultGroup(name: string): void {
    this.defaultGroup = name;
  }

  static connection(name?: string): Database {
    const group = name || this.defaultGroup;
    const db = this.connections.get(group);
    if (!db) {
      throw new ConnectionError(
        `No database connection registered for group [${group}]. ` +
        `Call Bolt.addConnection('${group}', db) after Bolt.create().`
      );
    }
    if (!db.isOpen()) {
      throw new ConnectionError(`Connection [${group}] is closed.`);
    }
    return db;
  }

  static db(): Database {
    return this.connection();
  }

  static table<T = Record<string, any>>(name: string): QueryBuilder<T> {
    return this.connection().table<T>(name);
  }

  static async query<T = Record<string, any>>(sql: string, params?: any[]): Promise<T[]> {
    return this.connection().query<T>(sql, params);
  }

  static async execute(sql: string, params?: any[]): Promise<ExecuteResult> {
    return this.connection().execute(sql, params);
  }
}