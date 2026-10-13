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
  generateAuditId,
  getLogDir,
  getGlobalLogDir,
  publishEvent,
  requestApproval,
  isWatcherActive,
} from '../core/activity-log.js';
import type { ApprovalOutcome, AuditEntry } from '../core/activity-log.js';
import { classifyRisk } from '../core/risk-classifier.js';
import type { MigrationReport } from '../core/types.js';
import { fixMigrationSql } from '../fixer/rules-fixer.js';
import { findDatabaseUrl } from '../core/applier.js';
import { getApprovalMode } from '../core/approval-mode.js';

export interface RetrySession {
  attempt: number;
  originalDraft: {
    query: string;
    violations: Array<{
      ruleId: string;
      severity: 'error' | 'warning';
      message: string;
      line?: number;
    }>;
    errorCount: number;
  };
  lastTimestamp: number;
}

const retrySessions = new Map<string, RetrySession>();

export function getRetrySession(projectKey: string): RetrySession | undefined {
  const session = retrySessions.get(projectKey);
  if (!session) return undefined;
  if (Date.now() - session.lastTimestamp > 180_000) {
    retrySessions.delete(projectKey);
    return undefined;
  }
  return session;
}

export function clearRetrySession(projectKey: string): void {
  retrySessions.delete(projectKey);
}

export function resetAllRetrySessions(): void {
  retrySessions.clear();
}

/**
 * Register MCP tools on the server.
 *
 * The MCP server is the single interception point between AI agents and the database.
 * Every migration query is classified by risk:
 *   🔴 HIGH   → Blocked unless the user types "override" in the watch terminal.
 *   🟡 MEDIUM → Pauses. Waits for a y/N answer in the watch terminal.
 *   🟢 LOW    → Pauses. Waits for a y/N answer in the watch terminal.
 * With no watch terminal running, HIGH is blocked and MEDIUM/LOW return at once.
 *
 * Decisions are logged to the calling project's .mgcheck/audit.jsonl (see resolveProjectDir).
 * Approval requests always go through the global ~/.mgcheck queue so a single
 * `mgcheck setup` watcher sees requests from every project and editor.
 */
