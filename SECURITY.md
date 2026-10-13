# 🔐 Security Policy

Migration Guardian (`mgcheck`) is an active safety gate between autonomous AI coding assistants, developer CLI workflows, and production PostgreSQL databases. Because `mgcheck` intercepts and evaluates arbitrary SQL statements and manages database connections, we treat security, sandboxing, and vulnerability disclosures as paramount.

---

## 🛡️ Supported Versions

We actively provide security patches, AST rule improvements, and vulnerability mitigations for the following versions:

| Version | Status | Security Updates |
| :--- | :---: | :--- |
| `0.2.x` (Latest) | ✅ Supported | Full active security and bug fix coverage |
| `< 0.2.0` | ❌ End of Life | Not supported — upgrade via `npm install -g mgcheck@latest` or `npx mgcheck` |

> 💡 Running `npx mgcheck` automatically executes the latest patched release from the npm registry.

---

## 📬 Reporting a Vulnerability

**Please do not report security vulnerabilities via public GitHub issues, discussions, or pull requests.**

If you discover a security vulnerability, privilege escalation, bypass of the safety rules, or credential leakage in Migration Guardian, please report it privately:

- ✉️ **Direct Email**: [adityangandhi@gmail.com](mailto:adityangandhi@gmail.com)
- 🔒 **GitHub Security Advisory**: [Submit a Private Advisory](https://github.com/Aditya31032006/agent-safe-migrate/security/advisories/new)

### What to Include in Your Report
To help us triage and patch the issue as quickly as possible, please provide:
1. **Description & Impact**: A clear summary of the vulnerability and its potential risk (e.g., unauthorized DDL execution, rule evasion, credential exposure).
2. **Environment Details**: `mgcheck` version (`npx mgcheck --version`), Node.js version, Operating System, and whether Docker or PGlite was used.
3. **Reproduction Steps / PoC**: Minimal reproducible `.sql` migration, MCP tool call payload, or terminal script demonstrating the vulnerability.
4. **Suggested Mitigation**: (Optional) Any architectural or code suggestions you have for remediating the issue.

### Our Response SLA & Disclosure Timeline
- **Initial Acknowledgment**: Within **24–48 hours** of receiving your report.
- **Triage & Reproduction**: Within **72 hours**, confirming whether the vulnerability is valid and determining severity.
- **Remediation & Patch**: We aim to release a patched version on npm within **7 to 14 days** (or sooner for critical vulnerabilities).
- **Public Disclosure**: Coordinated public advisory and release notes published once the patch is live.
- **Attribution**: You will be credited in the official release notes and CHANGELOG (unless you explicitly request anonymity).

---

## 🎯 Scope & Threat Model

### In Scope (High Priority)
- **Bypass of High-Risk Approvals**: Any mechanism allowing 🔴 HIGH-risk DDL (e.g., `DROP TABLE`, `DROP COLUMN`) to be executed or auto-approved **without** explicit human typing of `override` or passing `--confirm-destructive`.
- **Agent Permission Escalation**: Any vulnerability allowing an AI agent to manipulate its own approval mode, tamper with IPC approval state, or bypass the MCP approval barrier via crafted prompt payloads.
- **SQL Parser Evasion**: Malicious or obfuscated SQL constructs that bypass the 10 AST safety rules while still locking or rewriting tables in PostgreSQL.
- **Credential & Secret Leakage**: Database URLs, connection strings, or environment secrets appearing in unredacted audit logs (`.mgcheck/audit.jsonl`), CLI error outputs, or tool responses sent back to AI agents.
- **Sandbox Escapes**: Code injection or container breakout vulnerabilities via Docker shadow DB management or PGlite WebAssembly execution.
- **Installer & Hook Hijacking**: Vulnerabilities in `mgcheck setup`, `mgcheck hook install`, or uninstaller scripts that compromise local configuration files (`.cursorrules`, `CLAUDE.md`, Git hooks).

### Out of Scope
- Local machine compromise where an attacker already has root, administrator, or interactive shell access to your user account.
- Intentional user execution of `--confirm-destructive` or manually typing `override` when prompted.
- Vulnerabilities originating strictly within third-party AI editors (Cursor, Claude Code, Windsurf) or the Model Context Protocol (MCP) SDK itself.
- Denial-of-service against ephemeral shadow databases generated on developer laptops.

---

## 🔒 How Migration Guardian Protects Your Data

### 1. Zero Telemetry & Local Execution
- **No External Servers**: `mgcheck` does **not** transmit SQL queries, schemas, or analytics to any remote server or third-party service.
- **Local AST Analysis**: The PostgreSQL parser (`pgsql-parser`) is compiled to WebAssembly and runs 100% locally in-process.
- **Network Boundaries**: Network activity is strictly limited to:
  1. `npm` / `npx` downloading package distributions.
  2. Local Docker daemon pulling `postgres:16-alpine` (when Docker provider is selected).
  3. Direct connection to your configured target database when explicitly applying migrations.

### 2. Credential Sanitization
- Connection strings and database URLs are never written into `.mgcheck/audit.jsonl` or global logs.
- Ephemeral Docker containers generate randomized credentials on random loopback ports (port 0) and are destroyed immediately upon process exit or shutdown.

### 3. Hard Guardrails on Destructive DDL
- High-risk operations (`DROP TABLE`, `DROP COLUMN`) cannot be auto-approved under **any** mode, configuration flag, or environment variable.
- In the interactive terminal watcher, high-risk queries are locked until the human explicitly types the literal string `override` (a simple Enter or `y` is strictly rejected).

### 4. Safe Real Database Application
- Target database execution via `apply_migration` or CLI `--apply` requires:
  1. Complete passage of all 10 AST safety rules.
  2. Successful shadow execution without runtime exceptions.
  3. Explicit human confirmation or programmatic confirmation flag (`confirm_user_approved: true`).

---

## 💡 Recommended Security Best Practices for Teams

When using AI coding assistants on repositories connected to production databases:
1. **Never Give AI Tools Production Credentials**: Keep `DATABASE_URL` pointed to local development or staging instances in developer `.env` files.
2. **Install the Pre-Commit Hook**: Run `npx mgcheck hook install` so accidental unsafe migrations cannot be committed locally.
3. **Enforce in CI/CD**: Add `npx mgcheck run ./migrations --ci --provider pglite` to your GitHub Actions pull request pipeline to enforce safety gates across the entire team.
4. **Inspect Audit Trails**: Periodically review `<project>/.mgcheck/audit.jsonl` to track all intercepted DDL activity generated by AI tools.

---

## 📜 Compliance & Transparency

Migration Guardian is open-source software licensed under the [MIT License](LICENSE). We welcome external security audits, independent evaluations, and responsible vulnerability disclosures from the security community.

**Security Contact:** [adityangandhi@gmail.com](mailto:adityangandhi@gmail.com)
