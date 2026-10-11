import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runCheck } from '../core/engine.js';
import { loadConfig } from '../core/config.js';
import {
  logActivity,
  writeAuditEntry,
  writePendingApproval,
  waitForDecision,
  removePendingApproval,
  generateAuditId,
  getLogDir,
  getGlobalLogDir,
} from '../core/activity-log.js';
import type { AuditEntry } from '../core/activity-log.js';
import { classifyRisk } from '../core/risk-classifier.js';
import type { MigrationReport } from '../core/types.js';
import { fixMigrationSql } from '../fixer/rules-fixer.js';

/**
 * Register MCP tools on the server.
 *
 * The MCP server is the single interception point between AI agents and the database.
 * Every migration query is classified by risk:
 *   🔴 HIGH   → Auto-blocked. Returns error immediately.
 *   🟡 MEDIUM → Pauses. Waits for user approval in the CLI watch terminal.
 *   🟢 LOW    → Pauses. Waits for user approval in the CLI watch terminal.
 *
 * Decisions are logged to the calling project's .mgcheck/audit.jsonl (see resolveProjectDir).
 * Approval requests always go through the global ~/.mgcheck queue so a single
 * `mgcheck setup` watcher sees requests from every project and editor.
 */
export function runMcpTools(server: McpServer) {
  // ── Tool 1: check_migration ──────────────────────────────────────
  server.tool(
    'check_migration',
    'Analyze a database migration for safety issues and execute it against a disposable shadow PostgreSQL database. Returns a detailed report with violations, explanations, and suggested fixes. HIGH risk queries are automatically blocked. MEDIUM and LOW risk queries require human approval via the CLI.',
    {
      migration_sql: z
        .string()
        .describe('The SQL content of the migration to check'),
      base_schema_sql: z
        .string()
        .optional()
        .describe(
          'Optional base schema SQL to apply before the migration (e.g., CREATE TABLE statements that the migration depends on)'
        ),
      confirm_destructive: z
        .boolean()
        .default(false)
        .describe(
          'Set to true to allow destructive operations (DROP TABLE, DROP COLUMN). Default: false'
        ),
      provider: z
        .enum(['docker', 'pglite'])
        .default('pglite')
        .describe(
          'Shadow database provider. "pglite" requires no Docker. "docker" gives full Postgres fidelity.'
        ),
      project_dir: z
        .string()
        .optional()
        .describe('Absolute path of the current workspace/project root. The audit log is written to <project_dir>/.mgcheck/audit.jsonl.'),
    },
    async ({ migration_sql, base_schema_sql, confirm_destructive, provider, project_dir }) => {
      try {
        const { projectDir, auditDir, ipcDir } = await resolveStorage(server, project_dir);
        // Write SQL to a temp file for the engine
        const tmpDir = mkdtempSync(join(tmpdir(), 'mgcheck-'));
        const tmpFile = join(tmpDir, 'migration.sql');
        writeFileSync(tmpFile, migration_sql, 'utf-8');

        const config = loadConfig({
          shadowDb: {
            provider,
            dockerImage: 'postgres:16-alpine',
            seedFile: base_schema_sql ? (() => {
              const seedFile = join(tmpDir, 'seed.sql');
              writeFileSync(seedFile, base_schema_sql, 'utf-8');
              return seedFile;
            })() : undefined,
          },
          confirmDestructive: confirm_destructive,
          output: { format: 'json', verbose: false },
        });

        const report = await runCheck(tmpFile, config, 'run');
        const risk = classifyRisk(report.violations);
        const auditId = generateAuditId();

        // Build the audit entry
        const auditEntry: AuditEntry = {
          id: auditId,
          timestamp: new Date().toISOString(),
          tool: 'check_migration',
          project: projectDir,
          risk: risk.level,
          decision: 'pending',
          query: migration_sql,
          violations: report.violations.map((v) => ({
            ruleId: v.ruleId,
            severity: v.severity,
            message: v.message,
            line: v.line,
          })),
          errorCount: risk.errorCount,
          warningCount: risk.warningCount,
        };

        // ── Decision Gate ────────────────────────────────────────
        if (risk.level === 'high') {
          // 🔴 HIGH RISK: Auto-block immediately
          auditEntry.decision = 'blocked';
          writeAuditEntry(auditEntry, auditDir);
          logActivityFromReport('check_migration', report, auditDir);

          // Compute suggested safe rewrite
          const fixResult = fixMigrationSql(migration_sql, report.violations);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                ...report,
                guardian: {
                  risk: risk.level,
                  decision: 'blocked',
                  message: `🔴 BLOCKED by Migration Guardian. ${risk.errorCount} blocking error(s) detected. Fix the violations before proceeding.`,
                  auto_fix: fixResult.fixed ? {
                    available: true,
                    suggested_safe_sql: fixResult.fixedSql,
                    applied_fixes: fixResult.appliedFixes,
                    instruction: "Replace your unsafe query with 'suggested_safe_sql' and run check_migration again.",
                  } : undefined,
                },
              }, null, 2),
            }],
            isError: true,
          };
        }

        // 🟡 MEDIUM / 🟢 LOW: Send to CLI watch terminal for user approval
        auditEntry.decision = 'pending';
        writePendingApproval(auditEntry, ipcDir);

        // Wait for the user to approve or reject in the CLI (up to 2 minutes)
        const approved = await waitForDecision(auditId, 120_000, ipcDir);
        removePendingApproval(auditId, ipcDir);

        if (approved === true) {
          auditEntry.decision = 'user_approved';
          writeAuditEntry(auditEntry, auditDir);
          logActivityFromReport('check_migration', report, auditDir);

          const responseData = {
            ...report,
            guardian: {
              risk: risk.level,
              decision: 'user_approved',
              message: `✅ Approved by user. Migration passed guardian review.`,
            },
            destructiveActionRequired:
              report.hasDestructive && !confirm_destructive
                ? '🚨 ATTENTION AI AGENT: This migration contains DESTRUCTIVE operations (DROP TABLE or DROP COLUMN) which will permanently delete user data. You MUST pause and ask the user for confirmation: "This migration contains destructive operations (DROP TABLE/COLUMN). Do you approve running this destructive migration?". Only if the user explicitly confirms "yes", call check_migration again with confirm_destructive: true.'
                : undefined,
          };

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(responseData, null, 2),
            }],
          };
        } else {
          // User rejected or timed out
          auditEntry.decision = approved === false ? 'user_rejected' : 'user_rejected';
          writeAuditEntry(auditEntry, auditDir);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                passed: false,
                guardian: {
                  risk: risk.level,
                  decision: 'user_rejected',
                  message: approved === null
                    ? '⏰ Migration timed out waiting for user approval (2 min). Rejected by default.'
                    : '❌ Migration was rejected by the user in the CLI.',
                },
              }, null, 2),
            }],
            isError: true,
          };
        }
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: (err as Error).message }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ── Tool 2: analyze_migration ────────────────────────────────────
  server.tool(
    'analyze_migration',
    'Static analysis only — check migration SQL against 10 safety rules without executing. No Docker or database required. HIGH risk queries are auto-blocked. Others require user approval.',
    {
      migration_sql: z
        .string()
        .describe('The SQL content of the migration to analyze'),
      confirm_destructive: z
        .boolean()
        .default(false)
        .describe('Set to true to allow destructive operations'),
      project_dir: z
        .string()
        .optional()
        .describe('Absolute path of the current workspace/project root. The audit log is written to <project_dir>/.mgcheck/audit.jsonl.'),
    },
    async ({ migration_sql, confirm_destructive, project_dir }) => {
      try {
        const { projectDir, auditDir, ipcDir } = await resolveStorage(server, project_dir);
        const tmpDir = mkdtempSync(join(tmpdir(), 'mgcheck-'));
        const tmpFile = join(tmpDir, 'migration.sql');
        writeFileSync(tmpFile, migration_sql, 'utf-8');

        const config = loadConfig({
          confirmDestructive: confirm_destructive,
          output: { format: 'json', verbose: false },
        });

        const report = await runCheck(tmpFile, config, 'analyze');
        const risk = classifyRisk(report.violations);
        const auditId = generateAuditId();

        const auditEntry: AuditEntry = {
          id: auditId,
          timestamp: new Date().toISOString(),
          tool: 'analyze_migration',
          project: projectDir,
          risk: risk.level,
          decision: 'pending',
          query: migration_sql,
          violations: report.violations.map((v) => ({
            ruleId: v.ruleId,
            severity: v.severity,
            message: v.message,
            line: v.line,
          })),
          errorCount: risk.errorCount,
          warningCount: risk.warningCount,
        };

        // 🔴 HIGH: Auto-block
        if (risk.level === 'high') {
          auditEntry.decision = 'blocked';
          writeAuditEntry(auditEntry, auditDir);
          logActivityFromReport('analyze_migration', report, auditDir);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                ...report,
                guardian: {
                  risk: risk.level,
                  decision: 'blocked',
                  message: `🔴 BLOCKED by Migration Guardian. ${risk.errorCount} blocking error(s) detected.`,
                },
              }, null, 2),
            }],
            isError: true,
          };
        }

        // 🟡 MEDIUM / 🟢 LOW: Wait for user approval
        writePendingApproval(auditEntry, ipcDir);
        const approved = await waitForDecision(auditId, 120_000, ipcDir);
        removePendingApproval(auditId, ipcDir);

        if (approved === true) {
          auditEntry.decision = 'user_approved';
          writeAuditEntry(auditEntry, auditDir);
          logActivityFromReport('analyze_migration', report, auditDir);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                ...report,
                guardian: {
                  risk: risk.level,
                  decision: 'user_approved',
                  message: `✅ Approved by user.`,
                },
              }, null, 2),
            }],
          };
        } else {
          auditEntry.decision = 'user_rejected';
          writeAuditEntry(auditEntry, auditDir);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                passed: false,
                guardian: {
                  risk: risk.level,
                  decision: 'user_rejected',
                  message: approved === null
                    ? '⏰ Timed out waiting for user approval.'
                    : '❌ Rejected by user.',
                },
              }, null, 2),
            }],
            isError: true,
          };
        }
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: (err as Error).message }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ── Tool 3: apply_migration ──────────────────────────────────────
  server.tool(
    'apply_migration',
    'Apply a verified SQL migration directly to the real target database. Use this ONLY after verifying with check_migration and receiving explicit user confirmation in chat. All apply requests require user approval in the CLI.',
    {
      migration_sql: z
        .string()
        .describe('The SQL content of the migration to apply to the real database'),
      db_url: z
        .string()
        .optional()
        .describe(
          'Target PostgreSQL connection URL. Defaults to DATABASE_URL or TARGET_DATABASE_URL environment variables.'
        ),
      confirm_user_approved: z
        .boolean()
        .describe(
          'Must be set to true to certify that the human user explicitly requested or approved applying this migration.'
        ),
      confirm_destructive: z
        .boolean()
        .default(false)
        .optional()
        .describe(
          'Set to true only if the human user explicitly confirmed performing a destructive operation (DROP TABLE/COLUMN).'
        ),
      project_dir: z
        .string()
        .optional()
        .describe('Absolute path of the current workspace/project root. The audit log is written to <project_dir>/.mgcheck/audit.jsonl.'),
    },
    async ({ migration_sql, db_url, confirm_user_approved, confirm_destructive, project_dir }) => {
      try {
        const { projectDir, auditDir, ipcDir } = await resolveStorage(server, project_dir);
        if (!confirm_user_approved) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'User confirmation required. You must ask the human user for approval before calling apply_migration with confirm_user_approved: true.',
              }, null, 2),
            }],
            isError: true,
          };
        }

        // ── Ironclad In-Code AST Gate ───────────────────────────
        const verifyDir = mkdtempSync(join(tmpdir(), 'mgcheck-apply-verify-'));
        const verifyFile = join(verifyDir, 'migration.sql');
        writeFileSync(verifyFile, migration_sql, 'utf-8');

        try {
          const verifyConfig = loadConfig({
            confirmDestructive: confirm_destructive ?? false,
            output: { format: 'json', verbose: false },
          });

          const preCheckReport = await runCheck(verifyFile, verifyConfig, 'analyze');
          const risk = classifyRisk(preCheckReport.violations);
          const auditId = generateAuditId();

          const blockingErrors = preCheckReport.violations.filter(
            (v) => v.severity === 'error'
          );

          // 🔴 HIGH RISK: Hard block
          if (blockingErrors.length > 0) {
            const violationSummary = blockingErrors
              .map((v) => `[${v.ruleId}] ${v.message} (Line ${v.line})`)
              .join('; ');

            writeAuditEntry({
              id: auditId,
              timestamp: new Date().toISOString(),
              tool: 'apply_migration',
              project: projectDir,
              risk: 'high',
              decision: 'blocked',
              query: migration_sql,
              violations: blockingErrors.map((v) => ({
                ruleId: v.ruleId,
                severity: v.severity,
                message: v.message,
                line: v.line,
              })),
              errorCount: blockingErrors.length,
              warningCount: 0,
            }, auditDir);

            const fixResult = fixMigrationSql(migration_sql, blockingErrors);

            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: `SECURITY GATE REJECTION: Cannot apply migration. Detected ${blockingErrors.length} blocking violation(s): ${violationSummary}`,
                  violations: blockingErrors,
                  auto_fix: fixResult.fixed ? {
                    available: true,
                    suggested_safe_sql: fixResult.fixedSql,
                    applied_fixes: fixResult.appliedFixes,
                    instruction: "You must use 'suggested_safe_sql' to apply zero-downtime safe migrations.",
                  } : undefined,
                }, null, 2),
              }],
              isError: true,
            };
          }

          // 🟡 MEDIUM / 🟢 LOW: Send to CLI for approval
          const applyAudit: AuditEntry = {
            id: auditId,
            timestamp: new Date().toISOString(),
            tool: 'apply_migration',
            project: projectDir,
            risk: risk.level,
            decision: 'pending',
            query: migration_sql,
            violations: preCheckReport.violations.map((v) => ({
              ruleId: v.ruleId,
              severity: v.severity,
              message: v.message,
              line: v.line,
            })),
            errorCount: risk.errorCount,
            warningCount: risk.warningCount,
          };

          writePendingApproval(applyAudit, ipcDir);
          const approved = await waitForDecision(auditId, 120_000, ipcDir);
          removePendingApproval(auditId, ipcDir);

          if (approved !== true) {
            applyAudit.decision = 'user_rejected';
            writeAuditEntry(applyAudit, auditDir);

            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  guardian: {
                    risk: risk.level,
                    decision: 'user_rejected',
                    message: approved === null
                      ? '⏰ Timed out waiting for user approval.'
                      : '❌ Rejected by user in the CLI.',
                  },
                }, null, 2),
              }],
              isError: true,
            };
          }

          applyAudit.decision = 'user_approved';
          writeAuditEntry(applyAudit, auditDir);
        } finally {
          try {
            rmSync(verifyDir, { recursive: true, force: true });
          } catch {}
        }

        // ── Execute against real database ────────────────────────
        const targetUrl =
          db_url ||
          process.env.TARGET_DATABASE_URL ||
          process.env.DATABASE_URL;

        if (!targetUrl) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'No database connection URL found. Please pass db_url or set the DATABASE_URL environment variable.',
              }, null, 2),
            }],
            isError: true,
          };
        }

        const { applyToRealDatabase } = await import('../core/applier.js');
        const result = await applyToRealDatabase(migration_sql, targetUrl);

        logActivity({
          timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
          tool: 'apply_migration',
          summary: result.success
            ? `Applied to real database (${result.executionTimeMs}ms)`
            : `Failed on real database: ${result.error}`,
          violations: 0,
          errors: result.success ? 0 : 1,
          warnings: 0,
          passed: result.success,
          statements: migration_sql
            .split(';')
            .map((s) => s.trim())
            .filter(Boolean),
        }, auditDir);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: (err as Error).message,
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Extract info from a report and write to the shared activity log.
 */