export function runMcpTools(server: McpServer) {
  // ── Tool 1: check_migration ──────────────────────────────────────
  server.tool(
    'check_migration',
    'Analyze a database migration for safety issues and execute it against a disposable shadow PostgreSQL database. Returns a detailed report with violations, explanations, and suggested fixes. HIGH risk queries are blocked unless the user overrides them in the Migration Guardian terminal. MEDIUM and LOW risk queries require human approval there.',
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
      auto_apply: z
        .boolean()
        .default(true)
        .optional()
        .describe(
          'If true (default) and approved by the user in the CLI, automatically execute the migration against the target database.'
        ),
      db_url: z
        .string()
        .optional()
        .describe(
          'Target PostgreSQL connection URL. If omitted, automatically discovered from DATABASE_URL or project .env files.'
        ),
    },
    async ({ migration_sql, base_schema_sql, confirm_destructive, provider, project_dir, auto_apply, db_url }) => {
      try {
        const { projectDir, auditDir, ipcDir } = await resolveStorage(server, project_dir);
        // Write SQL to a temp file for the engine
        const tmpDir = mkdtempSync(join(tmpdir(), 'mgcheck-'));
        const tmpFile = join(tmpDir, 'migration.sql');
        writeFileSync(tmpFile, migration_sql, 'utf-8');

        const config = loadConfig({
          shadowDb: {
            provider: provider || 'pglite',
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

        const fixResult = fixMigrationSql(migration_sql, report.violations);
        const isDestructive = (report.hasDestructive || report.violations.some((v) => v.ruleId === 'MG005' || v.ruleId === 'MG006')) && !confirm_destructive;
        const activeSession = getRetrySession(projectDir);
        const currentAttempt = (activeSession ? activeSession.attempt : 0) + 1;

        const { mode, autoApprove } = getApprovalMode(projectDir);

        // ── Autonomous Retry Loop (Attempts 1 to 3) ──────────────
        // High risk errors always retry. In auto mode, fixable medium warnings retry to make query safe first.
        const isFixableRetry =
          ((risk.level === 'high') || (mode === 'auto' && risk.level === 'medium')) &&
          fixResult.fixed &&
          !isDestructive &&
          currentAttempt < 4;
        if (isFixableRetry) {
          retrySessions.set(projectDir, {
            attempt: currentAttempt,
            originalDraft: activeSession?.originalDraft || {
              query: migration_sql,
              violations: report.violations.map((v) => ({
                ruleId: v.ruleId,
                severity: v.severity,
                message: v.message,
                line: v.line,
              })),
              errorCount: risk.errorCount,
            },
            lastTimestamp: Date.now(),
          });

          const retryEntry: AuditEntry = {
            id: auditId,
            timestamp: new Date().toISOString(),
            tool: 'check_migration',
            project: projectDir,
            risk: risk.level,
            decision: 'auto_retry',
            query: migration_sql,
            violations: report.violations.map((v) => ({
              ruleId: v.ruleId,
              severity: v.severity,
              message: v.message,
              line: v.line,
            })),
            errorCount: risk.errorCount,
            warningCount: risk.warningCount,
            attempt: currentAttempt,
          };
          writeAuditEntry(retryEntry, auditDir);
          publishEvent(retryEntry, ipcDir);
          logActivityFromReport('check_migration', report, auditDir);

          const retryMessage = risk.level === 'high'
            ? `⚠️ MIGRATION REJECTED (Attempt ${currentAttempt}/4): Detected ${risk.errorCount} blocking safety violation(s). You must rewrite your query using the suggested safe SQL below and retry.`
            : `⚠️ MIGRATION NOTICES (Attempt ${currentAttempt}/4): Detected ${risk.warningCount} warning(s). Please rewrite your query using the suggested safe SQL below to eliminate warnings and make it safe (LOW risk) before execution.`;

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                ...report,
                guardian: {
                  risk: risk.level,
                  decision: 'auto_retry',
                  attempt: currentAttempt,
                  max_attempts: 4,
                  message: retryMessage,
                  auto_fix: {
                    available: true,
                    suggested_safe_sql: fixResult.fixedSql,
                    applied_fixes: fixResult.appliedFixes,
                    instruction: "Replace your unsafe query with 'suggested_safe_sql' and run check_migration again.",
                  },
                },
              }, null, 2),
            }],
            isError: true,
          };
        }

        const originalDraft = activeSession?.originalDraft;
        const attemptNumber = activeSession ? activeSession.attempt + 1 : 1;
        if (risk.level === 'low' && activeSession) {
          clearRetrySession(projectDir);
        } else if (currentAttempt >= 4 || isDestructive || !fixResult.fixed) {
          clearRetrySession(projectDir);
        }

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
          attempt: attemptNumber,
          originalDraft,
        };

        // ── Approval Mode & Decision Gate ────────────────────────
        const canAutoApprove = autoApprove.includes(risk.level as any) && risk.level !== 'high';

        if (canAutoApprove) {
          auditEntry.decision = 'auto_allowed';
          writeAuditEntry(auditEntry, auditDir);
          publishEvent(auditEntry, ipcDir);
          logActivityFromReport('check_migration', report, auditDir);

          let autoApplied = false;
          let applyError: string | undefined;
          let applyTimeMs: number | undefined;

          if (auto_apply !== false) {
            const targetUrl = db_url || findDatabaseUrl(projectDir);
            if (targetUrl) {
              const { applyToRealDatabase } = await import('../core/applier.js');
              const applyRes = await applyToRealDatabase(migration_sql, targetUrl);
              autoApplied = applyRes.success;
              applyTimeMs = applyRes.executionTimeMs;
              applyError = applyRes.error;
            }
          }

          const responseData = {
            ...report,
            applied: autoApplied,
            executionTimeMs: applyTimeMs,
            applyError,
            guardian: {
              risk: risk.level,
              decision: 'auto_allowed',
              message: autoApplied
                ? `✅ Auto-approved (${mode} mode, ${risk.level.toUpperCase()} risk) and automatically applied to database (${applyTimeMs}ms).`
                : `✅ Auto-approved (${mode} mode, ${risk.level.toUpperCase()} risk).`,
            },
            destructiveActionRequired:
              report.hasDestructive && !confirm_destructive && risk.level !== 'high'
                ? '🚨 ATTENTION AI AGENT: This migration contains DESTRUCTIVE operations (DROP TABLE or DROP COLUMN) which will permanently delete user data. You MUST pause and ask the user for confirmation: "This migration contains destructive operations (DROP TABLE/COLUMN). Do you approve running this destructive migration?". Only if the user explicitly confirms "yes", call check_migration again with confirm_destructive: true.'
                : undefined,
          };

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(responseData, null, 2),
            }],
          };
        }

        // Every non-auto-approved risk level is shown to the human in the watcher terminal:
        // 🔴 HIGH needs a typed override, 🟡/🟢 a y/N answer.
        const outcome = await requestApproval(auditEntry, ipcDir);

        if (risk.level === 'high' && outcome !== 'approved') {
          auditEntry.decision = outcome === 'rejected' ? 'user_rejected' : 'blocked';
          writeAuditEntry(auditEntry, auditDir);
          if (outcome === 'no-watcher') publishEvent(auditEntry, ipcDir);
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
                  message: highRiskBlockedMessage(risk.errorCount, outcome),
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

        if (outcome === 'approved') {
          auditEntry.decision = risk.level === 'high' ? 'user_override' : 'user_approved';
          writeAuditEntry(auditEntry, auditDir);
          logActivityFromReport('check_migration', report, auditDir);

          let autoApplied = false;
          let applyError: string | undefined;
          let applyTimeMs: number | undefined;

          if (auto_apply !== false) {
            const targetUrl = db_url || findDatabaseUrl(projectDir);
            if (targetUrl) {
              const { applyToRealDatabase } = await import('../core/applier.js');
              const applyRes = await applyToRealDatabase(migration_sql, targetUrl);
              autoApplied = applyRes.success;
              applyTimeMs = applyRes.executionTimeMs;
              applyError = applyRes.error;
            }
          }

          const responseData = {
            ...report,
            applied: autoApplied,
            executionTimeMs: applyTimeMs,
            applyError,
            guardian: {
              risk: risk.level,
              decision: auditEntry.decision,
              message: autoApplied
                ? `✅ Approved by user in Migration Guardian terminal and automatically applied to database (${applyTimeMs}ms).`
                : risk.level === 'high'
                ? '⚠️ HIGH RISK OVERRIDDEN: the user typed "override" in the Migration Guardian terminal to allow this despite blocking errors.'
                : '✅ Approved by user. Migration passed guardian review.',
            },
            destructiveActionRequired:
              report.hasDestructive && !confirm_destructive && risk.level !== 'high'
                ? '🚨 ATTENTION AI AGENT: This migration contains DESTRUCTIVE operations (DROP TABLE or DROP COLUMN) which will permanently delete user data. You MUST pause and ask the user for confirmation: "This migration contains destructive operations (DROP TABLE/COLUMN). Do you approve running this destructive migration?". Only if the user explicitly confirms "yes", call check_migration again with confirm_destructive: true.'
                : undefined,
          };

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(responseData, null, 2),
            }],
          };
        }

        // 🟡 / 🟢 not approved: rejected, timed out, or nobody watching
        auditEntry.decision = 'user_rejected';
        writeAuditEntry(auditEntry, auditDir);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              passed: false,
              guardian: {
                risk: risk.level,
                decision: outcome === 'no-watcher' ? 'awaiting_watcher' : 'user_rejected',
                message: notApprovedMessage(outcome),
              },
            }, null, 2),
          }],
          isError: true,
        };
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
    'Static analysis only — check migration SQL against 10 safety rules without executing. No Docker or database required. HIGH risk queries are blocked unless the user overrides them in the Migration Guardian terminal. Others require user approval there.',
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

        const fixResult = fixMigrationSql(migration_sql, report.violations);
        const isDestructive = (report.hasDestructive || report.violations.some((v) => v.ruleId === 'MG005' || v.ruleId === 'MG006')) && !confirm_destructive;
        const activeSession = getRetrySession(projectDir);
        const currentAttempt = (activeSession ? activeSession.attempt : 0) + 1;

        const { mode, autoApprove } = getApprovalMode(projectDir);

        const isFixableRetry =
          ((risk.level === 'high') || (mode === 'auto' && risk.level === 'medium')) &&
          fixResult.fixed &&
          !isDestructive &&
          currentAttempt < 4;
        if (isFixableRetry) {
          retrySessions.set(projectDir, {
            attempt: currentAttempt,
            originalDraft: activeSession?.originalDraft || {
              query: migration_sql,
              violations: report.violations.map((v) => ({
                ruleId: v.ruleId,
                severity: v.severity,
                message: v.message,
                line: v.line,
              })),
              errorCount: risk.errorCount,
            },
            lastTimestamp: Date.now(),
          });

          const retryEntry: AuditEntry = {
            id: auditId,
            timestamp: new Date().toISOString(),
            tool: 'analyze_migration',
            project: projectDir,
            risk: risk.level,
            decision: 'auto_retry',
            query: migration_sql,
            violations: report.violations.map((v) => ({
              ruleId: v.ruleId,
              severity: v.severity,
              message: v.message,
              line: v.line,
            })),
            errorCount: risk.errorCount,
            warningCount: risk.warningCount,
            attempt: currentAttempt,
          };
          writeAuditEntry(retryEntry, auditDir);
          publishEvent(retryEntry, ipcDir);
          logActivityFromReport('analyze_migration', report, auditDir);

          const retryMessage = risk.level === 'high'
            ? `⚠️ MIGRATION REJECTED (Attempt ${currentAttempt}/4): Detected ${risk.errorCount} blocking safety violation(s). You must rewrite your query using the suggested safe SQL below and retry.`
            : `⚠️ MIGRATION NOTICES (Attempt ${currentAttempt}/4): Detected ${risk.warningCount} warning(s). Please rewrite your query using the suggested safe SQL below to eliminate warnings and make it safe (LOW risk) before execution.`;

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                ...report,
                guardian: {
                  risk: risk.level,
                  decision: 'auto_retry',
                  attempt: currentAttempt,
                  max_attempts: 4,
                  message: retryMessage,
                  auto_fix: {
                    available: true,
                    suggested_safe_sql: fixResult.fixedSql,
                    applied_fixes: fixResult.appliedFixes,
                    instruction: "Replace your unsafe query with 'suggested_safe_sql' and run analyze_migration again.",
                  },
                },
              }, null, 2),
            }],
            isError: true,
          };
        }

        const originalDraft = activeSession?.originalDraft;
        const attemptNumber = activeSession ? activeSession.attempt + 1 : 1;
        if (risk.level === 'low' && activeSession) {
          clearRetrySession(projectDir);
        } else if (currentAttempt >= 4 || isDestructive || !fixResult.fixed) {
          clearRetrySession(projectDir);
        }

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
          attempt: attemptNumber,
          originalDraft,
        };

        // ── Approval Mode & Decision Gate ────────────────────────
        const canAutoApprove = autoApprove.includes(risk.level as any) && risk.level !== 'high';

        if (canAutoApprove) {
          auditEntry.decision = 'auto_allowed';
          writeAuditEntry(auditEntry, auditDir);
          publishEvent(auditEntry, ipcDir);
          logActivityFromReport('analyze_migration', report, auditDir);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                ...report,
                guardian: {
                  risk: risk.level,
                  decision: 'auto_allowed',
                  message: `✅ Auto-approved (${mode} mode, ${risk.level.toUpperCase()} risk).`,
                },
              }, null, 2),
            }],
          };
        }

        const outcome = await requestApproval(auditEntry, ipcDir);

        // 🔴 HIGH: blocked unless the user typed "override" in the terminal
        if (risk.level === 'high' && outcome !== 'approved') {
          auditEntry.decision = outcome === 'rejected' ? 'user_rejected' : 'blocked';
          writeAuditEntry(auditEntry, auditDir);
          if (outcome === 'no-watcher') publishEvent(auditEntry, ipcDir);
          logActivityFromReport('analyze_migration', report, auditDir);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                ...report,
                guardian: {
                  risk: risk.level,
                  decision: 'blocked',
                  message: highRiskBlockedMessage(risk.errorCount, outcome),
                },
              }, null, 2),
            }],
            isError: true,
          };
        }

        if (outcome === 'approved') {
          auditEntry.decision = risk.level === 'high' ? 'user_override' : 'user_approved';
          writeAuditEntry(auditEntry, auditDir);
          logActivityFromReport('analyze_migration', report, auditDir);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                ...report,
                guardian: {
                  risk: risk.level,
                  decision: auditEntry.decision,
                  message: risk.level === 'high'
                    ? '⚠️ HIGH RISK OVERRIDDEN: the user typed "override" in the Migration Guardian terminal.'
                    : `✅ Approved by user.`,
                },
              }, null, 2),
            }],
          };
        }

        auditEntry.decision = 'user_rejected';
        writeAuditEntry(auditEntry, auditDir);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              passed: false,
              guardian: {
                risk: risk.level,
                decision: outcome === 'no-watcher' ? 'awaiting_watcher' : 'user_rejected',
                message: notApprovedMessage(outcome),
              },
            }, null, 2),
          }],
          isError: true,
        };
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
        .default(true)
        .optional()
        .describe(
          'Certifies human user approved applying this migration. Automatically confirmed when running with terminal watcher.'
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
        if (confirm_user_approved === false && !isWatcherActive(ipcDir)) {
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

        let auditDecision: string = 'user_approved';
        let appliedRiskLevel: string = 'low';
        let activeApprovalMode: string = 'manual';

        try {
          const verifyConfig = loadConfig({
            confirmDestructive: confirm_destructive ?? false,
            output: { format: 'json', verbose: false },
          });

          const preCheckReport = await runCheck(verifyFile, verifyConfig, 'analyze');
          const risk = classifyRisk(preCheckReport.violations);
          appliedRiskLevel = risk.level;
          const auditId = generateAuditId();

          const blockingErrors = preCheckReport.violations.filter(
            (v) => v.severity === 'error'
          );

          const fixResult = fixMigrationSql(migration_sql, blockingErrors);
          const isDestructive = (preCheckReport.hasDestructive || blockingErrors.some((v) => v.ruleId === 'MG005' || v.ruleId === 'MG006')) && !confirm_destructive;
          const activeSession = getRetrySession(projectDir);
          const currentAttempt = (activeSession ? activeSession.attempt : 0) + 1;

          // ── Autonomous Retry Loop (Attempts 1 to 3) ──────────────
          if (blockingErrors.length > 0 && fixResult.fixed && !isDestructive && currentAttempt < 4) {
            retrySessions.set(projectDir, {
              attempt: currentAttempt,
              originalDraft: activeSession?.originalDraft || {
                query: migration_sql,
                violations: blockingErrors.map((v) => ({
                  ruleId: v.ruleId,
                  severity: v.severity,
                  message: v.message,
                  line: v.line,
                })),
                errorCount: blockingErrors.length,
              },
              lastTimestamp: Date.now(),
            });

            const retryAudit: AuditEntry = {
              id: auditId,
              timestamp: new Date().toISOString(),
              tool: 'apply_migration',
              project: projectDir,
              risk: 'high',
              decision: 'auto_retry',
              query: migration_sql,
              violations: preCheckReport.violations.map((v) => ({
                ruleId: v.ruleId,
                severity: v.severity,
                message: v.message,
                line: v.line,
              })),
              errorCount: risk.errorCount,
              warningCount: risk.warningCount,
              attempt: currentAttempt,
            };
            writeAuditEntry(retryAudit, auditDir);
            publishEvent(retryAudit, ipcDir);

            const violationSummary = blockingErrors
              .map((v) => `[${v.ruleId}] ${v.message} (Line ${v.line})`)
              .join('; ');

            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: `SECURITY GATE REJECTION (Attempt ${currentAttempt}/4): Cannot apply migration. Detected ${blockingErrors.length} blocking violation(s): ${violationSummary}`,
                  guardian: {
                    risk: 'high',
                    decision: 'auto_retry',
                    attempt: currentAttempt,
                    max_attempts: 4,
                    message: `Attempt ${currentAttempt}/4: Unsafe migration rejected. Rewrite with suggested_safe_sql and call apply_migration again.`,
                  },
                  violations: blockingErrors,
                  auto_fix: {
                    available: true,
                    suggested_safe_sql: fixResult.fixedSql,
                    applied_fixes: fixResult.appliedFixes,
                    instruction: "You must use 'suggested_safe_sql' to apply zero-downtime safe migrations.",
                  },
                }, null, 2),
              }],
              isError: true,
            };
          }

          const originalDraft = activeSession?.originalDraft;
          const attemptNumber = activeSession ? activeSession.attempt + 1 : 1;
          if (blockingErrors.length === 0 && activeSession) {
            clearRetrySession(projectDir);
          } else if (currentAttempt >= 4 || isDestructive) {
            clearRetrySession(projectDir);
          }

          const applyAudit: AuditEntry = {
            id: auditId,
            timestamp: new Date().toISOString(),
            tool: 'apply_migration',
            project: projectDir,
            risk: blockingErrors.length > 0 ? 'high' : risk.level,
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
            attempt: attemptNumber,
            originalDraft,
          };

          // ── Approval Mode & Decision Gate ────────────────────────
          const { mode, autoApprove } = getApprovalMode(projectDir);
          const canAutoApprove = autoApprove.includes(risk.level as any) && blockingErrors.length === 0 && risk.level !== 'high';

          if (canAutoApprove) {
            applyAudit.decision = 'auto_allowed';
            writeAuditEntry(applyAudit, auditDir);
            publishEvent(applyAudit, ipcDir);
          } else {
            // Every non-auto-approved apply is shown in the watcher terminal; 🔴 needs a typed override
            const outcome = await requestApproval(applyAudit, ipcDir);

            // 🔴 HIGH RISK: blocked unless the user typed "override" in the terminal
            if (blockingErrors.length > 0 && outcome !== 'approved') {
              const violationSummary = blockingErrors
                .map((v) => `[${v.ruleId}] ${v.message} (Line ${v.line})`)
                .join('; ');

              applyAudit.decision = outcome === 'rejected' ? 'user_rejected' : 'blocked';
              writeAuditEntry(applyAudit, auditDir);
              if (outcome === 'no-watcher') publishEvent(applyAudit, ipcDir);

              const fixResult = fixMigrationSql(migration_sql, blockingErrors);

              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    success: false,
                    error: `SECURITY GATE REJECTION: Cannot apply migration. Detected ${blockingErrors.length} blocking violation(s): ${violationSummary}`,
                    guardian_message: highRiskBlockedMessage(blockingErrors.length, outcome),
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

            // 🟡 MEDIUM / 🟢 LOW not approved
            if (outcome !== 'approved') {
              applyAudit.decision = 'user_rejected';
              writeAuditEntry(applyAudit, auditDir);

              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    success: false,
                    guardian: {
                      risk: risk.level,
                      decision: outcome === 'no-watcher' ? 'awaiting_watcher' : 'user_rejected',
                      message: notApprovedMessage(outcome),
                    },
                  }, null, 2),
                }],
                isError: true,
              };
            }

            applyAudit.decision = blockingErrors.length > 0 ? 'user_override' : 'user_approved';
            writeAuditEntry(applyAudit, auditDir);
          }

          auditDecision = applyAudit.decision;
          activeApprovalMode = mode;
        } finally {
          try {
            rmSync(verifyDir, { recursive: true, force: true });
          } catch {}
        }

        // ── Execute against real database ────────────────────────
        const targetUrl =
          db_url ||
          findDatabaseUrl(projectDir) ||
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

        const guardianInfo = {
          risk: appliedRiskLevel,
          decision: auditDecision,
          message: auditDecision === 'auto_allowed'
            ? `✅ Auto-approved (${activeApprovalMode} mode, ${appliedRiskLevel.toUpperCase()} risk) and applied to database (${result.executionTimeMs}ms).`
            : (auditDecision === 'user_override'
              ? '⚠️ HIGH RISK OVERRIDDEN: the user typed "override" in the Migration Guardian terminal to allow this despite blocking errors.'
              : `✅ Approved by user in Migration Guardian terminal and applied to database (${result.executionTimeMs}ms).`),
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ...result,
              guardian: guardianInfo,
            }, null, 2),
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

/**
 * Message for a 🔴 HIGH risk query that was not overridden.
 */
function highRiskBlockedMessage(errorCount: number, outcome: ApprovalOutcome): string {
  const base = `🔴 BLOCKED by Migration Guardian. ${errorCount} blocking error(s) detected. Fix the violations before proceeding.`;
  switch (outcome) {
    case 'rejected':
      return `${base} The user reviewed it in the Migration Guardian terminal and kept it blocked.`;
    case 'timeout':
      return `${base} The user did not override it in the Migration Guardian terminal within 2 minutes.`;
    default:
      return `${base} Only the user can override a HIGH risk block, from the Migration Guardian terminal (npx mgcheck).`;
  }
}

/**
 * Message for a 🟡/🟢 query that was not approved.
 */
function notApprovedMessage(outcome: ApprovalOutcome): string {
  switch (outcome) {
    case 'no-watcher':
      return '⏸️ Not run: no Migration Guardian terminal is open, so nobody can approve this. Ask the user to run `npx mgcheck` in a terminal, then call this tool again.';
    case 'timeout':
      return '⏰ No answer in the Migration Guardian terminal within 2 minutes. Rejected by default.';
    default:
      return '❌ Rejected by the user in the Migration Guardian terminal.';
  }
}
