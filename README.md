<p align="center">
  <img src="./assets/sqlite-bolt-banner.png" alt="sqlite-bolt Banner" width="100%" style="max-width: 800px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);" />
</p>

<h1 align="center">⚡ sqlite-bolt (@bolt/sqlite)</h1>

<p align="center">
  <b>A CodeIgniter 4-style Active Record ORM & Fluent Query Builder for SQLite</b><br>
  <i>Runs on Mobile (Capacitor), Web (sql.js / WASM), Electron, and Native Android background services.</i>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge" alt="MIT License" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.4-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5.4" /></a>
  <a href="https://github.com/capacitor-community/sqlite"><img src="https://img.shields.io/badge/Capacitor-SQLite%20v8-119DFF.svg?style=for-the-badge&logo=capacitor&logoColor=white" alt="Capacitor" /></a>
  <a href="https://sql.js.org/"><img src="https://img.shields.io/badge/Web-sql.js%20WASM-FF6600.svg?style=for-the-badge&logo=webassembly&logoColor=white" alt="WASM" /></a>
</p>

---

## 🚀 Overview

`sqlite-bolt` (`@bolt/sqlite`) brings CodeIgniter 4's developer experience, query building power, and Active Record simplicity to TypeScript and modern JavaScript apps. 

Engineered for cross-platform SQLite storage, it provides a single unified API across **Mobile apps (Capacitor for iOS/Android)**, **Web applications (sql.js WASM with OPFS + IndexedDB fallback)**, **Desktop apps (Electron)**, and **Native Android services (Java / Kotlin)**.

---

## ✨ Features at a Glance

| Feature | Description |
| :--- | :--- |
| ⚡ **Static Registry (`Bolt`)** | Register connection parameters once at application bootstrap and resolve globally everywhere without manual DI boilerplate. |
| 🔍 **Fluent QueryBuilder** | Full chainable query builder supporting `select`, `where`, `whereIn`, `join`, `groupBy`, `having`, `orderBy`, `paginate`, `limit`, `offset`, subqueries, and `EXISTS`. |
| 🗄️ **CI4 Active Record Models** | Feature-rich `BoltModel<T>` base class with CRUD helpers, timestamps, soft deletes, data validation rules, and lifecycle callbacks (`beforeInsert`, `afterInsert`, etc.). |
| 🔗 **Relations & Eager Loading** | Express `belongsTo`, `hasMany`, and `hasOne` relations with automated eager loading (`with()`) to eliminate N+1 database performance bottlenecks. |
| 🔄 **Offline & Sync Engine** | Built-in mutation tracking (`_bolt_changes`), deduplicated offline queue, background sync scheduler, and conflict resolution strategies. |
| 📱 **Native Android Integration** | Built-in Java & Kotlin helper [`BoltNativeDb`](#native-android-java--kotlin) to query and update the SQLite database directly from Android background/foreground services. |
| 🛡️ **Safety & Lock Retry** | Automatic parameter normalization, identifier sanitization, query planning (`explain()`), and retry with exponential backoff on SQLite lock errors. |
| 🛠️ **Schema & Migrations** | Versioned schema migration engine (`up`/`down`) alongside database metadata introspection (`tables`, `columns`, `indexes`, `foreignKeys`). |

---

## 📦 Installation

Install `@bolt/sqlite` directly from the Git repository:

```bash
npm install git+https://github.com/pioneersingh321/sqlite-bolt.git
```

Or when installed from package manager:

```bash
npm install @bolt/sqlite
```

### Peer Dependencies (Drivers)

Install the driver corresponding to your target platform:

```bash
# Mobile (Capacitor for iOS / Android)
npm install @capacitor-community/sqlite

# Web (Browser WASM / Node / Testing)
npm install sql.js
```

---

## ⚡ Quick Start

### 1. Register Database Connection

Bootstrap the connection once during application startup (e.g. `main.ts` or `bootstrap.ts`):

```typescript
import { Bolt } from '@bolt/sqlite';

const db = await Bolt.create({
  dbName: 'app_v1',
  driver: 'capacitor', // Options: 'capacitor' | 'web' | 'electron'
  version: 1,
  migrations: [/* migration objects */],
  debug: true, // Output compiled SQL and execution duration
});

Bolt.addConnection('default', db);
```

### 2. Standalone QueryBuilder

Query tables anywhere directly without defining models:

```typescript
import { Bolt } from '@bolt/sqlite';

// Fetch active users with pagination
const users = await Bolt.table('users')
  .select('id', 'name', 'email')
  .where('status', 'active')
  .whereIn('role', ['admin', 'manager'])
  .orderBy('created_at', 'DESC')
  .limit(10)
  .get();

// JOIN query
const pendingOrders = await Bolt.table('orders')
  .select('orders.id', 'orders.total', 'users.name as customer_name')
  .join('users', 'orders.user_id = users.id')
  .where('orders.status', 'pending')
  .get();
```

### 3. CI4 Active Record Model

Define models with validation rules, soft deletes, and callbacks:

```typescript
import { BoltModel, rule } from '@bolt/sqlite';

export interface User {
  id: number;
  name: string;
  email: string;
  status: 'active' | 'suspended';
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export class UserModel extends BoltModel<User> {
  protected override table = 'users';
  protected override primaryKey = 'id';
  protected override allowedFields = ['name', 'email', 'status'];
  protected override softDelete = true;
  protected override timestamps = true;

  protected override validationRules = {
    name: [rule.required(), rule.minLength(2)],
    email: [rule.required(), rule.email()],
    status: [rule.inArray(['active', 'suspended'])],
  };

  // Callback: Modify data before insert
  protected override async beforeInsert(data: Partial<User>) {
    if (data.email) data.email = data.email.toLowerCase().trim();
    return data;
  }
}

// Model usage
const users = new UserModel();
const userId = await users.insert({
  name: 'Alice',
  email: 'Alice@example.com',
  status: 'active',
});

const user = await users.find(userId);
```

> **Note on TypeScript Strict Mode (`noImplicitOverride`):** Modern Angular & Ionic projects require the `override` modifier when `"noImplicitOverride": true` is enabled in `tsconfig.json`.

---

## 📱 Native Android (Java / Kotlin)

When running inside Android background services (Foreground Services, `AlarmManager`, or `BroadcastReceiver`), you can read and write to your SQLite database directly without starting the JavaScript thread:

### Java
```java
import com.bolt.sqlite.BoltNativeDb;

// Fetch setting value directly in background service
String flag = BoltNativeDb.open(context, "app_v1")
    .getValue("settings", "value", "option", "sync_enabled");
```

### Kotlin
```kotlin
import com.bolt.sqlite.BoltNativeDb

// Query rows as JSON Array in Kotlin
val users = BoltNativeDb.open(context, "app_v1")
    .queryJSON("SELECT * FROM users WHERE status = ?", arrayOf("active"))
```

---

## 📚 Complete Documentation

For detailed walkthroughs, setup guides, and comprehensive API references, see:

- 📖 **[USAGE.md](./USAGE.md)** — Detailed usage manual, setup guide, query builder options, model features, migrations, sync, and troubleshooting.
- 💡 **[FEATURES.md](./FEATURES.md)** — Complete feature overview with code snippets.

---

## 📄 License

This software is released under the **MIT License**.

```
MIT License

Copyright (c) 2026 pioneersingh321

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM/ENDANGERED LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

For full details, view the official [LICENSE](./LICENSE) file.
