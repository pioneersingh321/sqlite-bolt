# Agent: SqliteBolt

## Identity
**Project:** SqliteBolt  
**Version:** v1.0 (LOCKED)  
**Scope:** Registry + Model + Builder  
**Runtime:** TypeScript / ES2022+  
**Driver:** `@capacitor-community/sqlite`  
**Bundle Target:** < 15KB gzipped (core)  

#  kimi -r 25eb386f-e348-4c01-b310-640cedc8277c

---

## Architecture Lock

```
sqlite-bolt/
├── src/
│   ├── Bolt.ts                 # Static registry + connection factory
│   ├── core/
│   │   ├── Database.ts           # Connection instance (Queryable)
│   │   ├── QueryBuilder.ts       # Fluent SQL constructor (T optional)
│   │   ├── BoltModel.ts          # CI4-style Active Record base
│   │   ├── BoltEntity.ts         # Typed entity wrapper
│   │   ├── Transaction.ts        # ACID transaction scopes
│   │   ├── MigrationEngine.ts    # Versioned schema control
│   │   ├── SchemaBuilder.ts      # createTable / alterTable / dropTable
│   │   └── Validation.ts         # rule.required(), rule.unique(), etc.
│   ├── drivers/
│   │   ├── CapacitorDriver.ts    # Native bridge (locked)
│   │   ├── WebDriver.ts          # sql.js fallback (stub)
│   │   └── ElectronDriver.ts     # better-sqlite3 (stub)
│   └── types/
│       ├── Config.ts
│       ├── Result.ts
│       └── Schema.ts
```

---

## Core Patterns

### 1. Registry Pattern
Database connection is registered once, resolved everywhere. **Never inject db into models manually.**

```typescript
// bootstrap.ts — run once
const db = await Bolt.create({
  dbName: 'app_v1',
  driver: 'capacitor',
  version: 3,
  migrations: [m001_users, m002_orders],
  debug: true
});
Bolt.addConnection('default', db);

// anywhere.ts — zero params
const users = new UserModel();  // auto-resolves via Bolt.connection('default')
```

### 2. QueryBuilder — Type Optional
`T` defaults to `Record<string, any>`. Strict mode only when interface provided.

```typescript
// Loose
Bolt.table('logs').where('level', 'error').get();

// Strict
Bolt.table<Product>('products').select('id', 'name').where('price', '<', 100).get();
```

### 3. BoltModel — CI4 Parity
| CI4 | SqliteBolt |
|-----|-----------|
| `$this->db->table('users')` | `this.query()` |
| `$this->find($id)` | `this.find(id)` |
| `$this->findAll($where)` | `this.findAll(where)` |
| `$this->insert($data)` | `this.insert(data)` |
| `$this->update($id, $data)` | `this.update(id, data)` |
| `$this->delete($id)` | `this.delete(id)` (soft) / `this.delete(id, true)` (purge) |
| `$this->save($data)` | `this.save(data)` (upsert by PK presence) |
| `useSoftDeletes` | `protected softDelete = true` |
| `useTimestamps` | `protected timestamps = true` |
| `$allowedFields` | `protected allowedFields = [...]` |
| `$validationRules` | `protected validationRules = {...}` |
| `beforeInsert` / `afterInsert` | `protected async beforeInsert(data)` |
| `$DBGroup` | `protected dbGroup = 'default'` |

---

## API Surface

### Bolt (Static Registry)
```typescript
Bolt.create(config: BoltConfig): Promise<Database>
Bolt.addConnection(name: string, db: Database): void
Bolt.setDefaultGroup(name: string): void
Bolt.connection(name?: string): Database
Bolt.db(): Database
Bolt.table<T>(name: string): QueryBuilder<T>
Bolt.query<T>(sql: string, params?: any[]): Promise<T[]>
Bolt.execute(sql: string, params?: any[]): Promise<ExecuteResult>
```

### QueryBuilder<T = Record<string, any>>
```typescript
.select(...fields)
.where(field, value) / .where(field, op, value) / .where(conditions)
.orWhere(field, value) / .orWhere(field, op, value)
.whereIn(field, values) / .whereNotIn(field, values)
.whereLike(field, pattern) / .orLike(field, pattern) / .whereNotLike(field, pattern)
.whereNull(field) / .whereNotNull(field)
.whereBetween(field, [min, max]) / .whereNotBetween(field, [min, max])
.whereRaw(sql, bindings?)
.join(table, on, type?) / .leftJoin(table, on) / .innerJoin(table, on)
.groupBy(...fields) / .having(field, value) / .having(field, op, value)
.orderBy(field, direction?) / .orderByRaw(sql)
.limit(n) / .offset(n) / .page(page, perPage)
.get() / .getWhere(where) / .first() / .countAllResults()
.insert(data) → lastId / .insertBatch(data[], batchSize?)
.set(field, value) / .set(data) / .update(where?) → affected
.delete(where?) → affected
.replace(data) / .upsert(data, uniqueField)
.getCompiledSelect() / .getCompiledInsert(data) / .getCompiledUpdate() / .getCompiledDelete()
.reset() / .clone()
```

