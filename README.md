# sqlite-bolt

[![npm version](https://img.shields.io/npm/v/sqlite-bolt.svg)](https://www.npmjs.com/package/sqlite-bolt)
[![license](https://img.shields.io/npm/l/sqlite-bolt.svg)](./LICENSE)

A lightweight, CodeIgniter‑4‑style **Active Record ORM + fluent query builder for SQLite**.
Runs on **Capacitor** (mobile), the **Web** (sql.js / WASM with OPFS + IndexedDB persistence),
and **Electron**, behind one unified API.

- **Static registry** — register a connection once, resolve it anywhere (no manual DI).
- **Fluent QueryBuilder** — type‑optional `select / where / join / group / order / paginate`, subqueries, `EXISTS`.
- **Active Record models** — CRUD, soft deletes, timestamps, validation, lifecycle callbacks, relations.
- **Relations** — `belongsTo` / `hasMany` / `hasOne`, lazy + eager loading (N+1 prevention).
- **Offline & sync** — change tracking, offline queue, push/pull adapter with conflict strategies.
- **Safety** — identifier sanitization, parameter normalization, retry‑with‑backoff on lock errors.
- **Zero runtime dependencies** — drivers are peer dependencies you opt into.

## Installation

```bash
npm install sqlite-bolt
```

Then install the driver(s) for your platform:

```bash
# Mobile (Capacitor)
npm install @capacitor-community/sqlite

# Web (browser / testing)
npm install sql.js
```

## Quick start

```typescript
import { Bolt, BoltModel } from 'sqlite-bolt';

// 1. Create and register a connection (run once at bootstrap)
const db = await Bolt.create({
  dbName: 'app',
  driver: 'capacitor', // 'capacitor' | 'web' | 'electron'
  version: 1,
  migrations: [/* ... */],
  debug: true,
});
Bolt.addConnection('default', db);

// 2. Query anywhere via the builder
const activeUsers = await Bolt.table('users')
  .select('id', 'name')
  .where('status', 'active')
  .orderBy('created_at', 'DESC')
  .limit(10)
  .get();

// 3. Or define a model
interface User { id: number; name: string; email: string; status: string; }

class UserModel extends BoltModel<User> {
  protected table = 'users';
  protected allowedFields = ['name', 'email', 'status'];
  protected validationRules = {
    email: [rule.required(), rule.email()],
  };
}

const users = new UserModel();
const id = await users.insert({ name: 'Alice', email: 'alice@example.com', status: 'active' });
const user = await users.find(id);
```

## Validation

`validate()` follows the CodeIgniter 4 contract — it returns a boolean and collects
errors (it does **not** throw). Use `validateOrFail()` for an exception‑based flow.

```typescript
const model = new UserModel();

const id = await model.insert(data); // returns the PK, or `false` if validation fails
if (id === false) {
  console.log(model.errors()); // [{ field, rule, message }]
}

// Exception-based alternative:
await model.validateOrFail(data); // throws ValidationFailedError on failure
```

## Module formats

`sqlite-bolt` ships as CommonJS and is consumable from both `require` and ESM `import`:

```js
const { Bolt } = require('sqlite-bolt'); // CommonJS
```

```js
import { Bolt } from 'sqlite-bolt'; // ESM
```

## Documentation

- **[FEATURES.md](./FEATURES.md)** — full feature guide with examples (query builder, relations,
  scopes, events, entities, sync, plugins).
- **[USAGE.md](./USAGE.md)** — setup and usage walkthroughs.

## Building from source

```bash
npm install
npm run build   # emits dist/ (CommonJS + .d.ts)
npm run lint    # type-check only
```

## License

[MIT](./LICENSE) © pioneersingh321
