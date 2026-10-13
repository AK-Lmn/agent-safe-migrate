# 🛡️ Migration Guardian (`mgcheck`)

> **Catch unsafe PostgreSQL migrations before they lock production, whether written by a human or an AI agent.**

[![npm version](https://img.shields.io/npm/v/mgcheck.svg?color=blue)](https://www.npmjs.com/package/mgcheck)
[![npm downloads](https://img.shields.io/npm/dm/mgcheck.svg?color=blue)](https://www.npmjs.com/package/mgcheck)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/Aditya31032006/agent-safe-migrate/ci.yml?branch=main)](https://github.com/Aditya31032006/agent-safe-migrate/actions)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)

```bash
npx mgcheck
```

---

## 🧭 Why Migration Guardian?

### The Problem
You can roll back application code in seconds. **A bad schema migration can take down your production database in milliseconds.**

- **Lock-Queue Pileups:** `ALTER TABLE` and standard `CREATE INDEX` acquire `ACCESS EXCLUSIVE` locks. Even when an operation finishes in seconds, existing long-running transactions block it—and every subsequent read and write queues up behind it until connection pools saturate and services crash.
- **AI Coding Agents Generate Risky DDL:** Tools like Claude Code, Cursor, Copilot, and Windsurf understand intended schemas ("add unique index on email"), but lack awareness of table cardinality and Postgres locking semantics:
  ```sql
  -- ❌ What AI coding agents commonly write:
  CREATE INDEX idx_users_email ON users(email);

  -- 💥 Production consequence:
  -- Takes an exclusive table lock. Writes block immediately.
  -- Under moderate traffic, connection pool exhausts within seconds.
  ```
- **Code Reviews Miss Them:** The syntax is valid SQL, passes local tests with 10 rows, and looks benign in a pull request diff. The catastrophe only strikes in staging or production.

### The Solution
`mgcheck` acts as an automated, multi-tiered safety gate between migration authoring and database execution:

```
                      AI Agent / Developer
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ ① AST Safety Rules (PostgreSQL C-Parser via WASM)       │
  │    • 10 zero-downtime rules (lock types, table rewrites) │
  └────────────────────────────┬────────────────────────────┘
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ ② Ephemeral Shadow Database                             │
  │    • Runs migration on in-process PGlite (WASM) or      │
  │      disposable Docker PostgreSQL (port 0, ephemeral)   │
  └────────────────────────────┬────────────────────────────┘
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ ③ Approval Watcher & Permission Gate                    │
  │    • 🟢 LOW: Auto-approved                              │
  │    • 🟡 MEDIUM: Auto-retry safe rewrite / [y/N] prompt   │
  │    • 🔴 HIGH: Strictly blocked (requires "override")    │
  └────────────────────────────┬────────────────────────────┘
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ ④ Real Target Database Application                      │
  │    • Verified DDL applied directly to target database   │
  │    • Full tamper-evident audit log in .mgcheck/audit    │
  └─────────────────────────────────────────────────────────┘
```

---

## ✨ Features

- 🔬 **Real PostgreSQL Parser:** Uses `pgsql-parser` (official PostgreSQL grammar compiled to WebAssembly) to inspect exact AST nodes, statements, and locations without fragile regular expressions.
- 🧪 **Dual Shadow Database Engine:**
  - **PGlite (WASM):** Lightweight in-memory PostgreSQL running directly inside Node.js. Zero Docker dependencies required.
  - **Docker Postgres:** Ephemeral `postgres:16-alpine` container on random ports for full fidelity with native PostgreSQL extensions.
- 🤖 **Zero-Config MCP Server:** 1-command installer auto-configures 13+ AI assistants (Cursor, Claude Code, Cline, Windsurf, Zed, Antigravity, Copilot, etc.) with `check_migration`, `analyze_migration`, and `apply_migration` tools.
- 🚦 **Dual Approval Modes (`manual` vs `auto`):** Matches Claude Code's permission model. Switch live anytime in the terminal watcher via `Shift + Tab` or `Shift + Enter`.
- 🔄 **Autonomous Agent Retry Loop:** In `auto` mode, warning-level migrations prompt the agent to generate zero-warning safe rewrites before auto-approving.
- 🔒 **Safe Target Applier:** Pre-verifies migrations against AST safety rules and shadow execution before prompting to execute against production or staging databases.
- 🪝 **Pre-Commit Hook & CI Gate:** Catch dangerous DDL at commit time via Git hooks and in CI pipelines via GitHub Actions.
- 📜 **Full Audit Logging:** Intercepted migrations, risk levels, and approval decisions logged per project to `.mgcheck/audit.jsonl`.

---

## ⚡ Quickstart

### 1. Interactive Setup & Watcher
Run the setup wizard to connect your AI editors and launch the live watcher terminal:

```bash
npx mgcheck
```

### 2. Static AST Analysis (No DB Needed)
Inspect raw `.sql` files or migration folders for dangerous lock patterns:

```bash
npx mgcheck analyze ./migrations
```

### 3. Full Shadow DB Verification
Validate AST safety and execute against an in-memory shadow PostgreSQL:

```bash
npx mgcheck run ./migrations --provider pglite
```

### 4. Auto-Fix Unsafe Migrations
Automatically rewrite unsafe SQL into zero-downtime equivalents:

```bash
npx mgcheck fix ./migrations/add-index.sql
```

---

## 🖥️ Live Terminal Watcher

When you run `npx mgcheck` or `mgcheck setup`, the terminal enters **Watcher Mode**. As your AI agent drafts migrations via MCP tools, they stream into your terminal in real time:

```text
  👁️  Guardian Active — Watching for AI migration activity...
  ─────────────────────────────────────────────────────────
  ● manual mode (shift+tab to cycle) · type /auto or /manual

  🔔 Approval Request [HIGH RISK]
  Client: Cursor (my-web-app)
  Query:  DROP TABLE "legacy_users";
  Violations:
    • [MG006] DROP TABLE is destructive and causes permanent data loss
  
  Type "override" to approve this query or press Enter to reject: _
```

### Hotkey Mode Switcher
You can toggle between **`auto`** and **`manual`** modes on the fly:
- Press **`Shift + Tab`** or **`Shift + Enter`** in the watcher terminal.
- Or type **`/auto`** or **`/manual`** and hit Enter.

---

## 🚦 Approval Modes

| Risk Level | `manual` Mode (Default) | `auto` Mode |
| :--- | :--- | :--- |
| 🟢 **LOW** (No violations) | **Auto-Approved** | **Auto-Approved** |
| 🟡 **MEDIUM** (Warnings only, e.g. missing `lock_timeout`) | **Human Confirmation** (`[y/N]`) | **Autonomous Agent Retry Loop** → Auto-Approved |
| 🔴 **HIGH** (Blocking errors, e.g. `DROP TABLE`, unindexed rewrites) | **Strictly Blocked** (requires `override`) | **Strictly Blocked** (requires `override`) |

> **Hard Guardrail:** High-risk queries are **never** auto-approved under any configuration. Destructive drops always require human intervention or the `--confirm-destructive` flag.

### Managing Modes via CLI
```bash
# View active approval mode and config source
mgcheck mode

# Set mode globally (~/.mgcheck/settings.json)
mgcheck mode auto

# Set mode for current project only (.mgcheckrc.json)
mgcheck mode manual --project

# Restrict auto-approved levels (e.g. only low risk)
mgcheck mode auto --levels low
```

---

## ⌨️ CLI Command Reference

| Command | Description |
| :--- | :--- |
| `mgcheck` · `mgcheck setup` | Detect AI agents, register MCP server, and launch the approval watcher |
| `mgcheck mode [auto\|manual]` | Inspect or update approval mode (`--project`, `--levels`) |
| `mgcheck analyze <path>` | Run fast static AST analysis against 10 safety rules (no database required) |
| `mgcheck run <path>` | Full verification: AST analysis + shadow DB run + optional target DB apply |
| `mgcheck fix <path>` | Automatically rewrite unsafe DDL to zero-downtime SQL patterns |
| `mgcheck log` · `mgcheck audit` | View intercepted query history (`--tail`, `--risk <level>`, `--json`) |
| `mgcheck hook install \| uninstall` | Install or remove the Git pre-commit hook |
| `mgcheck hook run` | Run pre-commit check on staged `.sql` files |
| `mgcheck mcp` | Launch MCP server over `stdio` (managed automatically by AI editors) |
| `mgcheck uninstall` | Cleanly unregister mgcheck from all AI tools, rule files, and hooks |

### Common Flags
```bash
# Shadow DB & execution options
mgcheck run <path> --provider pglite|docker     # Choose shadow engine (default: docker)
                   --seed schema.sql            # Seed existing schema prior to migration
                   --db-url <url>               # Use external PostgreSQL as shadow instance
                   --target-db-url <url> --apply# Apply to live database upon verification
                   --fix                        # Attempt automatic safe rewrite if unsafe
                   --confirm-destructive        # Allow DROP TABLE / DROP COLUMN statements
                   --ci                         # Machine-readable output & non-zero exit code
                   --format terminal|json|markdown
```

---

## 🛡️ The 10 Safety Rules

| Rule ID | Severity | Dangerous Pattern | Production Consequence | Zero-Downtime Safe Pattern |
| :---: | :---: | :--- | :--- | :--- |
| `MG001` | **error** | `CREATE INDEX` without `CONCURRENTLY` | Blocks all concurrent write transactions on the table. | `CREATE INDEX CONCURRENTLY` |
| `MG002` | **error** | `ALTER COLUMN TYPE` | Triggers a full table rewrite holding an `ACCESS EXCLUSIVE` lock. | Expand-Contract pattern (add new column, backfill, swap). |
| `MG003` | **error** | `ADD COLUMN ... NOT NULL` without `DEFAULT` | Fails on existing rows or locks table rewriting rows in Postgres < 11. | Add with `DEFAULT` or add nullable, backfill, then set `NOT NULL`. |
| `MG004` | **warning** | `ADD CONSTRAINT` without `NOT VALID` | Scans all rows holding a restrictive lock during validation. | Add constraint with `NOT VALID`, followed by `VALIDATE CONSTRAINT`. |
| `MG005` | **error** | `DROP COLUMN` | Irreversible data loss and breaks running application code. | Requires `--confirm-destructive` and staged deprecation. |
| `MG006` | **error** | `DROP TABLE` | Irreversible data loss and immediate application downtime. | Requires `--confirm-destructive`. |
| `MG007` | **warning** | `RENAME COLUMN` | Breaks currently running application queries during blue/green deploy. | Add new column, dual-write, backfill, deprecate old column. |
| `MG008` | **warning** | `RENAME TABLE` | Immediate breakdown of existing queries during rolling release. | Create a view aliasing the old name, then migrate traffic. |
| `MG009` | **warning** | Missing `lock_timeout` before DDL | Migration can wait forever in lock queue, starving all other queries. | `SET lock_timeout = '5s';` before table modifications. |
| `MG010` | **warning** | Missing rollback / down migration | Inability to roll back schema changes cleanly in production. | Provide companion rollback `.down.sql` script. |

---

## 🤖 Supported AI Agents & Frameworks

### 13+ Supported AI Clients (Auto-Configured)
`mgcheck` automatically detects and configures MCP tools or safety instructions for:

- **Google Antigravity**
- **Cursor**
- **Claude Code**
- **Claude Desktop**
- **Windsurf**
- **Cline**
- **Roo Code**
- **Continue.dev**
- **Zed**
- **Goose**
- **Aider**
- **OpenHands**
- **VS Code + GitHub Copilot**

#### Manual MCP Configuration
To manually connect `mgcheck` to any MCP-compliant client:

```json
{
  "mcpServers": {
    "migration-guardian": {
      "command": "npx",
      "args": ["-y", "mgcheck", "mcp"]
    }
  }
}
```

### Auto-Detected Migration Frameworks
`mgcheck` detects directory structures and metadata for:
- **Raw SQL** (`.sql` files or directories)
- **Prisma** (`prisma/migrations/*/migration.sql`)
- **Drizzle** (`drizzle/*.sql` with `meta/_journal.json`)
- **Supabase** (`supabase/migrations/*.sql`)
- **Flyway** (`V*__*.sql`)
- **Goose** (`*__*.sql`)
- **golang-migrate** (`*.up.sql` / `*.down.sql`)
- **dbmate** (`db/migrations/*.sql`)

---

## 🪝 Git Pre-Commit Hook

Protect your repository from unsafe migrations before commits are made:

```bash
# Install native pre-commit hook
npx mgcheck hook install
```

- Analyzes staged `.sql` files using fast static AST analysis.
- **Errors block commits; warnings are reported without blocking.**
- Works seamlessly with **Husky** or **Lefthook**:
  ```bash
  # In .husky/pre-commit
  npx --yes mgcheck hook run
  ```

---

## 🔄 CI / CD Integration (GitHub Actions)

Add `mgcheck` to your pull request workflows to prevent unsafe schema changes from merging:

```yaml
name: Database Migration Check

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
      - name: Verify Migrations (PGlite WASM)
        run: npx mgcheck run ./migrations --ci --provider pglite
```

---

## ⚙️ Configuration File (`.mgcheckrc.json`)

Configure default behaviors per project:

```json
{
  "approvalMode": "auto",
  "autoApprove": ["low", "medium"],
  "shadowDb": {
    "provider": "pglite"
  },
  "rules": {
    "MG009": "warning",
    "MG010": "off"
  },
  "output": {
    "format": "terminal",
    "verbose": false
  }
}
```

### Environment Variables
- `MGCHECK_MODE`: Override approval mode (`auto` or `manual`).
- `MGCHECK_PROVIDER`: Default shadow database engine (`pglite` or `docker`).
- `MGCHECK_DB_URL`: Custom PostgreSQL URL for shadow testing.

---

## 💻 Programmatic TypeScript API

You can also use Migration Guardian as a TypeScript library:

```typescript
import { analyzeMigration, runMigration } from 'mgcheck';

// Static AST analysis
const analysis = await analyzeMigration({
  content: 'CREATE INDEX idx_user ON users(email);',
});
console.log(analysis.violations); // [{ ruleId: 'MG001', severity: 'error', ... }]

// Full shadow database verification
const result = await runMigration({
  migrationPath: './migrations/001_init.sql',
  provider: 'pglite',
});
console.log(result.passed); // true | false
```

---

## 🗑️ Clean Uninstallation

`mgcheck` respects your workspace and provides a clean removal process:

```bash
npx mgcheck uninstall          # Add --purge to also delete audit logs
```

- Unregisters `migration-guardian` from all editor MCP configs.
- Removes injected instruction blocks from `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, etc.
- Restores original pre-commit hooks.
- Leaves unrelated developer settings untouched.

---

## 📄 License

MIT © 2026 Aditya & the Migration Guardian community. Open source and built for the developer community.
