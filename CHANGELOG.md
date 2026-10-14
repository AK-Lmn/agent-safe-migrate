# Changelog

All notable changes to `mgcheck` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.2.8] - 2026-10-14

### Security
- **New destructive rules:** `TRUNCATE` (MG011), `DROP SCHEMA` (MG012) and `DROP DATABASE` (MG013) are now errors (🔴 HIGH). Previously they passed as 🟢 LOW and could be auto-approved.
- **`check_migration` no longer applies to the real database by default.** `auto_apply` now defaults to `false`; the agent must ask the user and call `apply_migration`, or pass `auto_apply: true` when the user asked for it.

### Added
- **MG014:** statements the PostgreSQL parser can't read are reported as a warning with the parser's error, instead of silently passing.
- When a file fails to parse, statements are now parsed one by one, so the valid ones are still checked with the full AST.
- `CONTRIBUTING.md` guide, `CODE_OF_CONDUCT.md`, issue forms (bug, feature, new rule), and a pull request template.
- Project logo and "how it works" diagram.

### Fixed
- `--confirm-destructive` now allows destructive statements. Before, `DROP TABLE` still failed even with the flag.

## [0.2.7] - 2026-10-13
### Fixed
- The terminal report header showed `v0.1.0` instead of the real version.
- Word-wrapping in the terminal display.
### Docs
- New README, `SHOWCASE.md` and `SECURITY.md`.

## [0.2.6] - 2026-10-13
### Added
- `auto` and `manual` approval modes, `mgcheck mode`, and live switching with Shift+Tab in the watcher.
- Safe rewrites for 🟡 MEDIUM migrations in auto mode.

## [0.2.5] - 2026-10-12
### Added
- Agent retry loop with a before/after comparison in the watcher.

## [0.2.4] - 2026-10-12
### Added
- Background MCP servers are stopped on setup, Ctrl+C and uninstall.

## [0.2.3] - 2026-10-12
### Added
- Migrations can be applied to the target database after the user approves them.

## [0.2.2] - 2026-10-12
### Added
- Watcher heartbeat. 🔴 HIGH risk queries need the user to type `override`.

## [0.2.1] - 2026-10-12
### Fixed
- Blocked checks are shown in the watcher, and AI agents are no longer falsely detected.

## [0.2.0] - 2026-10-11
### Added
- `mgcheck fix` with shadow-DB-verified zero-downtime rewrites.
- Per-project audit logs, guardian risk classification, interactive approval gate.
- Support for 13 AI agents, detectors for 8 migration frameworks, CI matrix and npm release workflow.
### Fixed
- Reliable uninstall: JSONC configs, Goose/Aider blocks, Claude Code project entries, Git hook backup and restore.

## [0.1.2] - 2026-10-01
- First public release.

[Unreleased]: https://github.com/Aditya31032006/agent-safe-migrate/compare/v0.2.8...HEAD
[0.2.8]: https://github.com/Aditya31032006/agent-safe-migrate/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/Aditya31032006/agent-safe-migrate/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/Aditya31032006/agent-safe-migrate/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/Aditya31032006/agent-safe-migrate/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/Aditya31032006/agent-safe-migrate/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/Aditya31032006/agent-safe-migrate/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Aditya31032006/agent-safe-migrate/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Aditya31032006/agent-safe-migrate/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Aditya31032006/agent-safe-migrate/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/Aditya31032006/agent-safe-migrate/releases/tag/v0.1.2