function logActivityFromReport(tool: string, report: MigrationReport, targetDir?: string): void {
  try {
    const errors = report.violations.filter((v) => v.severity === 'error').length;
    const warnings = report.violations.filter((v) => v.severity === 'warning').length;
    const stmts = (report.statements || []).map((s) =>
      s.raw.replace(/\s+/g, ' ').trim()
    );

    logActivity({
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      tool,
      summary: stmts.length > 0 ? stmts[0] : '(no statements)',
      violations: report.violations.length,
      errors,
      warnings,
      passed: report.passed,
      statements: stmts,
    }, targetDir);
  } catch {
    // Never let logging break the MCP response
  }
}

/**
 * Decide where this tool call's audit log goes.
 * Priority: explicit project_dir argument → first file:// MCP root from the
 * client → the server's cwd. Editors often launch MCP servers from the home or
 * install directory, so cwd alone would send every project's log to ~/.mgcheck.
 */
async function resolveStorage(server: McpServer, projectDirArg?: string): Promise<{
  projectDir: string;
  auditDir: string;
  ipcDir: string;
}> {
  let projectDir = process.cwd();
  if (projectDirArg && existsSync(projectDirArg)) {
    projectDir = resolve(projectDirArg);
  } else {
    try {
      if (server.server.getClientCapabilities()?.roots) {
        const { roots } = await server.server.listRoots(undefined, { timeout: 2_000 });
        const fileRoot = roots.find((r) => r.uri.startsWith('file://'));
        if (fileRoot) projectDir = fileURLToPath(fileRoot.uri);
      }
    } catch {
      // Client doesn't answer roots/list — fall back to cwd
    }
  }
  return { projectDir, auditDir: getLogDir(projectDir), ipcDir: getGlobalLogDir() };
}
