# SqliteBolt — Usage Guide & Documentation

**Version:** v1.0  
**Scope:** Registry + Model + Builder  
**Runtime:** TypeScript / ES2022+  
**Driver:** `@capacitor-community/sqlite`

---

## Table of Contents

1. [Installation](#installation)
2. [Project Bootstrap](#project-bootstrap)
3. [Standalone QueryBuilder](#standalone-querybuilder)
4. [BoltModel (CI4-Style)](#boltmodel-ci4-style)
5. [Migrations](#migrations)
6. [Transactions](#transactions)
7. [Validation](#validation)
8. [Error Handling](#error-handling)
9. [Multi-Database](#multi-database)
10. [Advanced Patterns](#advanced-patterns)
11. [Capacitor Integration](#capacitor-integration)
12. [Troubleshooting](#troubleshooting)

---

## Installation

SqliteBolt is not on npm. Install from local source.

### Step 1: Build the plugin

```bash
cd /path/to/sqlite-bolt
npm install
npm run build
```

Ensure `dist/` folder is created with `index.js`, `index.d.ts`.

### Step 2: Install into your app

```bash
cd /path/to/your-capacitor-app
npm install /absolute/path/to/sqlite-bolt
```

Your `package.json` will show:
```json
{
  "dependencies": {
    "sqlite-bolt": "file:../sqlite-bolt"
  }
}
```

### Step 3: Install peer dependency

```bash
npm install @capacitor-community/sqlite
```

---

## Project Bootstrap

Create a single database bootstrap file. Run this once on app startup.

```typescript
// database/bootstrap.ts
import { Bolt } from 'sqlite-bolt';
import { m001_users } from './migrations/001_users';
import { m002_orders } from './migrations/002_orders';

export async function initDatabase() {
  const db = await Bolt.create({
    dbName: 'app_v1',
    driver: 'capacitor',
    version: 2,
    migrations: [m001_users, m002_orders],
    debug: true,              // logs SQL + timing to console
    camelCase: false,         // keep snake_case from DB
    encrypted: false
  });

  Bolt.addConnection('default', db);
  console.log('[SqliteBolt] Database initialized');
}
```

```typescript
// main.ts or App.tsx
import { initDatabase } from './database/bootstrap';

async function main() {
  await initDatabase();
  // app continues...
}
main();
```

---

## Standalone QueryBuilder

Use when you don't need a model — ad-hoc queries, reporting, dynamic SQL.

### SELECT

```typescript
import { Bolt } from 'sqlite-bolt';

// All active users
const users = await Bolt.table('users')
  .where('status', 'active')
  .orderBy('created_at', 'DESC')
  .get();

// First admin
const admin = await Bolt.table('users')
  .where('role', 'admin')
  .first();

// Specific columns only
const emails = await Bolt.table('users')
  .select('id', 'email')
  .whereNotNull('email_verified_at')
  .get();

// LIKE search
const search = await Bolt.table('products')
  .whereLike('name', '%laptop%')
  .orLike('description', '%laptop%')
  .get();

// WHERE IN
const activeRoles = await Bolt.table('users')
  .whereIn('role', ['admin', 'editor', 'moderator'])
  .where('status', 'active')
  .get();

// BETWEEN (date range)
const recent = await Bolt.table('orders')
  .whereBetween('created_at', ['2024-01-01', '2024-12-31'])
  .where('status', 'completed')
  .get();

// Complex AND/OR
const complex = await Bolt.table('users')
  .where('status', 'active')
  .where('role', '!=', 'banned')
  .orWhere('role', 'superadmin')  // (status=active AND role!=banned) OR role=superadmin
  .get();

// Raw WHERE
const raw = await Bolt.table('logs')
  .whereRaw("created_at > datetime('now', '-7 days')")
  .where('level', 'error')
  .get();
```

### JOIN

```typescript
const ordersWithUsers = await Bolt.table('orders')
  .select('orders.id', 'orders.total', 'users.name as customer_name')
  .join('users', 'orders.user_id = users.id')
  .where('orders.status', 'pending')
  .orderBy('orders.created_at', 'DESC')
  .get();

// LEFT JOIN
const allUsersWithOrders = await Bolt.table('users')
  .select('users.*', 'COUNT(orders.id) as order_count')
  .leftJoin('orders', 'users.id = orders.user_id')
  .groupBy('users.id')
  .get();
```

### Aggregation

```typescript
// Count
const total = await Bolt.table('users').countAllResults();
const activeCount = await Bolt.table('users').where('status', 'active').countAllResults();

// SUM / AVG / MIN / MAX
const stats = await Bolt.table('orders')
  .selectSum('total', 'revenue')
  .selectAvg('total', 'avg_order')
  .selectMin('total', 'min_order')
  .selectMax('total', 'max_order')
  .where('status', 'completed')
  .first();
// stats: { revenue: 45000, avg_order: 150, min_order: 10, max_order: 2000 }

// GROUP BY
const report = await Bolt.table('orders')
  .select('status')
  .selectSum('total', 'amount')
  .groupBy('status')
  .having('amount', '>', 1000)
  .get();
```

### Pagination

```typescript
const page1 = await Bolt.table('products')
  .where('stock', '>', 0)
  .orderBy('name', 'ASC')
  .page(1, 20)        // page 1, 20 per page
  .get();

// Manual limit/offset
const page2 = await Bolt.table('products')
  .limit(20)
  .offset(20)
  .get();
```

### INSERT

```typescript
// Single
const newId = await Bolt.table('users').insert({
  name: 'Jane Doe',
  email: 'jane@example.com',
  role: 'user',
  status: 'active'
});
console.log('Created user:', newId);  // 42

// Batch
const count = await Bolt.table('users').insertBatch([
  { name: 'User A', email: 'a@x.com', role: 'user' },
  { name: 'User B', email: 'b@x.com', role: 'user' },
  { name: 'User C', email: 'c@x.com', role: 'admin' }
], 100);
```

### UPDATE

```typescript
// Update by condition
await Bolt.table('users')
  .set('status', 'suspended')
  .where('last_login', '<', '2024-01-01')
  .update();

// Update multiple columns
await Bolt.table('users')
  .set({
    status: 'active',
    email_verified_at: new Date().toISOString()
  })
  .where('id', 5)
  .update();
```

### DELETE

```typescript
// Delete by condition
await Bolt.table('sessions')
  .where('expires_at', '<', new Date().toISOString())
  .delete();

// Hard delete specific row
await Bolt.table('logs')
  .where('level', 'debug')
  .delete();
```

### UPSERT

```typescript
// INSERT OR REPLACE
await Bolt.table('settings').replace({
  key: 'theme',
  value: 'dark'
});

// INSERT ... ON CONFLICT DO UPDATE
await Bolt.table('users').upsert({
  id: 1,
  name: 'Updated Name',
  email: 'same@email.com'
}, 'id');  // if id=1 exists, update; else insert
```

### Raw Queries (Escape Hatch)

```typescript
// SELECT
const rows = await Bolt.query(
  `SELECT u.*, COUNT(o.id) as order_count
   FROM users u
   LEFT JOIN orders o ON o.user_id = u.id
   WHERE u.created_at > ?
   GROUP BY u.id`,
  ['2024-01-01']
);

// INSERT/UPDATE/DELETE
await Bolt.execute(
  'UPDATE inventory SET qty = qty - ? WHERE sku = ? AND qty >= ?',
  [1, 'SKU-123', 1]
);
```

### Debug: See Compiled SQL

```typescript
const sql = Bolt.table('users')
  .where('status', 'active')
  .whereIn('role', ['admin', 'editor'])
  .orderBy('created_at', 'DESC')
  .getCompiledSelect();

console.log(sql);
// SELECT * FROM "users" WHERE "status" = ? AND "role" IN (?, ?) ORDER BY "created_at" DESC
```

---

## BoltModel (CI4-Style)

Use when you have a defined schema, need validation, callbacks, soft deletes, or timestamps.

### Define a Model

```typescript
// models/UserModel.ts
import { BoltModel, rule } from 'sqlite-bolt';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'suspended';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export class UserModel extends BoltModel<User> {
  protected table = 'users';
  protected primaryKey = 'id';
  protected allowedFields = ['name', 'email', 'role', 'status'];
  protected softDelete = true;
  protected timestamps = true;

  protected validationRules = {
    name: [rule.required(), rule.minLength(2)],
    email: [rule.required(), rule.email(), rule.unique('users', 'email')],
    role: [rule.required(), rule.inArray(['admin', 'user'])],
    status: [rule.inArray(['active', 'suspended'])]
  };

  // Callback: modify data before insert
  protected async beforeInsert(data: Partial<User>) {
    if (data.email) {
      data.email = data.email.toLowerCase().trim();
    }
    return data;
  }

  // Callback: side effects after insert
  protected async afterInsert(data: User, id: number) {
    console.log(`[Audit] User ${id} created`);
  }

  // Callback: guard delete
  protected async beforeDelete(id: number) {
    const user = await this.find(id);
    if (user?.role === 'admin') {
      console.warn('Cannot delete admin users');
      return false;  // cancel delete
    }
    return true;
  }
}
```

### Use the Model

```typescript
import { UserModel } from './models/UserModel';

const users = new UserModel();  // No DB parameter!

// ── FIND ──
const user = await users.find(1);
const all = await users.findAll();
const active = await users.findAll({ status: 'active' });
const firstAdmin = await users.first({ role: 'admin' });

// ── INSERT ──
const newId = await users.insert({
  name: 'Jane Doe',
  email: 'jane@example.com',
  role: 'user'
});

// ── UPDATE ──
await users.update(1, { status: 'suspended' });

// Update many at once
await users.updateWhere(
  { role: 'user', status: 'active' },
  { status: 'suspended' }
);

// ── SAVE (upsert) ──
await users.save({ id: 1, name: 'Updated' });     // UPDATE (has id)
await users.save({ name: 'New User' });            // INSERT (no id)

// ── DELETE ──
await users.delete(5);           // Soft delete (sets deleted_at)
await users.delete(5, true);     // Hard delete (removes row)

// Delete many
await users.deleteWhere({ status: 'suspended' });

// ── SOFT DELETE UTILITIES ──
const activeOnly = await users.findAll();                    // excludes deleted
const withDeleted = await users.withDeleted().findAll();     // includes all
const trashed = await users.onlyDeleted().findAll();        // only deleted

// Restore soft-deleted
await users.withDeleted().update(5, { deleted_at: null });
```

### Model + QueryBuilder Escape Hatch

```typescript
// When you need complex queries not covered by model helpers
const recent = await users.query()
  .where('created_at', '>', '2024-01-01')
  .whereLike('name', '%John%')
  .orderBy('id', 'DESC')
  .limit(10)
  .get();

// Aggregation via model
const totalUsers = await users.countAll();
const activeCount = await users.countAllResults({ status: 'active' });
```

### Pagination & Chunking

```typescript
// Paginate
const page = await users.paginate(1, 20);
console.log(page.data);        // User[]
console.log(page.pagination);  // { page: 1, perPage: 20, total: 150, lastPage: 8 }

// Chunk (memory-safe for large datasets)
await users.chunk(100, async (batch) => {
  for (const user of batch) {
    await processUser(user);  // your function
  }
});
```

### Validation Errors

```typescript
try {
  await users.insert({
    name: 'A',           // too short (minLength: 2)
    email: 'bad-email',  // invalid format
    role: 'hacker'       // not in allowed array
  });
} catch (err) {
  if (err instanceof ValidationFailedError) {
    console.log(err.errors);
    // [
    //   { field: 'name', rule: 'minLength', message: 'name failed minLength' },
    //   { field: 'email', rule: 'email', message: 'email failed email' },
    //   { field: 'role', rule: 'inArray', message: 'role failed inArray' }
    // ]
  }
}
```

---

## Migrations

Migrations are versioned, reversible schema changes. Run automatically on `Bolt.create()`.

### Write a Migration

```typescript
// database/migrations/001_users.ts
import { Migration } from 'sqlite-bolt';

export const m001_users: Migration = {
  version: 1,
  name: 'create_users_table',
  up: async (schema, db) => {
    await schema.createTable('users', (t) => {
      t.increments('id');
      t.string('email', 255).unique().notNullable();
      t.string('name', 100).notNullable();
      t.string('role', 20).default('user');
      t.string('status', 20).default('active');
      t.timestamps();       // created_at, updated_at
      t.softDeletes();      // deleted_at
    });
  },
  down: async (schema) => {
    await schema.dropTable('users');
  }
};
```

```typescript
// database/migrations/002_orders.ts
import { Migration } from 'sqlite-bolt';

export const m002_orders: Migration = {
  version: 2,
  name: 'create_orders_table',
  up: async (schema, db) => {
    await schema.createTable('orders', (t) => {
      t.increments('id');
      t.integer('user_id').notNullable();
      t.decimal('total', 10, 2).default(0);
      t.string('status', 20).default('pending');
      t.text('notes').nullable();
      t.timestamps();
    });

    // Add index separately
    await db.execute('CREATE INDEX idx_orders_user ON orders(user_id)');
  },
  down: async (schema) => {
    await schema.dropTable('orders');
  }
};
```

### Migration Runner

```typescript
// database/bootstrap.ts
import { Bolt } from 'sqlite-bolt';
import { m001_users } from './migrations/001_users';
import { m002_orders } from './migrations/002_orders';

const db = await Bolt.create({
  dbName: 'app',
  driver: 'capacitor',
  version: 2,                       // target version
  migrations: [m001_users, m002_orders]
});

// Migrations run automatically. Only pending ones execute.
// History stored in _bolt_migrations table.
```

### Schema Builder Reference

```typescript
await schema.createTable('products', (t) => {
  t.increments('id');                          // INTEGER PRIMARY KEY AUTOINCREMENT
  t.string('sku', 50).unique().notNullable();  // VARCHAR(50)
  t.string('name', 255).index();               // VARCHAR(255) + index hint
  t.text('description').nullable();            // TEXT
  t.integer('stock').default(0);               // INTEGER
  t.decimal('price', 10, 2).default(0.00);     // DECIMAL(10,2)
  t.boolean('is_active');                      // INTEGER (0/1)
  t.json('metadata').nullable();               // TEXT (JSON stored as string)
  t.timestamps();                              // created_at, updated_at
  t.softDeletes();                             // deleted_at
});

await schema.alterTable('products', (t) => {
  t.addColumn('category_id', 'INTEGER');
  t.dropColumn('old_column');
});

await schema.dropTable('temp_table');
```

---

## Transactions

Wrap multiple operations in ACID transactions. Auto-rollback on error.

```typescript
import { Bolt } from 'sqlite-bolt';

await Bolt.db().transaction(async (trx) => {
  // Deduct inventory
  await trx.execute(
    'UPDATE inventory SET qty = qty - ? WHERE sku = ? AND qty >= ?',
    [1, 'SKU-123', 1]
  );

  // Create order
  const orderResult = await trx.execute(
    'INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)',
    [userId, 99.99, 'paid']
  );

  // Create order items
  await trx.execute(
    'INSERT INTO order_items (order_id, sku, qty, price) VALUES (?, ?, ?, ?)',
    [orderResult.lastId, 'SKU-123', 1, 99.99]
  );

  // Audit log
  await trx.execute(
    'INSERT INTO audit (action, ref_id, details) VALUES (?, ?, ?)',
    ['order_created', orderResult.lastId, JSON.stringify({ sku: 'SKU-123' })]
  );
});
// If any step throws, entire transaction rolls back.
// If all succeed, auto-committed.
```

### Transaction with QueryBuilder

```typescript
await Bolt.db().transaction(async (trx) => {
  // Use trx.query() and trx.execute() — same API as Bolt.db()
  const user = await trx.query('SELECT * FROM users WHERE id = ?', [1]);

  // Or use raw execute
  await trx.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [10, 1]);
});
```

---

## Validation

Validation runs automatically before `insert()` and `update()` on models.

### Built-in Rules

```typescript
import { rule } from 'sqlite-bolt';

protected validationRules = {
  // Required field
  name: [rule.required()],

  // String length
  name: [rule.minLength(2), rule.maxLength(100)],

  // Email format
  email: [rule.required(), rule.email()],

  // Unique in database (async check)
  email: [rule.unique('users', 'email')],

  // Enum / whitelist
  role: [rule.required(), rule.inArray(['admin', 'user', 'editor'])],

  // Numeric
  age: [rule.numeric(), rule.integer()],

  // Regex
  phone: [rule.regex(/^\+?[\d\s-]{10,}$/)],

  // Date
  birth_date: [rule.date()]
};
```

### Custom Rules

```typescript
import { ValidationRule } from 'sqlite-bolt';

const rule = {
  // ... built-in rules ...

  strongPassword: (msg?: string): ValidationRule => ({
    name: 'strongPassword',
    message: msg || 'Password must be 8+ chars with uppercase, lowercase, and number',
    test: (v: any) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(String(v))
  }),

  // Async custom rule
  existsInTable: (table: string, column: string, msg?: string): ValidationRule => ({
    name: 'existsInTable',
    message: msg,
    test: async (v: any, db?: any) => {
      if (!db) return true;
      const row = await db.query(`SELECT 1 FROM "${table}" WHERE "${column}" = ? LIMIT 1`, [v]);
      return row.length > 0;
    }
  })
};
```

### Skip Validation

```typescript
class BulkImportModel extends BoltModel<Record> {
  protected skipValidation = true;  // bypass for trusted bulk ops
}
```

---

## Error Handling

Always catch `BoltError` subclasses for precise handling.

```typescript
import {
  BoltError,
  ConnectionError,
  QueryError,
  UniqueViolationError,
  ValidationFailedError,
  MigrationError
} from 'sqlite-bolt';

try {
  await users.insert({ email: 'dup@example.com' });
} catch (err) {
  if (err instanceof ConnectionError) {
    showToast('Database connection lost. Please restart app.');
  }
  else if (err instanceof UniqueViolationError) {
    showToast(`${err.column} "${err.value}" already exists`);
  }
  else if (err instanceof ValidationFailedError) {
    showFormErrors(err.errors);  // map to UI fields
  }
  else if (err instanceof QueryError) {
    console.error('SQL:', err.sql);
    console.error('Params:', err.params);
    logToSentry(err);
  }
  else if (err instanceof MigrationError) {
    console.error('Migration failed:', err.message);
    // App may need reinstall
  }
  else {
    throw err;  // unknown — rethrow
  }
}
```

---

## Multi-Database

Use multiple SQLite databases in one app.

```typescript
// bootstrap.ts
const mainDb = await Bolt.create({
  dbName: 'app_main',
  driver: 'capacitor',
  version: 1
});

const cacheDb = await Bolt.create({
  dbName: 'app_cache',
  driver: 'capacitor',
  version: 1
});

Bolt.addConnection('default', mainDb);
Bolt.addConnection('cache', cacheDb);

// Models auto-resolve by dbGroup
class UserModel extends BoltModel<User> {
  protected table = 'users';
  protected dbGroup = 'default';  // implied, explicit for clarity
}

class SessionModel extends BoltModel<Session> {
  protected table = 'sessions';
  protected dbGroup = 'cache';    // separate DB
}

// Standalone queries on named connection
const cacheRows = await Bolt.connection('cache').table('sessions').where('expired', 0).get();
```

---

## Advanced Patterns

### Type-Strict Queries

```typescript
interface Product {
  id: number;
  name: string;
  price: number;
  category_id: number;
}

// Full IntelliSense on field names
const cheap = await Bolt.table<Product>('products')
  .select('id', 'name', 'price')     // autocomplete suggests these
  .where('price', '<', 100)          // autocomplete: price, name, category_id
  .where('category_id', 5)
  .orderBy('name', 'ASC')
  .get();                             // Product[]
```

### Reusable Query Templates

```typescript
// Base query for active products
const baseQuery = Bolt.table<Product>('products')
  .where('status', 'active')
  .where('stock', '>', 0);

// Clone and extend for different views
const cheapProducts = baseQuery.clone().where('price', '<', 50).get();
const premiumProducts = baseQuery.clone().where('price', '>', 500).get();
```

### Raw + Builder Hybrid

```typescript
// Complex report using raw, then model for updates
const report = await Bolt.query<{ month: string; revenue: number }>(`
  SELECT strftime('%Y-%m', created_at) as month, SUM(total) as revenue
  FROM orders
  WHERE status = 'completed'
  GROUP BY month
  ORDER BY month DESC
`);

// Update flagged records via model
const flagged = await Bolt.table('orders').whereRaw('total > 10000').get();
for (const order of flagged) {
  await orderModel.update(order.id, { flagged: true });
}
```

### Seed Data

```typescript
// In a migration or bootstrap script
async function seedUsers() {
  const users = new UserModel();
  const count = await users.countAll();
  if (count === 0) {
    await users.insertBatch([
      { name: 'System', email: 'system@app.com', role: 'admin' },
      { name: 'Demo User', email: 'demo@example.com', role: 'user' }
    ]);
  }
}
```

---

## Capacitor Integration

### Android Setup

```bash
npm install @capacitor-community/sqlite
npx cap sync android
```

`capacitor.config.ts`:
```typescript
export default {
  plugins: {
    SQLite: {
      iosDatabaseLocation: 'Library/Databases',
      iosKeychainPrefix: 'app',
      androidIsEncryption: false,
      androidBiometric: {
        biometricAuth: false,
        biometricTitle: 'Authentication',
        biometricSubTitle: 'Access your database'
      }
    }
  }
};
```

### iOS Setup

```bash
npx cap sync ios
```

No additional config needed for basic usage.

### Web Fallback (Testing Only)

For browser testing before v1.1 WebDriver:
```typescript
const db = await Bolt.create({
  dbName: 'test',
  driver: 'capacitor',  // still use capacitor driver
  version: 1
});
// Capacitor's web implementation uses IndexedDB fallback automatically
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ConnectionError: No database connection registered` | `Bolt.addConnection()` not called | Ensure bootstrap runs before any model instantiation |
| `DatabaseLockedError` | Concurrent writes on same connection | Use `transaction()` or queue writes |
| `QueryError: no such table` | Migration not run | Check `version` matches highest migration version |
| `ValidationFailedError` on every insert | `allowedFields` empty | Set `protected allowedFields = ['col1', 'col2']` |
| `UniqueViolationError` on update | `rule.unique()` checks all rows | Add `.where('id', '!=', currentId)` in custom validation |
| TypeScript `any` on query results | No interface passed | Use `Bolt.table<MyInterface>('table')` |
| Changes to plugin not reflecting | `npm` cached old build | Run `npm run build` in plugin, then `npm install ../sqlite-bolt` in app |
| Capacitor build fails | `@capacitor-community/sqlite` not installed | `npm install @capacitor-community/sqlite` in app project |

---

## Quick Reference Card

```typescript
// ── Registry ──
Bolt.addConnection('default', db);
Bolt.connection('default');
Bolt.db();

// ── Standalone Builder ──
Bolt.table('users').where('x', 'y').get();
Bolt.table('users').insert(data);
Bolt.table('users').set(data).where('id', 1).update();
Bolt.table('users').where('id', 1).delete();
Bolt.query<T>(sql, params);
Bolt.execute(sql, params);

// ── Model ──
const m = new UserModel();
m.find(id);
m.findAll(where?);
m.first(where?);
m.insert(data);
m.update(id, data);
m.save(data);
m.delete(id, purge?);
m.query().where('x', 'y').get();
m.paginate(1, 20);
m.chunk(100, callback);

// ── Transaction ──
Bolt.db().transaction(async (trx) => {
  await trx.execute(sql, params);
  await trx.query(sql, params);
});

// ── Schema ──
schema.createTable('t', (t) => { t.increments('id'); t.string('name'); });
schema.alterTable('t', (t) => { t.addColumn('x', 'TEXT'); });
schema.dropTable('t');
```

---

**Status:** v1.0 Documentation Complete  
**Next:** Lock v1.1 architecture or report implementation bugs.
