# sqlite-bolt Feature Guide

Complete guide with examples for all implemented features across v1.1, v1.2, v1.3, and v2.0.

---

## Table of Contents

- [v1.1 — Developer Experience & Performance](#v11)
- [v1.2 — Offline & Sync](#v12)
- [v1.3 — Advanced SQL](#v13)
- [v2.0 — ORM & Relations](#v20)

---

## <a id="v11"></a>v1.1 — Developer Experience & Performance

### Debug Logger

Tree-shakeable SQL logger with timing.

```typescript
const db = await Bolt.create({
  dbName: 'app',
  driver: 'capacitor',
  debug: true, // enables logging
});

// Custom handler
const remove = db.logger?.addHandler((event) => {
  console.log(`[${event.type}] ${event.sql} — ${event.durationMs}ms`);
});
```

### Batch Operations

```typescript
// Insert many rows in chunked transactions
await db.table('logs').insertBatch([
  { level: 'error', message: 'Crash' },
  { level: 'warn', message: 'Slow query' },
  // ... 1000+ rows
], 100); // chunk size

// Update many rows
await db.table('users').updateBatch([
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
], 'id', 50);
```

### Schema Introspection

```typescript
// List all tables
const tables = await db.introspect.tables();
// → [{ name: 'users', sql: 'CREATE TABLE "users"...' }]

// Column metadata
const cols = await db.introspect.columns('users');
// → [{ cid: 0, name: 'id', type: 'INTEGER', notnull: true, primaryKey: true }]

// Index metadata
const indexes = await db.introspect.indexes('users');

// Foreign keys
const fks = await db.introspect.foreignKeys('orders');

// Full table schema
const schema = await db.introspect.table('users');
// → { name, sql, columns, indexes, foreignKeys }

// All tables at once
const all = await db.introspect.allTables();
```

### Compiled Query Debug (`.explain()`)

```typescript
// Query plan for a QueryBuilder
const plan = await Bolt.table('users')
  .select('id', 'name')
  .where('status', 'active')
  .explain();
// → [{ id: 0, parent: 0, notused: 0, detail: 'SEARCH users USING INDEX...' }]

// Raw SQL explain
const plan = await db.explain(
  'SELECT * FROM orders WHERE total > ?',
  [100]
);
```

### Placeholder Sanitization

```typescript
// Identifiers are validated (table/column names)
// Rejects: quotes, semicolons, comment sequences
Bolt.table('users"; DROP TABLE users; --'); // → throws QueryError

// Values are normalized automatically
// boolean → 0/1, Date → ISO string, undefined → null, NaN/Infinity → null
```

### Connection Health

```typescript
// Ping
const { latencyMs } = await db.ping();
// → { ok: true, latencyMs: 12 }

// Boolean health check
const ok = await db.isHealthy();

// Retry config for locked/busy errors
const db = await Bolt.create({
  dbName: 'app',
  driver: 'capacitor',
  retry: {
    maxRetries: 5,
    delayMs: 100,
    backoff: 'exponential', // or 'linear'
  },
});
```

---

## <a id="v12"></a>v1.2 — Offline & Sync

### Sync Setup

```typescript
const db = await Bolt.create({
  dbName: 'app',
  driver: 'capacitor',
  sync: {
    enabled: true,
    endpoint: 'https://api.example.com/sync',
    conflictStrategy: 'merge',   // 'local' | 'remote' | 'merge' | 'manual'
    autoSync: true,              // sync when network restores
    deltaSync: true,             // send only changed fields
    syncInterval: 300_000,       // background sync every 5 min
  },
});
```

### Manual Sync

```typescript
const result = await db.sync();
// → { pushed: 3, pulled: 2, conflicts: 0, errors: [] }

// Sync status
const status = await db.syncStatus();
// → { pending: 3, lastSync: Date, conflicts: 0, online: true }
```

### Change Tracking (auto)

All local mutations are logged to `_bolt_changes` when sync is enabled.

```typescript
// Tracked automatically:
await new UserModel().insert({ name: 'Alice' });
await new UserModel().update(1, { name: 'Bob' });

// Read pending changes
const pending = await db.introspect.query(
  'SELECT * FROM _bolt_changes WHERE synced = 0'
);
```

### Offline Queue

```typescript
const queue = db.getQueue();

// Enqueue a mutation (deduplicates by table+row_id)
await queue!.enqueue('users', 'update', {
  changedFields: { name: 'Alice' },
  fullRow: { id: 1, name: 'Alice', email: 'a@example.com' },
}, 1);

// Get pending
const items = await queue!.pending();

// Remove processed
await queue!.remove([1, 2, 3]);
```

### Data Seeding

```typescript
// From JSON
await db.seedFromJSON([
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
], 'users');

// From CSV
const csv = `name,email
Alice,alice@example.com
Bob,bob@example.com`;
await db.seedFromCSV(csv, 'users');
```

### Export / Import

```typescript
// Export all user tables
const dump = await db.exportToJSON();
// → { users: [{...}], orders: [{...}] }

// Export specific tables
const dump = await db.exportToJSON(['users', 'orders']);

// Import
const { inserted, errors } = await db.importFromJSON(dump, {
  clearBeforeImport: true,
  skipErrors: false,
});
```

---

## <a id="v13"></a>v1.3 — Advanced SQL

### Query Builder Subqueries

```typescript
// IN subquery
const orders = await Bolt.table('orders')
  .whereInSubquery('user_id', (qb) =>
    qb.table('users').select('id').where('active', true)
  )
  .get();

// NOT IN subquery
const inactive = await Bolt.table('users')
  .whereNotInSubquery('id', (qb) =>
    qb.table('orders').select('user_id')
  )
  .get();

// EXISTS
const withOrders = await Bolt.table('users')
  .whereExists((qb) =>
    qb.table('orders').select('1').whereColumn('orders.user_id', 'users.id')
  )
  .get();

// NOT EXISTS
const withoutOrders = await Bolt.table('users')
  .whereNotExists((qb) =>
    qb.table('orders').select('1').whereColumn('orders.user_id', 'users.id')
  )
  .get();
```

---

## <a id="v20"></a>v2.0 — ORM & Relations

### Relations & Lazy Loading

```typescript
interface User { id: number; name: string; }
interface Order { id: number; user_id: number; total: number; }

class OrderModel extends BoltModel<Order> {
  protected table = 'orders';

  user(row?: Order) {
    return this.belongsTo<User>('users', 'user_id', row);
  }
  items(row?: Order) {
    return this.hasMany<OrderItem>('order_items', 'order_id', row);
  }
}

// Lazy loading: auto-resolves when awaited
const orderModel = new OrderModel();
await orderModel.hydrate(orderData);

const user  = await orderModel.user();   // belongsTo → .first()
const items = await orderModel.items();  // hasMany  → .get()

// Chain modifiers before await
const recentItems = await orderModel
  .items()
  .where('status', 'active')
  .orderBy('created_at', 'DESC')
  .limit(10);

// Pass row explicitly (no hydration needed)
const order = await new OrderModel().find(1);
const user = await new OrderModel().user(order!).first();
```

### Eager Loading (N+1 prevention)

```typescript
class OrderModel extends BoltModel<Order> {
  protected table = 'orders';

  protected relations = {
    user:  { type: 'belongsTo', table: 'users',       foreignKey: 'user_id' },
    items: { type: 'hasMany',   table: 'order_items', foreignKey: 'order_id' },
  };
}

// Batch-fetch relations (2 queries instead of N+1)
const orders = await new OrderModel().with('user', 'items').findAll();

for (const order of orders) {
  console.log(order.user.name);      // already loaded
  console.log(order.items.length);   // already loaded
}
```

### Query Scopes

```typescript
class UserModel extends BoltModel<User> {
  protected table = 'users';

  protected scopes = {
    active: (qb) => qb.where('status', 'active'),
    recent: (qb) => qb.where('created_at', '>', '2024-01-01'),
  };
}

// Named scope
const users = await new UserModel().scope('active').get();

// Inline scope
const admins = await new UserModel()
  .scope((qb) => qb.where('role', 'admin'))
  .get();

// Chain multiple
const results = await new UserModel()
  .scope('active')
  .scope('recent')
  .orderBy('name')
  .get();

// On QueryBuilder directly
const users = await Bolt.table('users')
  .scope((qb) => qb.where('status', 'active'))
  .get();
```

### Global Scopes

```typescript
class UserModel extends BoltModel<User> {
  protected table = 'users';

  protected globalScopes = {
    active: (qb) => qb.where('status', 'active'),
    tenant: (qb) => qb.where('tenant_id', currentTenantId),
  };
}

// All queries automatically include global scopes
const users = await new UserModel().findAll();
// → WHERE status = 'active' AND tenant_id = ?

// Skip a specific scope
const all = await new UserModel().withoutScope('active').findAll();

// Skip all global scopes
const raw = await new UserModel().withoutScopes().findAll();
```

### Event Bus

```typescript
// Subscribe
const unsub = BoltEvent.on('users.created', ({ data }) => {
  console.log('User created:', data.id, data.name);
});

// Subscribe once
BoltEvent.once('users.updated', ({ data }) => {
  console.log('Updated once:', data.id);
});

// Unsubscribe
unsub();

// Manual emit
await BoltEvent.emit('custom.event', {
  event: 'custom.event',
  table: 'orders',
  data: { orderId: 123 },
  timestamp: Date.now(),
});

// Auto-emitted model events:
// {table}.created  — after insert
// {table}.updated  — after update
// {table}.deleted  — after hard delete

// Lifecycle events:
// db.beforeQuery, db.afterQuery, db.beforeExecute, db.afterExecute
```

### Entity System (with dirty tracking)

```typescript
// Find as entity
const user = await new UserModel().findEntity(1);

// Dirty tracking
user.set('name', 'Alice Updated');
user.set('email', 'new@example.com');

user.isDirty();           // → true
user.isDirty('name');     // → true
user.getDirty();          // → { name: 'Alice Updated', email: 'new@example.com' }
user.getOriginal('name'); // → 'Alice'

user.revert('name');      // undo one field
user.revert();            // undo all

// Save only dirty fields
const ok = await user.save();

// Computed properties
class UserEntity extends BoltEntity<User> {
  protected computed = {
    fullName: (data) => `${data.first_name} ${data.last_name}`,
  };
  get fullName(): string {
    return `${this.get('first_name')} ${this.get('last_name')}`;
  }
}

// Entity-level lazy loading
const order = await new OrderModel().findEntity(1);
const user = await order.belongsTo<User>('users', 'user_id');
const items = await order.hasMany<OrderItem>('order_items', 'order_id');
```

### CI4-Style Callback Arrays

```typescript
class UserModel extends BoltModel<User> {
  protected table = 'users';
  protected allowCallbacks = true;

  // Refer to methods by name
  protected beforeInsertCallbacks = ['hashPassword', 'stampCreatedAt'];
  protected afterFindCallbacks = ['addFullName'];

  // Or use inline functions
  protected beforeDeleteCallbacks = [
    async (id) => {
      console.log('About to delete user', id);
      return true;
    }
  ];

  private async hashPassword(data: Partial<User>): Promise<Partial<User>> {
    if (data.password) {
      data.password = await bcrypt(data.password);
    }
    return data;
  }

  private stampCreatedAt(data: Partial<User>): Partial<User> {
    data.created_at = new Date().toISOString();
    return data;
  }

  private addFullName(result: User | User[] | null): void {
    if (!result) return;
    const rows = Array.isArray(result) ? result : [result];
    for (const row of rows) {
      (row as any).full_name = `${row.first_name} ${row.last_name}`;
    }
  }
}
```

**Available callback events:**
- `beforeInsertCallbacks` — after filterAllowed, before validation
- `afterInsertCallbacks` — after insert, with full row + id
- `beforeUpdateCallbacks` — after filterAllowed, before validation
- `afterUpdateCallbacks` — after update, with payload + affected count
- `beforeFindCallbacks` — before query executes (receives QueryBuilder)
- `afterFindCallbacks` — after results returned (receives row/rows/null)
- `beforeDeleteCallbacks` — before delete (can return false to cancel)
- `afterDeleteCallbacks` — after delete

### Plugin System

```typescript
// Define a plugin
const AuditPlugin: BoltPlugin = {
  name: 'audit',
  install({ bolt, db }) {
    BoltEvent.on('db.afterExecute', ({ data }) => {
      console.log(`[Audit] ${data.sql}`);
    });
    BoltEvent.on('users.created', ({ data }) => {
      console.log(`[Audit] User ${data.id} created`);
    });
  },
};

// Register
Bolt.use(AuditPlugin);

// Retrieve
const audit = Bolt.plugin('audit');
```

---

## Quick Reference

### Bolt (Static)

| Method | Example |
|--------|---------|
| `Bolt.create(config)` | `const db = await Bolt.create({ dbName: 'app', driver: 'capacitor' })` |
| `Bolt.addConnection(name, db)` | `Bolt.addConnection('default', db)` |
| `Bolt.connection(name?)` | `Bolt.connection()` |
| `Bolt.db()` | shorthand for `Bolt.connection()` |
| `Bolt.table(name)` | `Bolt.table('users').where('active', true).get()` |
| `Bolt.query(sql, params?)` | `Bolt.query('SELECT * FROM users')` |
| `Bolt.execute(sql, params?)` | `Bolt.execute('UPDATE users SET name = ?', ['Alice'])` |
| `Bolt.use(plugin)` | `Bolt.use(AuditPlugin)` |
| `Bolt.plugin(name)` | `Bolt.plugin('audit')` |

### Database

| Method | Example |
|--------|---------|
| `db.table(name)` | `db.table('users')` |
| `db.query(sql, params?)` | `db.query('SELECT * FROM users WHERE id = ?', [1])` |
| `db.execute(sql, params?)` | `db.execute('INSERT INTO users (name) VALUES (?)', ['Alice'])` |
| `db.transaction(fn)` | `db.transaction(async (trx) => { ... })` |
| `db.migrate()` | `db.migrate()` |
| `db.ping()` | `db.ping()` |
| `db.isHealthy()` | `db.isHealthy()` |
| `db.sync()` | `db.sync()` |
| `db.syncStatus()` | `db.syncStatus()` |
| `db.trackChange(...)` | `db.trackChange('insert', 'users', 1)` |
| `db.explain(sql, params?)` | `db.explain('SELECT * FROM users')` |
| `db.seedFromJSON(data, table)` | `db.seedFromJSON([{name:'A'}], 'users')` |
| `db.seedFromCSV(csv, table)` | `db.seedFromCSV(csv, 'users')` |
| `db.exportToJSON(tables?)` | `db.exportToJSON()` |
| `db.importFromJSON(data)` | `db.importFromJSON(dump)` |
| `db.introspect.tables()` | `db.introspect.tables()` |
| `db.introspect.columns(table)` | `db.introspect.columns('users')` |
| `db.introspect.indexes(table)` | `db.introspect.indexes('users')` |
| `db.introspect.foreignKeys(table)` | `db.introspect.foreignKeys('orders')` |
| `db.introspect.table(table)` | `db.introspect.table('users')` |
| `db.introspect.allTables()` | `db.introspect.allTables()` |

### QueryBuilder

| Method | Example |
|--------|---------|
| `.select(...fields)` | `.select('id', 'name')` |
| `.where(field, value)` | `.where('status', 'active')` |
| `.where(field, op, value)` | `.where('age', '>', 18)` |
| `.where(conditions)` | `.where({ status: 'active', role: 'admin' })` |
| `.orWhere(...)` | `.orWhere('role', 'moderator')` |
| `.whereIn(field, values)` | `.whereIn('id', [1, 2, 3])` |
| `.whereNotIn(field, values)` | `.whereNotIn('status', ['banned'])` |
| `.whereLike(field, pattern)` | `.whereLike('name', '%Alice%')` |
| `.whereNull(field)` | `.whereNull('deleted_at')` |
| `.whereNotNull(field)` | `.whereNotNull('email')` |
| `.whereBetween(field, [min, max])` | `.whereBetween('age', [18, 65])` |
| `.whereRaw(sql, bindings?)` | `.whereRaw('created_at > datetime("now", "-7 days")')` |
| `.whereInSubquery(field, cb)` | `.whereInSubquery('user_id', qb => qb.table('users').select('id'))` |
| `.whereNotInSubquery(field, cb)` | `.whereNotInSubquery('id', qb => ...)` |
| `.whereExists(cb)` | `.whereExists(qb => qb.table('orders').select('1'))` |
| `.whereNotExists(cb)` | `.whereNotExists(qb => ...)` |
| `.join(table, on, type?)` | `.join('users', 'orders.user_id = users.id')` |
| `.leftJoin(table, on)` | `.leftJoin('users', 'orders.user_id = users.id')` |
| `.groupBy(...fields)` | `.groupBy('status')` |
| `.orderBy(field, dir?)` | `.orderBy('created_at', 'DESC')` |
| `.orderByRaw(sql)` | `.orderByRaw('RANDOM()')` |
| `.limit(n)` | `.limit(10)` |
| `.offset(n)` | `.offset(20)` |
| `.page(page, perPage)` | `.page(2, 20)` |
| `.distinct()` | `.distinct()` |
| `.map(fn)` | `.map(row => ({ ...row, upperName: row.name.toUpperCase() }))` |
| `.scope(fn)` | `.scope(qb => qb.where('active', true))` |
| `.insert(data)` | `.insert({ name: 'Alice' })` |
| `.insertBatch(data[], size?)` | `.insertBatch([...], 100)` |
| `.set(field, value)` | `.set('name', 'Alice')` |
| `.update(where?)` | `.update({ status: 'active' })` |
| `.delete(where?)` | `.delete({ status: 'draft' })` |
| `.replace(data)` | `.replace({ id: 1, name: 'Alice' })` |
| `.upsert(data, uniqueField)` | `.upsert({ id: 1, name: 'Alice' }, 'id')` |
| `.get()` | `.get()` |
| `.first()` | `.first()` |
| `.countAllResults()` | `.countAllResults()` |
| `.explain()` | `.explain()` |

### BoltModel

| Method | Example |
|--------|---------|
| `model.find(id)` | `new UserModel().find(1)` |
| `model.findAll(where?)` | `new UserModel().findAll({ status: 'active' })` |
| `model.first(where?)` | `new UserModel().first({ email: 'a@example.com' })` |
| `model.findEntity(id)` | `new UserModel().findEntity(1)` |
| `model.findAllEntities(where?)` | `new UserModel().findAllEntities()` |
| `model.insert(data)` | `new UserModel().insert({ name: 'Alice' })` |
| `model.update(id, data)` | `new UserModel().update(1, { name: 'Bob' })` |
| `model.save(data)` | `new UserModel().save({ id: 1, name: 'Alice' })` |
| `model.delete(id, purge?)` | `new UserModel().delete(1)` |
| `model.query()` | `new UserModel().query()` |
| `model.hydrate(data)` | `model.hydrate(orderData)` |
| `model.belongsTo(table, fk, row?)` | `model.belongsTo<User>('users', 'user_id')` |
| `model.hasMany(table, fk, row?)` | `model.hasMany<Item>('items', 'order_id')` |
| `model.hasOne(table, fk, row?)` | `model.hasOne<Profile>('profiles', 'user_id')` |
| `model.scope(name \| fn)` | `model.scope('active')` or `model.scope(qb => ...)` |
| `model.with(...relations)` | `model.with('user', 'items').findAll()` |
| `model.withDeleted()` | `model.withDeleted().findAll()` |
| `model.onlyDeleted()` | `model.onlyDeleted().findAll()` |
| `model.withoutScope(name)` | `model.withoutScope('tenant').findAll()` |
| `model.withoutScopes()` | `model.withoutScopes().findAll()` |
| `model.paginate(page, perPage)` | `model.paginate(1, 20)` |
| `model.chunk(size, cb)` | `model.chunk(100, async rows => { ... })` |
| `model.validate(data)` | `model.validate({ name: 'Alice' })` |
| `model.errors()` | `model.errors()` |
| `model.allowCallbacks` | `protected allowCallbacks = true` |
| `model.beforeInsertCallbacks` | `protected beforeInsertCallbacks = ['hashPassword']` |
| `model.beforeFindCallbacks` | `protected beforeFindCallbacks = ['addScope']` |
| `model.afterFindCallbacks` | `protected afterFindCallbacks = ['addFullName']` |

### BoltEntity

| Method | Example |
|--------|---------|
| `entity.get(key)` | `entity.get('name')` |
| `entity.set(key, value)` | `entity.set('name', 'Alice')` |
| `entity.getComputed(key)` | `entity.getComputed('fullName')` |
| `entity.isDirty(field?)` | `entity.isDirty('name')` |
| `entity.getDirty()` | `entity.getDirty()` |
| `entity.getOriginal(field)` | `entity.getOriginal('name')` |
| `entity.revert(field?)` | `entity.revert('name')` |
| `entity.save()` | `entity.save()` |
| `entity.toJSON()` | `entity.toJSON()` |
| `entity.belongsTo(table, fk)` | `entity.belongsTo<User>('users', 'user_id')` |
| `entity.hasMany(table, fk)` | `entity.hasMany<Item>('items', 'order_id')` |
| `entity.hasOne(table, fk)` | `entity.hasOne<Profile>('profiles', 'user_id')` |

### BoltEvent

| Method | Example |
|--------|---------|
| `BoltEvent.on(event, handler)` | `BoltEvent.on('users.created', ({data}) => ...)` |
| `BoltEvent.once(event, handler)` | `BoltEvent.once('users.created', ...)` |
| `BoltEvent.off(event, handler)` | `BoltEvent.off('users.created', handler)` |
| `BoltEvent.emit(event, payload)` | `BoltEvent.emit('custom', payload)` |
| `BoltEvent.listenersCount(event)` | `BoltEvent.listenersCount('users.created')` |
| `BoltEvent.clear()` | `BoltEvent.clear()` |
