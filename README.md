# 🛡️ Migration Guardian (`mgcheck`)

> **Catch unsafe PostgreSQL migrations before they lock production, whether a human or an AI agent wrote them.**

[![npm version](https://img.shields.io/npm/v/mgcheck.svg?color=blue)](https://www.npmjs.com/package/mgcheck)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/Aditya31032006/agent-safe-migrate/ci.yml?branch=main)](https://github.com/Aditya31032006/agent-safe-migrate/actions)

```bash
npx mgcheck
```

---

## 🧭 Why this exists

### The problem

You can roll back application code in seconds. A bad schema migration is much harder to undo.

- **Lock queue pile-ups.** `ALTER TABLE` and plain `CREATE INDEX` take heavy locks. While a migration waits for its lock, Postgres queues every new query behind it. The connection pool fills up and the app goes down, even though the SQL itself was valid.
- **AI agents write migrations now.** Cursor, Claude Code, Copilot and Windsurf understand what you want ("add an index on email"). They don't know how big the table is or how Postgres locks work, so they make the same mistakes over and over:
  - `CREATE INDEX` without `CONCURRENTLY`, which blocks writes
  - `ALTER COLUMN TYPE`, which rewrites the whole table under an exclusive lock
  - no `lock_timeout`
  - `DROP`s that nobody approved
- **Reviews miss these.** The SQL looks fine in a diff. The danger only shows up at deploy time, on real data.

### The solution

`mgcheck` adds a verification gate between your migration and your database:

```
 AI agent / developer
         │
         ▼
 ① AST rule check  ──── real Postgres parser (WASM) + 10 zero-downtime rules
         │
         ▼
 ② Shadow DB run   ──── runs the migration on a disposable Postgres (PGlite or Docker)
         │
         ▼
 ③ Human gate      ──── 🔴 high risk: auto-blocked · 🟡/🟢 asks you to approve
         │
         ▼
 ④ Apply           ──── runs on your real DB only after it is verified and you approve
```

- **Auto-fix:** rewrites unsafe SQL into zero-downtime patterns and checks the rewrite on the shadow DB.
- **MCP server:** 13 AI agents call `check_migration`, `analyze_migration` and `apply_migration` as tools.
- **Audit trail:** every intercepted query is logged to `<project>/.mgcheck/audit.jsonl`.
- **Git hook and CI gate:** unsafe `.sql` files are stopped before they're committed or merged.

---

## ⚡ Quickstart

```bash
npx mgcheck                                    # detect your AI agents, connect them, start the approval watcher
npx mgcheck analyze ./migrations               # static check, no database needed
npx mgcheck run ./migrations --provider pglite # check + run on an in-process shadow Postgres
```

---

## ⌨️ Commands

| Command | What it does |
| :--- | :--- |
| `mgcheck` · `mgcheck setup` | Setup wizard: detects AI agents, configures MCP, then watches for approval requests |
| `mgcheck analyze <path>` | Static AST check against the 10 rules (no database needed) |
| `mgcheck run <path>` | AST check + run on a shadow DB, and optionally apply to the real DB |
| `mgcheck fix <path>` | Auto-rewrite unsafe SQL into zero-downtime form, verified on the shadow DB |
| `mgcheck log` · `mgcheck audit` | View intercepted queries for the current project |
| `mgcheck hook install \| uninstall` | Add or remove the Git pre-commit hook. It blocks commits with unsafe staged `.sql` files; warnings don't block |
| `mgcheck hook run` | Check staged `.sql` files now. With Husky or Lefthook, add `npx --yes mgcheck hook run` to your pre-commit hook |
| `mgcheck mcp` | Start the MCP server (stdio). AI agents launch this themselves |
| `mgcheck uninstall` | Remove mgcheck from every agent config, rule file and Git hook |

<details>
<summary><b>Useful flags</b></summary>

```bash
# run
mgcheck run <path> --provider pglite|docker   # shadow DB engine (default: docker)
                   --seed schema.sql          # load your existing schema first
                   --db-url <url>             # use an existing Postgres as the shadow DB
                   --target-db-url <url> --apply  # apply to the real DB once verified
                   --fix                      # offer a verified auto-fix if unsafe
                   --ci                       # JSON output + non-zero exit code on failure
                   --format terminal|json|markdown
                   --confirm-destructive      # allow DROP TABLE / DROP COLUMN

# setup / uninstall
mgcheck setup --client cursor|claude-code|cline|zed|...   # one agent only
mgcheck setup --with-rules        # also write CLAUDE.md, AGENTS.md, .cursorrules, …
mgcheck uninstall -y              # no confirmation prompt
mgcheck uninstall --purge         # also delete audit logs and the .gitignore entry

# log
mgcheck log --tail                # live stream
mgcheck log --risk high --json    # filter / raw output
mgcheck log --global              # machine-wide log (~/.mgcheck)
```
</details>

---

## 🛡️ Safety rules

| ID | Severity | Catches | Safe pattern |
| :--- | :---: | :--- | :--- |
| `MG001` | error | `CREATE INDEX` without `CONCURRENTLY` | `CREATE INDEX CONCURRENTLY` |
| `MG002` | error | `ALTER COLUMN TYPE` (full table rewrite) | Expand / contract |
| `MG003` | error | `ADD COLUMN … NOT NULL` with no default | Add a `DEFAULT` |
| `MG004` | warning | Constraint that scans every row under lock | `NOT VALID`, then `VALIDATE` |
| `MG005` | error | `DROP COLUMN` | Needs `--confirm-destructive` |
| `MG006` | error | `DROP TABLE` | Needs `--confirm-destructive` |
| `MG007` | warning | `RENAME COLUMN` (breaks running code) | Expand / contract |
| `MG008` | warning | `RENAME TABLE` (breaks running code) | View alias |
| `MG009` | warning | No `lock_timeout` before risky DDL | `SET lock_timeout = '5s';` |
| `MG010` | warning | No down migration (skipped for Prisma, Supabase and Drizzle, which have no down step) | Add a rollback file |

---

## 🤖 Works with

**AI agents (via MCP):** Google Antigravity · Cursor · Claude Desktop · Claude Code · Cline · Roo Code · Continue.dev · Windsurf · Zed · Goose · Aider · OpenHands · VS Code + Copilot (via the Git hook)

**Migration formats (auto-detected):** Raw SQL · Prisma · Drizzle · Supabase · Flyway · Goose · golang-migrate · dbmate

Manual MCP config, for any MCP-capable client:

```json
{
  "mcpServers": {
    "migration-guardian": { "command": "npx", "args": ["-y", "mgcheck", "mcp"] }
  }
}
```

---

## 🪝 Pre-commit hook

```bash
npx mgcheck hook install     # once per clone; Husky/Lefthook users add `npx --yes mgcheck hook run` to their own hook
```

- It checks staged `.sql` files with static analysis only, so commits stay fast. **Errors block the commit; warnings don't.**
- It reads each file **as it is on disk**. If you stage part of a file and leave other edits unstaged, the hook sees the unstaged edits too.
- It's a fast local check, not a guarantee. It only runs on machines where it's installed, and anyone can skip it with `git commit --no-verify`. Use **CI as the real gate**.

---

## 🔄 CI (GitHub Actions)

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 20 }
- run: npx mgcheck run ./prisma/migrations --ci --provider pglite
```

---

## 🗑️ Uninstall

```bash
npx mgcheck uninstall           # add --purge to also delete audit logs
```

This removes only the `migration-guardian` entries and leaves your other settings alone. It also:
- restores any Git hook you had before installing
- strips the injected rule blocks from CLAUDE.md, AGENTS.md and the other rule files
- reports any config that still mentions mgcheck

mgcheck runs through `npx`, so there's no package to remove afterwards. Restart your editors so they stop any MCP server that's still running.

---

## 🗺️ Roadmap

- [x] AST rules, PGlite/Docker shadow DB, MCP server, watch mode, auto-fix, real-DB applier
- [ ] LLM fix-and-re-verify loop
- [ ] MySQL, SQLite and ClickHouse support

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## 📄 License

MIT © 2026 Aditya & the Migration Guardian community