### BoltModel<T>
```typescript
// CRUD
.find(id) → T | null
.findAll(where?) → T[]
.first(where?) → T | null
.insert(data) → PK | false
.update(id, data) → boolean
.updateWhere(where, data) → affected
.save(data) → PK | boolean
.delete(id, purge?) → boolean
.deleteWhere(where, purge?) → affected

// Builder escape hatch
.query() → QueryBuilder<T>

// Modifiers
.withDeleted() / .onlyDeleted()

// Batch / Pagination
.chunk(size, callback) / .paginate(page?, perPage?) → PaginatedResult<T>

// Aggregation
.countAll() / .countAllResults(where?)

// Validation
.validate(data) → boolean (collects errors(), no throw)
.validateOrFail(data) → true (throws ValidationFailedError on failure)
.errors() → ValidationError[]

// Callbacks (override in subclass)
.beforeInsert(data) → Promise<Partial<T>>
.afterInsert(data, id) → Promise<void>
.beforeUpdate(data, id?) → Promise<Partial<T>>
.afterUpdate(data, affected) → Promise<void>
.beforeDelete(id) → Promise<boolean>
.afterDelete(id, purge) → Promise<void>
```

---

## Configuration Schema

```typescript
interface BoltConfig {
  dbName: string;
  driver: 'capacitor' | 'web' | 'electron';
  dbLocation?: string;
  version?: number;
  migrations?: Migration[];
  debug?: boolean;
  camelCase?: boolean;
  cache?: { enabled: boolean; ttl: number; maxSize: number };
  encrypted?: boolean;
  secret?: string;
  biometricAuth?: boolean;
}
```

---

## Validation Rules

```typescript
rule.required(msg?)
rule.minLength(n, msg?)
rule.maxLength(n, msg?)
rule.email(msg?)
rule.unique(table, column, msg?)   // async, checks DB
rule.inArray(arr, msg?)
rule.numeric(msg?)
rule.integer(msg?)
rule.regex(pattern, msg?)
rule.date(msg?)
```

---

## Error Hierarchy

```
BoltError
├── ConnectionError
│   └── DatabaseLockedError
├── QueryError
│   └── SyntaxError
├── ConstraintError
│   ├── UniqueViolationError (column?, value?)
│   ├── ForeignKeyError
│   └── CheckViolationError
├── MigrationError
│   └── IrreversibleMigrationError
├── ValidationFailedError (errors[])
└── DriverError
```

---

## Migration Pattern

```typescript
const m001_users: Migration = {
  version: 1,
  name: 'create_users',
  up: async (schema, db) => {
    await schema.createTable('users', (t) => {
      t.increments('id');
      t.string('email', 255).unique().notNullable();
      t.string('name', 100);
      t.enum('role', ['admin', 'user']).default('user');
      t.timestamps();
      t.softDeletes();
    });
  },
  down: async (schema) => {
    await schema.dropTable('users');
  }
};
```

---

## Transaction Pattern

```typescript
await Bolt.db().transaction(async (trx) => {
  await trx.execute('UPDATE inventory SET qty = qty - ? WHERE sku = ?', [1, 'SKU-123']);
  await trx.execute('INSERT INTO audit (action, sku) VALUES (?, ?)', ['sale', 'SKU-123']);
});
// Auto-rollback on throw. Auto-commit on success.
```

---

## Multi-DB Support

```typescript
Bolt.addConnection('default', mainDb);
Bolt.addConnection('analytics', analyticsDb);

class EventModel extends BoltModel<Event> {
  protected table = 'events';
  protected dbGroup = 'analytics';  // ← CI4 $DBGroup equivalent
}
```

---

## Forbidden Patterns

| Anti-Pattern | Why | Correct |
|-------------|-----|---------|
| `new UserModel(db)` | Breaks registry abstraction | `new UserModel()` |
| `db.table('x').get()` outside Bolt registry | Connection not tracked | `Bolt.table('x').get()` |
| Raw `execute()` for complex selects | No type safety, no caching | `Bolt.query<T>(sql)` or builder |
| Missing `await` on `.insert()` / `.update()` | SQLite async race conditions | Always `await` |
| `any` in public model methods | Kills intellisense | Generic `T` or `Record<string, any>` |
| Manual soft-delete WHERE clauses | Bypasses model logic | Use `.withDeleted()` / `.onlyDeleted()` |
| Synchronous schema changes on main thread | UI freeze on mobile | Always async `schema.createTable()` |

