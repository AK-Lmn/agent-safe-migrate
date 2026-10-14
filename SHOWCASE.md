# 🎬 Migration Guardian Showcase

> **Real-world walkthroughs of how `mgcheck` intercepts dangerous database changes, protects production environments, and rewrites SQL into zero-downtime patterns.**

Every example and output in this guide is produced by running `mgcheck` against real PostgreSQL databases and AI assistants.

---

## ⚡ Quick Navigation

- [1. The Non-Concurrent Index Trap (`MG001`)](#1-the-non-concurrent-index-trap-mg001)
- [2. The Accidental Table Destruction (`MG006`)](#2-the-accidental-table-destruction-mg006)
- [3. The Silent Table Rewrite (`MG002`)](#3-the-silent-table-rewrite-mg002)
- [4. The Unvalidated Foreign Key Lockout (`MG004`)](#4-the-unvalidated-foreign-key-lockout-mg004)
- [5. Autonomous Agent Retry Loop (AI Self-Correction)](#5-autonomous-agent-retry-loop-ai-self-correction)
- [6. The Live Watcher Terminal & Hotkey Switcher](#6-the-live-watcher-terminal--hotkey-switcher)
- [7. Git Pre-Commit Hook & GitHub Actions CI Gate](#7-git-pre-commit-hook--github-actions-ci-gate)
- [8. Complete Before & After Safety Catalog](#8-complete-before--after-safety-catalog)

---

## 1. The Non-Concurrent Index Trap (`MG001`)

### The Scenario
You ask Cursor or Claude Code: *"Users are searching by email frequently. Please add an index to speed up lookups."*

The assistant generates:
```sql
CREATE INDEX idx_users_email ON users(email);
```

### What Happens Without Migration Guardian 💥
```
 [T+0s] AI applies migration. PostgreSQL acquires a SHARE lock on "users".
 [T+2s] Existing transactions cannot write to "users".
 [T+8s] Incoming INSERT / UPDATE / DELETE queries start queueing up.
 [T+20s] Application connection pool fills to 100% capacity.
 [T+30s] 504 Gateway Timeouts across the entire application. Outage triggered.
```

### What Happens With Migration Guardian 🛡️
Because `npx mgcheck` is connected via MCP, the AI's tool call is intercepted **before** execution:

```text
$ npx mgcheck analyze ./migrations/001_add_email_index.sql

  ❌ MG001: create-index-not-concurrent
  Line 1: CREATE INDEX idx_users_email ON users(email);

  Why this is dangerous:
    CREATE INDEX without CONCURRENTLY acquires a SHARE lock on the table,
    blocking all INSERT, UPDATE, and DELETE operations for the entire
    duration of the index build. On tables with existing traffic, this
    can freeze writes and saturate database connections.

  Suggested fix:
    Use CREATE INDEX CONCURRENTLY instead.
```

Run `npx mgcheck fix` or let the AI rewrite it automatically:

```diff
+ SET lock_timeout = '5s';
+
- CREATE INDEX idx_users_email ON users(email);
+ CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);
```

**Result:** The index is built in the background without blocking concurrent writes, queries execute smoothly, and zero downtime occurs.

---

## 2. The Accidental Table Destruction (`MG006`)

### The Scenario
During a feature cleanup, an AI assistant refactors schema files and generates a cleanup migration:

```sql
DROP TABLE legacy_user_sessions;
```

### The Safety Gate in Action 🛑
`DROP TABLE` is classified as 🔴 **HIGH RISK**. Migration Guardian **never** auto-approves this under any mode or configuration.

Your interactive watcher terminal displays:

```text
  ┌─────────────────────────────────────────────────────────┐
  │  📋 MIGRATION INTERCEPTED                               │
  └─────────────────────────────────────────────────────────┘

  ┌── Details ──────────────────────────────────────────────
  │  Timestamp  : Oct 13, 2026, 05:08:39 PM
  │  Audit ID   : mg-mv6ly113-1ygy
  │  Project    : web-api
  │  Risk Level : 🔴 HIGH
  │               Contains blocking errors — stays blocked unless you type "override"
  │
  ├── SQL Query ────────────────────────────────────────────
  │  1 │ DROP TABLE legacy_user_sessions;
  │
  ├── Violations ──────────────────────────────────────────
  │  ✗ ERROR   [MG006] (line 1)
  │    ⚠️  DESTRUCTIVE: DROP TABLE permanently deletes the table and ALL its
  │    data. This operation is irreversible. All foreign keys, indexes,
  │    triggers, and policies associated with this table will also be
  │    removed.
  │
  ├── Summary ─────────────────────────────────────────────
  │  1 error  ·  0 warnings
  └────────────────────────────────────────────────────────

  🔴 BLOCKED as HIGH risk. Type override to apply it to your database anyway, or press Enter to keep it blocked: 
```

### Why This Protects You
- If you hit **Enter**, **Esc**, or type **`y`**, the query **remains strictly blocked**.
- Only typing the literal word **`override`** allows the migration through.
- Accidental keystrokes cannot drop production tables.

---

## 3. The Silent Table Rewrite (`MG002`)

### The Scenario
An AI changes a column definition in Prisma or Drizzle:
```sql
ALTER TABLE users ALTER COLUMN age TYPE bigint;
```

### The Hidden Danger
In PostgreSQL, altering a column's data type requires rewriting **every single tuple on disk** while holding an `ACCESS EXCLUSIVE` lock. On a table with millions of rows, this can take hours and lock out all reads and writes.

### Safe Zero-Downtime Rewrite (Expand-Contract Pattern)
Migration Guardian auto-suggests or generates the phased expand-contract pattern:

```diff
- ALTER TABLE users ALTER COLUMN age TYPE bigint;
+ -- Step 1: Add new column without locking
+ ALTER TABLE users ADD COLUMN age_new bigint;
+
+ -- Step 2: Backfill existing rows in non-blocking batches
+ UPDATE users SET age_new = age::bigint WHERE age_new IS NULL;
+
+ -- Step 3: Switch application code to read/write age_new, then drop old column in subsequent release.
```

---

## 4. The Unvalidated Foreign Key Lockout (`MG004`)

### The Scenario
Adding a foreign key constraint to an existing active table:
```sql
ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id);
```

### The Risk
PostgreSQL must scan every row in `orders` to ensure integrity, holding a `SHARE ROW EXCLUSIVE` lock that blocks writes throughout the scan.

### The Zero-Downtime Pattern
Migration Guardian breaks this into an instant constraint creation followed by asynchronous validation:

```diff
- ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id);
+ -- 1. Add constraint instantly without table scan
+ ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;
+
+ -- 2. Validate rows in background without blocking concurrent writes
+ ALTER TABLE orders VALIDATE CONSTRAINT fk_orders_user;
```

---

## 5. Autonomous Agent Retry Loop (AI Self-Correction)

When running in **`auto` mode**, Migration Guardian detects fixable warning-level violations (🟡 MEDIUM risk) and guides the AI assistant to rewrite the query autonomously before prompting you.

```
 AI Assistant               Migration Guardian              Shadow Postgres
      │                             │                              │
      │ ── 1. check_migration ────▶ │                              │
      │    (missing lock_timeout)   │                              │
      │                             │ ── 2. Run AST & Shadow ────▶ │
      │ ◀─ 3. auto_retry ────────── │    (Warning: MG009)          │
      │    (Fix suggestion)         │                              │
      │                             │                              │
      │ ── 4. Retry with Fix ─────▶ │                              │
      │    (adds lock_timeout)      │ ── 5. Re-verify Clean ─────▶ │
      │                             │                              │
      │ ◀─ 6. auto_allowed ──────── │ (Zero warnings · Approved!)  │
```

The terminal displays the before/after auto-correction cleanly:

```text
  ⚡ [Attempt 2/4] Intercepted unsafe migration — guiding AI agent to rewrite with safe patterns...
  ⚡ MEDIUM RISK — AUTO-APPROVED (auto mode)
  via check_migration · my-saas-app
```

---

## 6. The Live Watcher Terminal & Hotkey Switcher

Run `npx mgcheck` in any terminal window. It stays active as a companion HUD while you code in your favorite IDE:

```text
  👁️  Guardian Active — Watching for AI migration activity...
  Press Ctrl+C to stop.
  ─────────────────────────────────────────────────────────
  ● manual mode (shift+tab to cycle) · type /auto or /manual
```

### Instant Live Switching
- Press **`Shift + Tab`** or **`Shift + Enter`** anytime to toggle between **AUTO** and **MANUAL** modes.
- Or type **`/auto`** or **`/manual`** and press Enter.
- No need to restart editors or reload config files.

---

## 7. Git Pre-Commit Hook & GitHub Actions CI Gate

### 1. Developer Machine (Pre-Commit Hook)
Install with one command:
```bash
npx mgcheck hook install
```
Every `git commit` checks staged `.sql` files with local AST parsing:
- 🔴 **Errors block the commit** with instant terminal explanations and suggested fixes.
- 🟡 **Warnings are reported** to inform the developer without interrupting flow.
- Works natively with **Husky** and **Lefthook**:
  ```bash
  npx --yes mgcheck hook run
  ```

### 2. CI/CD Pipeline (GitHub Actions)
Prevent unsafe migrations from ever merging to `main`:

```yaml
name: Database Migration Guardian

on:
  pull_request:
    paths:
      - 'migrations/**'
      - 'prisma/migrations/**'
      - 'drizzle/**'

jobs:
  verify-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Verify Zero-Downtime Safety (PGlite WASM)
        run: npx mgcheck run ./migrations --ci --provider pglite
```

---

## 8. Complete Before & After Safety Catalog

| Rule ID | Severity | What It Catches | Unsafe Pattern | Safe Zero-Downtime Rewrite |
| :---: | :---: | :--- | :--- | :--- |
| `MG001` | **error** | `CREATE INDEX` without `CONCURRENTLY` | `CREATE INDEX idx_email ON users(email);` | `CREATE INDEX CONCURRENTLY idx_email ON users(email);` |
| `MG002` | **error** | `ALTER COLUMN TYPE` (table rewrite) | `ALTER TABLE t ALTER COLUMN c TYPE bigint;` | Add new column `c_new`, backfill asynchronously, cut over. |
| `MG003` | **error** | `ADD COLUMN ... NOT NULL` without `DEFAULT` | `ALTER TABLE t ADD COLUMN role text NOT NULL;` | `ALTER TABLE t ADD COLUMN role text DEFAULT 'user' NOT NULL;` |
| `MG004` | **warning** | Constraint without `NOT VALID` | `ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY...;` | Add with `NOT VALID`, then run `VALIDATE CONSTRAINT`. |
| `MG005` | **error** | `DROP COLUMN` | `ALTER TABLE t DROP COLUMN legacy_col;` | Staged deprecation; requires `--confirm-destructive`. |
| `MG006` | **error** | `DROP TABLE` | `DROP TABLE legacy_users;` | Staged backup; requires typing `override`. |
| `MG007` | **warning** | `RENAME COLUMN` | `ALTER TABLE t RENAME COLUMN a TO b;` | Dual-write pattern / backward-compatible view alias. |
| `MG008` | **warning** | `RENAME TABLE` | `ALTER TABLE old_name RENAME TO new_name;` | Create a view aliasing `old_name` pointing to `new_name`. |
| `MG009` | **warning** | Missing `lock_timeout` before DDL | `ALTER TABLE users ADD COLUMN bio text;` | Prepend `SET lock_timeout = '5s';` |
| `MG010` | **warning** | Missing rollback / down migration | Migration has no companion down step | Provide companion `.down.sql` script. |
| `MG011` | **error** | `TRUNCATE` | `TRUNCATE users;` | Delete specific rows in batches; requires `--confirm-destructive`. |
| `MG012` | **error** | `DROP SCHEMA` | `DROP SCHEMA public CASCADE;` | Drop objects one by one after review; requires `--confirm-destructive`. |
| `MG013` | **error** | `DROP DATABASE` | `DROP DATABASE prod;` | Never in a migration; requires `--confirm-destructive`. |
| `MG014` | **warning** | SQL the parser can't read | `CREAT TABLE x (id int);` | Fix the typo, or verify with `mgcheck run`. |

---

## 🙌 Join the Community Showcase

Are you using `mgcheck` to guard database migrations for your startup, open-source project, or engineering team?

We would love to feature your project here! Submit a pull request or open an issue on GitHub:
👉 [GitHub Repository](https://github.com/Aditya31032006/agent-safe-migrate)
