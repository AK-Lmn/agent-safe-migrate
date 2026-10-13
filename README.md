# 🛡️ Migration Guardian (`mgcheck`)

### A safety net for your database.
**Stops AI coding assistants (and humans) from running database changes that freeze your app or wipe your data.**

[![npm version](https://img.shields.io/npm/v/mgcheck.svg?color=blue)](https://www.npmjs.com/package/mgcheck)
[![npm downloads](https://img.shields.io/npm/dm/mgcheck.svg?color=blue)](https://www.npmjs.com/package/mgcheck)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/Aditya31032006/agent-safe-migrate/ci.yml?branch=main)](https://github.com/Aditya31032006/agent-safe-migrate/actions)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

```bash
npx mgcheck
```

<sub>No install needed. You just need <a href="https://nodejs.org/">Node.js 18+</a>.</sub>

---

## 🤖 Works with

**Database:** PostgreSQL (MySQL, SQLite and ClickHouse on the roadmap)

**AI assistants (connected automatically):**
Google Antigravity · Cursor · Claude Code · Claude Desktop · Windsurf · Cline · Roo Code · Continue.dev · Zed · Goose · Aider · OpenHands · VS Code + GitHub Copilot

**Migration tools (detected automatically):**
Raw SQL · Prisma · Drizzle · Supabase · Flyway · Goose · golang-migrate · dbmate

<details>
<summary><b>Connect any other MCP client manually</b></summary>

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
</details>

---

## ⏱️ In 30 seconds

Think of `mgcheck` as **a spell-checker and a seatbelt for database changes.**

- **The risk:** a database change (a *migration*) can look harmless and still **freeze your whole app** or **permanently delete data** the moment it runs on real traffic.
- **Why it's getting worse:** AI assistants such as Cursor, Claude Code, Copilot and Windsurf now write these changes for you. They write correct SQL, but they don't know how big your tables are or how Postgres locks them.
- **What mgcheck does:**
  1. 🔍 **Checks** every change against 10 proven safety rules
  2. 🧪 **Test-runs** it on a throwaway copy of Postgres, so your real data is never touched
  3. 🙋 **Asks you** before anything risky, and **blocks** anything dangerous
  4. ✅ **Applies** it to your real database only after it passes and you say yes

One command connects it to your AI assistants. After that, they check with mgcheck automatically.

---

## 👀 See it in action

Your AI assistant writes this, which looks perfectly fine:

```sql
CREATE INDEX idx_users_email ON users(email);
```

mgcheck catches it before it ever reaches your database:

```text
$ npx mgcheck analyze ./migrations

  ❌ MG001: create-index-not-concurrent
  Line 1: CREATE INDEX idx_users_email ON users(email)

  Why this is dangerous:
    CREATE INDEX without CONCURRENTLY acquires a SHARE lock on the table,
    blocking all INSERT, UPDATE, and DELETE operations for the entire
    duration of the index build. On a table with millions of rows, this
    can block writes for minutes or hours.

  Suggested fix:
    Use CREATE INDEX CONCURRENTLY instead.
```

In plain terms, nobody could sign up or update their profile until the index finished building.

**The fix is one word: `CONCURRENTLY`.** Run `npx mgcheck fix` and it rewrites the migration for you:

```diff
- CREATE INDEX idx_users_email ON users(email);
+ CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
```

And while you code, the **watcher terminal** shows everything your AI tries to run:

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

---

## 📦 Install

Pick whichever suits you. All three run the same tool.

| Way | Command | Then run it with |
| :--- | :--- | :--- |
| **No install** (recommended) | *nothing to install* | `npx mgcheck …` |
| **Global** (use it everywhere) | `npm install -g mgcheck` | `mgcheck …` |
| **Per project** (pin the version for your team) | `npm install -D mgcheck` | `npx mgcheck …` or an npm script |

An npm script for a per-project install:

```json
{
  "scripts": {
    "db:check": "mgcheck analyze ./migrations"
  }
}
```

```bash
npm run db:check
```

> 💡 Every example below uses `npx mgcheck`. If you installed globally, you can drop the `npx`.

---

## ⚡ Quickstart

| I want to… | Run this |
| :--- | :--- |
| **Protect my AI assistant** (connect it and start the watcher) | `npx mgcheck` |
| **Check my migration files** (fast, no database needed) | `npx mgcheck analyze ./migrations` |
| **Check and test-run them** on a throwaway Postgres (no Docker needed) | `npx mgcheck run ./migrations --provider pglite` |
| **Fix an unsafe migration automatically** | `npx mgcheck fix ./migrations/add-index.sql` |
| **Block unsafe migrations from being committed** | `npx mgcheck hook install` |
| **See what my AI tried to run** | `npx mgcheck log` |

> 🔁 Keep the `npx mgcheck` terminal open while you code. It's where you approve or reject what your AI wants to run.

---

## 🚦 Approval modes

You choose how much mgcheck asks you, much like Claude Code's permission modes.

| Risk level | What it means | `manual` mode (default) | `auto` mode |
| :--- | :--- | :--- | :--- |
| 🟢 **LOW** | Safe. No problems found | Runs automatically | Runs automatically |
| 🟡 **MEDIUM** | Probably fine, with warnings (e.g. no time limit on locks) | **Asks you** `[y/N]` | AI is asked to fix the warnings first, then it runs automatically |
| 🔴 **HIGH** | Dangerous (e.g. deletes a table, locks writes) | **Blocked**. Type `override` to allow | **Blocked**. Type `override` to allow |

> 🔒 **HIGH-risk changes are never auto-approved**, whatever your settings. AI assistants also can't change the mode themselves. Only you can.

```bash
npx mgcheck mode                    # show the current mode and where it's set
npx mgcheck mode auto               # switch everywhere (~/.mgcheck/settings.json)
npx mgcheck mode manual --project   # switch for this project only (.mgcheckrc.json)
npx mgcheck mode auto --levels low  # auto-approve only 🟢 LOW
```

In the watcher terminal, press **`Shift + Tab`** (or type `/auto` / `/manual`) to switch modes live.

---

## ⌨️ All commands

| Command | What it does |
| :--- | :--- |
| `npx mgcheck` · `npx mgcheck setup` | Find your AI assistants, connect them, and open the approval watcher |
| `npx mgcheck mode [auto\|manual]` | Show or change the approval mode (`--project`, `--levels`) |
| `npx mgcheck analyze <path>` | Fast check against the 10 safety rules. No database needed |
| `npx mgcheck run <path>` | Full check: rules + test run on a throwaway DB, optionally apply to your real DB |
| `npx mgcheck fix <path>` | Rewrite unsafe SQL into a safe version and test it |
| `npx mgcheck log` · `npx mgcheck audit` | History of everything your AI tried to run (`--tail`, `--risk high`, `--json`) |
| `npx mgcheck hook install` · `hook uninstall` | Add or remove the Git pre-commit check |
| `npx mgcheck hook run` | Check staged `.sql` files right now |
| `npx mgcheck mcp` | Start the MCP server (your AI editor runs this itself) |
| `npx mgcheck uninstall` | Remove mgcheck from every AI tool, rule file and Git hook |

<details>
<summary><b>Useful flags</b></summary>

```bash
# run
npx mgcheck run <path> --provider pglite|docker      # test engine: pglite needs no Docker (default: docker)
                       --seed schema.sql             # load your existing schema first
                       --db-url <url>                # use your own Postgres as the throwaway test DB
                       --target-db-url <url> --apply # apply to the real DB once it passes
                       --fix                         # offer a tested auto-fix if unsafe
                       --confirm-destructive         # allow DROP TABLE / DROP COLUMN
                       --ci                          # JSON output + non-zero exit code on failure
                       --format terminal|json|markdown

# setup / uninstall
npx mgcheck setup --client cursor|claude-code|cline|zed|...   # connect one assistant only
npx mgcheck setup --mode auto        # pick the approval mode during setup
npx mgcheck setup --with-rules       # also write CLAUDE.md, AGENTS.md, .cursorrules, …
npx mgcheck uninstall -y             # skip the confirmation prompt
npx mgcheck uninstall --purge        # also delete audit logs

# log
npx mgcheck log --tail               # live stream
npx mgcheck log --risk high --json   # filter / raw output
npx mgcheck log --global             # machine-wide log (~/.mgcheck)
```
</details>

---

## 🛡️ The 10 safety rules

| Rule | Level | Catches | In plain English | Safe way |
| :---: | :---: | :--- | :--- | :--- |
| `MG001` | 🔴 error | `CREATE INDEX` without `CONCURRENTLY` | Adding a search index freezes writes to the table | `CREATE INDEX CONCURRENTLY` |
| `MG002` | 🔴 error | `ALTER COLUMN TYPE` | Changing a column's type rewrites the whole table while locked | Add a new column, copy the data, switch over |
| `MG003` | 🔴 error | `ADD COLUMN … NOT NULL` without `DEFAULT` | A required column with no default breaks on existing rows | Add a `DEFAULT` |
| `MG004` | 🟡 warning | `ADD CONSTRAINT` without `NOT VALID` | Checks every row while holding a lock | `NOT VALID`, then `VALIDATE CONSTRAINT` |
| `MG005` | 🔴 error | `DROP COLUMN` | Permanently deletes data and breaks code still using it | Needs explicit confirmation |
| `MG006` | 🔴 error | `DROP TABLE` | Permanently deletes a whole table | Needs explicit confirmation |
| `MG007` | 🟡 warning | `RENAME COLUMN` | Running app code still uses the old name and breaks | Add new, copy, then remove old |
| `MG008` | 🟡 warning | `RENAME TABLE` | Same as above, for a table | Keep a view with the old name |
| `MG009` | 🟡 warning | No `lock_timeout` | A change stuck waiting for a lock can block every other query | `SET lock_timeout = '5s';` |
| `MG010` | 🟡 warning | No rollback file | No easy undo if something goes wrong | Add a `.down.sql` (skipped for Prisma, Supabase, Drizzle) |

<details>
<summary><b>How it works under the hood</b></summary>

```
                      AI Agent / Developer
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ ① Safety rules: real PostgreSQL parser (WASM), 10 rules │
  └────────────────────────────┬────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ ② Shadow DB: throwaway Postgres (PGlite in-process or   │
  │    a disposable Docker container) runs the migration    │
  └────────────────────────────┬────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ ③ Human gate: 🟢 runs · 🟡 asks / auto-fixes ·           │
  │    🔴 blocked unless you type "override"                │
  └────────────────────────────┬────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ ④ Apply to your real DB, logged to .mgcheck/audit.jsonl │
  └─────────────────────────────────────────────────────────┘
```

- **Parser:** `pgsql-parser` uses the official PostgreSQL grammar compiled to WebAssembly, so the checks don't depend on fragile regexes.
- **Shadow DB:** [PGlite](https://pglite.dev) runs Postgres inside Node with no Docker needed. Docker mode uses `postgres:16-alpine` on a random port.
- **AI integration:** an MCP server gives your assistant three tools: `check_migration`, `analyze_migration` and `apply_migration`. `apply_migration` always requires your approval.
</details>

---

## 🪝 Git pre-commit hook

```bash
npx mgcheck hook install
```

- Checks staged `.sql` files on every commit. It's quick and needs no database.
- **Errors block the commit. Warnings are shown but don't block it.**
- Using **Husky** or **Lefthook**? Add this line to your pre-commit hook:
  ```bash
  npx --yes mgcheck hook run
  ```
- It only runs where it's installed, and anyone can skip it with `--no-verify`. Use CI as the real gate.

---

## 🔄 CI (GitHub Actions)

Stop unsafe migrations from being merged:

```yaml
name: Database Migration Check
on:
  pull_request:
    paths: ['migrations/**', 'prisma/migrations/**', 'drizzle/**']

jobs:
  verify-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx mgcheck run ./migrations --ci --provider pglite
```

---

## ⚙️ Configuration (optional)

Everything works without a config file. To change the defaults, add `.mgcheckrc.json` to your project:

```json
{
  "approvalMode": "auto",
  "autoApprove": ["low", "medium"],
  "shadowDb": { "provider": "pglite" },
  "rules": { "MG009": "warning", "MG010": "off" }
}
```

| Environment variable | Purpose |
| :--- | :--- |
| `MGCHECK_MODE` | `auto` or `manual` (overrides config files) |
| `MGCHECK_AUTO_APPROVE` | e.g. `low` or `low,medium` |
| `MGCHECK_PROVIDER` | Test engine: `pglite` or `docker` |
| `MGCHECK_DB_URL` | Use your own Postgres as the throwaway test DB |
| `MGCHECK_DOCKER_IMAGE` | Docker image for the test DB (default `postgres:16-alpine`) |

<details>
<summary><b>Use it from code (TypeScript / JavaScript)</b></summary>

```bash
npm install mgcheck
```

```typescript
import { runCheck, loadConfig } from 'mgcheck';

const config = loadConfig();
config.shadowDb.provider = 'pglite';

// 'analyze' = rules only, 'run' = rules + test run on a throwaway DB
const report = await runCheck('./migrations', config, 'run');

console.log(report.passed);      // true | false
console.log(report.violations);  // [{ ruleId: 'MG001', severity: 'error', message: '…' }]
```
</details>

---

## ❓ FAQ

**Do I need Docker?**
No. Add `--provider pglite` and mgcheck runs a full Postgres inside Node.

**Will it touch my real database?**
Only if you ask it to (`--apply`, or your AI calls `apply_migration`), and only after the change passes and you approve it. Everything else runs on a throwaway copy.

**Do I need to know SQL or Postgres?**
No. Every problem comes with a plain-English explanation and a safe fix, and `npx mgcheck fix` can rewrite it for you.

**Does it slow my AI down?**
A static check takes well under a second. In `auto` mode, safe changes don't wait for you at all.

**Which databases are supported?**
PostgreSQL today. MySQL, SQLite and ClickHouse are on the roadmap.

---

## 🗑️ Uninstall

```bash
npx mgcheck uninstall           # add --purge to also delete audit logs
npm uninstall -g mgcheck        # only if you installed it globally
```

This removes only mgcheck's own entries. Your other editor settings stay untouched, and any Git hook you had before is restored. Restart your editors afterwards.

---

## 🗺️ Roadmap

- [x] Safety rules, PGlite/Docker shadow DB, MCP server, auto-fix, approval modes, real-DB apply
- [ ] AI fix-and-re-verify loop
- [ ] MySQL, SQLite and ClickHouse support

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## 📄 License

MIT © 2026 Aditya Gandhi
