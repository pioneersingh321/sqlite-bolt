import { Bolt } from '../Bolt';
import { Database } from './Database';

export interface PluginContext {
  /** The Bolt static class. */
  bolt: typeof Bolt;
  /** The database instance (if plugin is installed after create()). */
  db?: Database;
}

export interface BoltPlugin {
  name: string;
  /** Called once when the plugin is registered. */
  install(context: PluginContext): void | Promise<void>;
}