---

## Version Roadmap

### v1.0 — Foundation (LOCKED)
**Status:** Implementation complete. No architecture changes without unlock request.  
**Scope:** Registry + Model + Builder  
**Bundle:** ~12KB gzipped

| Feature | Detail |
|---------|--------|
| Static Registry | `Bolt.addConnection()`, `Bolt.connection()`, multi-group support |
| QueryBuilder | Fluent SELECT/INSERT/UPDATE/DELETE with type-optional `T` |
| BoltModel | CI4-style Active Record with callbacks, soft deletes, timestamps |
| Validation | `rule.required()`, `rule.unique()`, `rule.email()`, async cross-field |
| Migration Engine | Timestamped `up()`/`down()`, `_bolt_migrations` tracking table |
| Schema Builder | `createTable()`, `alterTable()`, `dropTable()`, column builders |
| Transaction | `Bolt.db().transaction(async trx => {})` with auto rollback |
| Capacitor Driver | Native bridge via `@capacitor-community/sqlite` |
| Web Driver | sql.js WASM engine with localStorage persistence | |
| Error Hierarchy | 10+ typed error classes with SQL context |

**Migration from v0.x:** None. v1.0 is first stable.

---

### v1.1 — Developer Experience & Performance
**Status:** Draft approved. Awaiting lock.  
**Target:** ~18KB gzipped  
**Breaking Changes:** None (additive only)

| Feature | Detail |
|---------|--------|
| **Query Cache** | Per-statement LRU cache with `ttl` and manual `invalidate(table)` |
| **Debug Logger** | Tree-shakeable `BoltLogger` with SQL + timing + params (dev-only) |
| **Batch Operations** | `insertBatch()` with chunked transactions, `updateBatch()` |
| **Schema Introspection** | `db.introspect.tables()`, `.columns('users')`, `.indexes()`, `.foreignKeys()` |
| **Compiled Query Debug** | `.explain()` returns query plan for performance analysis |
| **Raw Result Mapping** | `.map(fn)` post-processor on QueryBuilder results |
| **Web Driver** | `sql.js` WASM fallback for browser testing |
| **Connection Health** | `db.ping()`, auto-reconnect on `DatabaseLockedError` |
| **Query Builder Cloning** | `.clone()` deep copy for reusable query templates |
| **Placeholder Sanitization** | Audit all `?` bindings for injection resistance |

**Migration from v1.0:** Drop-in. Add `cache: { enabled: true }` to config.

---

### v1.2 — Offline & Sync
**Status:** Architecture drafted. Pending v1.1 lock.  
**Target:** ~25KB gzipped  
**Breaking Changes:** Config schema adds `sync` block. Existing configs unaffected.

| Feature | Detail |
|---------|--------|
| **Change Tracking** | Auto-audit `_bolt_changes` table (op, table, row_id, checksum, timestamp) |
| **Offline Queue** | `BoltQueue` — buffers mutations when offline, replays with deduplication |
| **Sync Adapter** | Push/pull endpoint with configurable `conflictStrategy`: `local` \| `remote` \| `merge` \| `manual` |
| **Sync Hooks** | `beforeSync`, `afterSync`, `onConflict` callbacks on BoltModel |
| **Delta Sync** | Only transmit changed fields, not full rows |
| **Bi-directional** | Server → client patch application with schema validation |
| **Sync Status API** | `db.syncStatus()` → `{ pending: number, lastSync: Date, conflicts: number }` |
| **Background Sync** | Capacitor Background Task integration for periodic sync |
| **Data Seeding** | `.seedFromJSON()`, `.seedFromCSV()` for fixture loading |
| **Export/Import** | `db.exportToJSON()`, `db.importFromJSON()` full DB dump |

**Migration from v1.1:** Add `sync` config. No code changes required.

---

### v1.3 — Advanced SQL & Security
**Status:** Spec drafted. Pending v1.2 lock.  
**Target:** ~30KB gzipped  
**Breaking Changes:** None

