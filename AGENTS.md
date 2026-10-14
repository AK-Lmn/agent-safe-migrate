# Project State & Agent Context: Migration Guardian (`mgcheck`)

> **Note for AI Assistants / Future Chats**:
> Read this file first when opening this repository. It provides a complete overview of what this project is, what has been built, how it works, technical decisions, and what remains for future iterations.

---

## 1. Project Overview

- **Name**: Migration Guardian (CLI: `mgcheck`)
- **Type**: Open-source CLI tool, CI gate, and MCP server for database migration safety.
- **Repository Root**: `c:\Users\adity\Desktop\sql_migration`
- **Core Purpose**: AI coding agents frequently generate database migrations with correct schema intent but catastrophic production failure modes (table rewrites, lock-queue death spirals, un-concurrent index builds, accidental drops). `mgcheck` intercepts migrations, analyzes them against AST safety rules, and runs them against disposable shadow PostgreSQL databases before they ever reach staging or production.

---

## 2. Current Implementation Status: **v0 (Complete & Verified)**

All v0 deliverables from the project spec are fully implemented, typed, and tested (37/37 tests passing).

### Completed Components:
1. **Migration Format Detector** (`src/detector/`):
   - Auto-detects **Raw SQL** (`.sql` file or directory).
   - Auto-detects **Prisma** (`prisma/migrations/*/migration.sql`).
   - Auto-detects **Drizzle** (`drizzle/*.sql` with `meta/_journal.json`).
2. **PostgreSQL AST Parser** (`src/analyzer/parser.ts`):
   - Uses `pgsql-parser` (official PostgreSQL C parser compiled to WebAssembly) for true PostgreSQL AST parsing.
   - Extracts statement locations, lengths, and exact line numbers.
   - If the file fails to parse, statements are parsed one by one; any the parser still rejects are reported as MG014 and checked by text matching.
