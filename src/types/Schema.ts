import type { SchemaBuilder } from '../core/SchemaBuilder';
import type { Queryable } from './Result';

export interface Migration {
  version: number;
  name?: string;
  up: (schema: SchemaBuilder, db: Queryable) => Promise<void>;
  down?: (schema: SchemaBuilder, db: Queryable) => Promise<void>;
}
