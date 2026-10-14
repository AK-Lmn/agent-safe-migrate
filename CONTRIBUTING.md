# Contributing to Migration Guardian (`mgcheck`)

Thanks for helping make database migrations safer. Every kind of contribution is welcome: a new safety rule, a fix, a detector for your migration tool, a docs improvement, or a test fixture from a migration that once took your app down.

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 🧭 Find something to work on

- **New here?** Start with issues labelled [`good first issue`](https://github.com/Aditya31032006/agent-safe-migrate/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22). They're small and self-contained, and each one says which file to change.
- **Want something bigger?** See [`help wanted`](https://github.com/Aditya31032006/agent-safe-migrate/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) and the [roadmap in the README](README.md#%EF%B8%8F-roadmap--help-wanted).
- **Comment on the issue before you start** (e.g. "I'd like to take this") so two people don't build the same thing. If an issue has had no activity for 2 weeks after someone claimed it, feel free to ask to take it over.
- **Have your own idea?** Open an issue first for anything larger than a small fix, so we can agree on the approach before you write code.

> 🔐 **Found a security problem?** Please don't open a public issue. Follow [SECURITY.md](SECURITY.md) instead.

---

## 🛠️ Set up (about 2 minutes)

You need **Node.js 18+** and npm. Docker is optional: the test suite uses in-process PGlite.

```bash
git clone https://github.com/Aditya31032006/agent-safe-migrate.git
cd agent-safe-migrate
npm install

npm run lint      # type check
npm test          # unit + integration tests
npm run build     # bundle to dist/
```

Try the CLI straight from source:

```bash
npm run dev -- analyze ./test/fixtures/migrations/unsafe-create-index.sql
npm run dev -- run ./test/fixtures/migrations/safe-add-column.sql --provider pglite
```

### Project layout

```
src/
├── analyzer/     parser.ts (PostgreSQL AST) + rules/ (one file per rule)
├── core/         engine, config, approval modes, audit log, applier
├── detector/     recognises Prisma, Drizzle, Supabase, Flyway, …
├── fixer/        safe zero-downtime rewrites (rules-fixer.ts)
├── installer/    setup / uninstall wizards and the watcher terminal
├── mcp/          MCP server and the check / analyze / apply tools
├── reporter/     terminal, JSON and Markdown output
└── shadow/       PGlite and Docker shadow databases
test/
├── unit/         fast tests, one file per area
├── integration/  engine tests against PGlite
└── fixtures/     example migrations and schemas
```

---

## 🛡️ Adding a safety rule

Rules are the easiest way into the codebase: each one is a single file with no side effects.

1. **See what the parser gives you.** Rules inspect the PostgreSQL AST:
   ```bash
   node -e "import('pgsql-parser').then(async ({parse}) => console.log(JSON.stringify(await parse('TRUNCATE users;'), null, 2)))"
   ```
2. **Create** `src/analyzer/rules/<rule-name>.ts`. Copy a similar rule, e.g. [`drop-table.ts`](src/analyzer/rules/drop-table.ts):
   - Check `stmt.ast` first (`getStmtType` / `getStmtNode` from `rules/types.ts`).
   - When `stmt.ast` is `null` (the parser couldn't read the statement), fall back to a text match with `sqlMatches`.
   - Every violation needs a plain-English `message` (what goes wrong in production) and a `suggestion` (the safe way to do it).
3. **Register** it in [`src/analyzer/rules/index.ts`](src/analyzer/rules/index.ts) and give it the next free `MGxxx` ID.
   - If it deletes data, also add its ID to `DESTRUCTIVE_RULE_IDS`, so `--confirm-destructive` and the destructive prompts cover it.
4. **Test** it in [`test/unit/rules.test.ts`](test/unit/rules.test.ts). Cover the unsafe form, the safe form, and a statement that only *looks* similar.
5. **Document** it in the rules table in [`README.md`](README.md) and the catalog in [`SHOWCASE.md`](SHOWCASE.md).

### Adding an auto-fix

Safe rewrites live in [`src/fixer/rules-fixer.ts`](src/fixer/rules-fixer.ts). Every fix is re-run on a shadow database before the user is offered it. Never auto-rewrite destructive statements. Add tests in [`test/unit/fixer.test.ts`](test/unit/fixer.test.ts).

---

## 🤖 Testing the MCP tools locally

Point your AI editor at your local build instead of the npm package:

```json
{
  "mcpServers": {
    "migration-guardian-dev": {
      "command": "node",
      "args": ["/absolute/path/to/agent-safe-migrate/dist/cli.js", "mcp"]
    }
  }
}
```

Run `npm run build` after each change and restart the MCP server from your editor. In another terminal, `npm run dev -- setup` opens the approval watcher.

---

## ✅ Tests: the one rule that matters

**Tests must never touch your real home directory or editor configs.**

`test/setup/sandbox-home.ts` (loaded automatically by `vitest.config.ts`) points `os.homedir()`, `HOME`, `USERPROFILE` and `APPDATA` at a throwaway folder. Always build paths with `os.homedir()` or the helpers in `src/core/activity-log.ts`, never a hard-coded `~` or `C:\Users\...`. Use `mkdtempSync(join(tmpdir(), ...))` for project folders, and clean them up in `afterEach`.

Other conventions:
- Call MCP tools in tests through `(server as any)._registeredTools[name].handler(...)`. See `test/unit/approval-mode.test.ts`.
- Restore any `process.env` value you change.
- Prefer `provider: 'pglite'` so tests run without Docker.

---

## 📝 Code style

- TypeScript in strict mode, ES modules. Imports use the `.js` extension.
- Match the code around you: small functions and short JSDoc comments that explain *why*.
- No new runtime dependencies without discussing it in an issue first.
- Messages users see should be plain English. Explain the production consequence, not just the SQL rule.
- The MCP server talks over stdout, so anything diagnostic in MCP code goes to **stderr**.

---

## 🚀 Pull requests

1. Fork the repo and create a branch: `git checkout -b feat/truncate-rule`.
2. Write commits as [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
3. Open the PR against `main` and fill in the template. Link the issue with `Closes #123`.

Before you push:

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] New behaviour has tests
- [ ] README / SHOWCASE updated if you added or changed a rule, command or flag
- [ ] No real paths, credentials or personal data in tests or fixtures

CI runs lint, tests and the build on Node 18, 20 and 22, on Ubuntu and Windows. A maintainer will review, usually within a few days. Small, focused PRs get merged fastest.

---

## 📄 License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