| Feature | Detail |
|---------|--------|
| **Full-Text Search** | FTS5 integration with `.match()`, ranking, highlighting |
| **JSON1 Wrapper** | `.whereJson('meta->>$.tags', 'contains', 'urgent')` native JSON1 |
| **Window Functions** | `.rank()`, `.rowNumber()`, `.lag()`, `.lead()`, `.denseRank()` builder methods |
| **CTE Support** | `.with('cteName', qb => ...).select()` for recursive queries |
| **SQLCipher** | Encrypted DB pass-through with `secret` rotation |
| **Biometric Auth** | iOS FaceID / Android fingerprint before DB open |
| **Query Builder Subqueries** | `.whereInSubquery(field, qb => ...)` for correlated subselects |
| **Indexed Column Hints** | `.useIndex('idx_email')` query planner hints |
| **Vacuum & Analyze** | `db.optimize()` scheduled maintenance wrapper |
| **Electron Driver** | `better-sqlite3` native driver for desktop builds |

**Migration from v1.2:** Add `encrypted: true` if using SQLCipher. Otherwise drop-in.

---

### v2.0 — ORM & Relations
**Status:** Concept phase. Major version — breaking changes allowed.  
**Target:** ~40KB gzipped  
**Breaking Changes:** Model relation API, config schema v2

| Feature | Detail |
|---------|--------|
| **Relations** | `belongsTo()`, `hasMany()`, `hasOne()`, `belongsToMany()` with pivot table |
| **Eager Loading** | `.with('user', 'items')` — single-query or N+1 optimized |
| **Lazy Loading** | `await order.user().first()` — relation as async getter |
| **Relation Caching** | Per-request relation memoization |
| **Polymorphic Relations** | `morphTo()`, `morphMany()` for tag/comment patterns |
| **Entity System** | `BoltEntity<T>` with computed properties, dirty tracking, `.save()` |
| **Repository Pattern** | Optional `BoltRepository<T>` for Data Mapper fans |
| **Query Scopes** | `static active = (qb) => qb.where('status', 'active')` reusable filters |
| **Global Scopes** | Auto-applied `softDelete` scope, tenant isolation |
| **Event Bus** | `BoltEvent.emit('user.created', { id })` cross-model decoupling |
| **Plugin System** | `Bolt.use('replicate', ReplicatePlugin)` third-party extensions |

**Migration from v1.3:** Requires migration guide. `BoltModel` remains backward-compatible wrapper. Relations are opt-in via new base class or traits.

---

### v2.1+ — Platform & Ecosystem
**Status:** Backlog. No draft.

| Feature | Detail |
|---------|--------|
| **React/Vue/Svelte Bindings** | Official framework adapters for reactive queries |
| **DevTools Extension** | Chrome/Firefox extension for query inspection |
| **CLI Generator** | `npx sqlite-bolt generate model User` scaffolding |
| **GraphQL Adapter** | `Bolt.gql()` resolver layer for local-first GraphQL |
| **Vector Search** | `sqlite-vec` integration for AI embeddings |
| **WAL Mode Control** | `db.walMode(true)` for concurrent readers |
| **Backup Streaming** | Incremental backup to S3 / Dropbox |
| **Multi-Process Lock** | SharedArrayBuffer mutex for Web Workers |

---

## Version Lock Registry

| Component | Locked Version | Status | Notes |
|-----------|---------------|--------|-------|
| SqliteBolt Core | v1.0 | **LOCKED** | Registry + Model + Builder only |
| Capacitor Driver | v1.0 | **LOCKED** | Native bridge via `@capacitor-community/sqlite` |
| Web Driver | v1.0 | **IMPLEMENTED** | sql.js WASM with localStorage persistence |
| Electron Driver | stub | v1.3 target | better-sqlite3 deferred |
| Query Cache | — | v1.1 draft | LRU per-statement |
| Reactive Queries | — | v1.1 draft | Observable result refs |
| Sync Engine | — | v1.2 draft | Offline queue + delta sync |
| FTS5 / JSON1 | — | v1.3 draft | Advanced SQLite features |
| ORM Relations | — | v2.0 concept | belongsTo / hasMany / morph |

---

## Communication Protocol

- **Input:** `.ts` files, migration drafts, model definitions, query optimization requests, version unlock requests
- **Output:** Working code, minimal diffs, classified bug lists, architecture drafts
- **Lock required:** Before any architecture change beyond current locked version scope
- **No stubs in production code:** Mark `// STUB: v1.x` if unavoidable
- **Respect CI4 patterns:** Models are Active Record, not Data Mapper
- **Respect Bolt registry:** Never break `Bolt.addConnection()` abstraction
- **Version discipline:** Do not mix v1.2 features into v1.0 bug fixes

---

**Status:** v1.0 LOCKED  
**Next Gate:** v1.1 architecture lock (pending user approval)  
**Proceed:** Implementation review, bug fixes, v1.1 draft, or version unlock request.