3. **10 Production Safety Rules** (`src/analyzer/rules/`):
   - `MG001` (error): `CREATE INDEX` without `CONCURRENTLY` (locks writes).
   - `MG002` (error): `ALTER COLUMN TYPE` (triggers full table rewrite with `ACCESS EXCLUSIVE` lock).
   - `MG003` (error): `ADD COLUMN NOT NULL` without `DEFAULT` (fails on existing rows / rewrites table).
   - `MG004` (warning): `ADD CONSTRAINT` without `NOT VALID` (scans all rows under heavy lock).
   - `MG005` (error): `DROP COLUMN` (destructive & irreversible; requires `--confirm-destructive`).
   - `MG006` (error): `DROP TABLE` (destructive & irreversible; requires `--confirm-destructive`).
   - `MG007` (warning): `RENAME COLUMN` (breaking for zero-downtime deploys).
   - `MG008` (warning): `RENAME TABLE` (breaking for zero-downtime deploys).
   - `MG009` (warning): Missing `lock_timeout` / `statement_timeout` before risky DDL.
   - `MG010` (warning): Missing rollback/down migration (skips Drizzle which doesn't support them).
   - `MG011` (error): `TRUNCATE` (destructive; requires `--confirm-destructive`).
   - `MG012` (error): `DROP SCHEMA` (destructive; requires `--confirm-destructive`).
   - `MG013` (error): `DROP DATABASE` (destructive; requires `--confirm-destructive`).
   - `MG014` (warning): Statement the PostgreSQL parser could not read (likely a syntax error).
4. **Shadow Database Engine** (`src/shadow/`):
   - **Docker Provider** (`src/shadow/docker-postgres.ts`): Starts disposable `postgres:16-alpine` container on random port, runs seed + migration, tears down.
   - **PGlite Provider** (`src/shadow/pglite.ts`): In-process WebAssembly Postgres for fast CI environments without Docker (`--provider pglite`).
   - **External URL Support**: Accepts `--db-url` or `MGCHECK_DB_URL` to test against existing databases.
5. **Reporting System** (`src/reporter/`):
   - `terminal`: Color-coded CLI output with violation tables, plain-English explanations, and safe rewrite patterns.
   - `json`: Machine-readable JSON output for CI pipelines (`--ci`).
   - `markdown`: Formatted for GitHub PR comments and CI summaries.
   - Exit codes: `0` (pass), `1` (error/blocking), `2` (warnings only), `3` (fatal error).
6. **Real Database Applier & Interactive Confirmation** (`src/core/applier.ts`):
   - When a migration passes verification, prints the verified SQL query to the CLI.
   - Prompts the user interactively (`Apply this migration to your real database now? [y/N]`).
   - If confirmed, applies the migration to the target database and reports execution status.
   - If declined, leaves the database untouched and continues the workflow.
   - Supports `--target-db-url <url>` and `--apply` flags.
7. **CLI & Library Entry Points**:
   - `src/cli.ts` (`dist/cli.js`): Commander CLI with `run`, `analyze`, `setup`, and `mcp` commands.
   - `src/index.ts` (`dist/index.js`): Programmatic TypeScript API.
8. **MCP Server & Agent Setup** (`src/mcp/`, `src/installer/`):
   - Exposes `check_migration` (full shadow execution), `analyze_migration` (static only), and `apply_migration` (with in-code AST gate) for AI coding agents.
   - Automated setup wizard auto-detects all 13 AI agents (Google Antigravity, Cursor, Claude Desktop, Claude Code, Cline, Roo Code, Continue.dev, Windsurf, Zed, Goose, Aider, OpenHands, VS Code + Copilot).
   - Injects prompt rules into `.cursorrules`, `CLAUDE.md`, `AGENTS.md`, `.windsurfrules`, `.github/copilot-instructions.md`, `.clinerules`.
   - Git pre-commit hook (`mgcheck hook install`) automatically guards any commits containing unsafe migrations.
9. **CI & Packaging**:
   - `action/action.yml`: Composite GitHub Action.
   - `.github/workflows/ci.yml`: Automated CI pipeline (lint, test, build).
   - `CONTRIBUTING.md`, `LICENSE` (MIT), `README.md`.

---

## 3. Key Commands Reference

```bash
# Install dependencies
npm install

# Run all unit and integration tests (30 tests)
npm test

# Run TypeScript type check (zero errors)
npm run lint

# Build production bundle with tsup (outputs to dist/)
npm run build

# Run CLI directly in dev
npm run dev -- analyze ./test/fixtures/migrations/unsafe-create-index.sql

# Run CLI from build
node dist/cli.js analyze ./test/fixtures/migrations/unsafe-create-index.sql
node dist/cli.js run ./test/fixtures/migrations/safe-add-column.sql --provider pglite --seed ./test/fixtures/schemas/base-schema.sql

# Start MCP Server
node dist/cli.js mcp
# Or with MCP Inspector UI:
npx @modelcontextprotocol/inspector node dist/mcp/server.js

# Install Git Pre-Commit Safety Hook
node dist/cli.js hook install
```

---

## 4. Important Architectural Decisions

1. **`pgsql-parser` AST format**:
   - Returns `{ version: number, stmts: Array<{ stmt: any, stmt_len?: number, stmt_location?: number }> }`.
   - Node extraction is done via `getStmtType(ast)` and `getStmtNode(ast)` in `src/analyzer/rules/types.ts`.
2. **Process Termination in CLI**:
   - Uses `process.exitCode = code` instead of `process.exit(code)` to prevent Windows libuv handle assertion errors while WASM threads close.
3. **TypeScript ESM Imports**:
   - Code uses standard Node ESM `.js` import extensions (e.g. `import ... from './tools.js'`) which map to `.ts` files during compilation.
4. **Zero-Configuration by Default**:
   - No `.env` file required for v0. Docker generates random ephemeral credentials; PGlite runs in-process memory.

---

## 5. Next Steps for v1 (Scope: LLM Fix & Re-verify)

When picking up v1 development:
1. **Pluggable LLM Client** (`src/fixer/`):
   - Support OpenAI and Anthropic compatible APIs via `MGCHECK_LLM_API_KEY` and `MGCHECK_LLM_PROVIDER`.
2. **Prompt & Structured Output**:
   - Send failing migration + exact error / rule violation to LLM.
   - Require structured response: corrected SQL + rationale.
3. **Fresh Re-verify Loop**:
   - Spin up a *fresh* shadow DB instance.
   - Execute the fix and re-run all rules.
   - Only return the fix if BOTH execution and rules pass.
4. **Hard Guardrail**:
   - Cap at 1 fix attempt (no infinite loops).
   - Never auto-fix destructive operations (DROP TABLE/COLUMN) without explicit `--confirm-destructive`.
