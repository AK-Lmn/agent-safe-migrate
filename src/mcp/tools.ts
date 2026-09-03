import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCheck } from '../core/engine.js';
import { loadConfig } from '../core/config.js';
import { logActivity } from '../core/activity-log.js';
import type { MigrationReport } from '../core/types.js';

/**
 * Register MCP tools on the server.
 */
export function runMcpTools(server: McpServer) {
  // Tool 1: check_migration — full pipeline (analyze + execute)
  server.tool(
    'check_migration',
    'Analyze a database migration for safety issues and execute it against a disposable shadow PostgreSQL database. Returns a detailed report with violations, explanations, and suggested fixes.',
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
    },
    async ({ migration_sql, base_schema_sql, confirm_destructive, provider }) => {
      try {
        // Write SQL to a temp file for the engine
        const tmpDir = mkdtempSync(join(tmpdir(), 'mgcheck-'));
        const tmpFile = join(tmpDir, 'migration.sql');
        writeFileSync(tmpFile, migration_sql, 'utf-8');

        // If base schema provided, write it too
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

        logActivityFromReport('check_migration', report);

        const responseData = {
          ...report,
          destructiveActionRequired:
            report.hasDestructive && !confirm_destructive
              ? '🚨 ATTENTION AI AGENT: This migration contains DESTRUCTIVE operations (DROP TABLE or DROP COLUMN) which will permanently delete user data. You MUST pause and ask the user for confirmation: "This migration contains destructive operations (DROP TABLE/COLUMN). Do you approve running this destructive migration?". Only if the user explicitly confirms "yes", call check_migration again with confirm_destructive: true.'
              : undefined,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(responseData, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { error: (err as Error).message },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: analyze_migration — static analysis only (no Docker needed)
  server.tool(
    'analyze_migration',
    'Static analysis only — check migration SQL against 10 safety rules without executing. No Docker or database required.',
    {
      migration_sql: z
        .string()
        .describe('The SQL content of the migration to analyze'),
      confirm_destructive: z
        .boolean()
        .default(false)
        .describe('Set to true to allow destructive operations'),
    },
    async ({ migration_sql, confirm_destructive }) => {
      try {
        const tmpDir = mkdtempSync(join(tmpdir(), 'mgcheck-'));
        const tmpFile = join(tmpDir, 'migration.sql');
        writeFileSync(tmpFile, migration_sql, 'utf-8');

        const config = loadConfig({
          confirmDestructive: confirm_destructive,
          output: { format: 'json', verbose: false },
        });

        const report = await runCheck(tmpFile, config, 'analyze');

        logActivityFromReport('analyze_migration', report);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(report, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { error: (err as Error).message },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: apply_migration — applies verified SQL directly to target database
  server.tool(
    'apply_migration',
    'Apply a verified SQL migration directly to the real target database. Use this ONLY after verifying with check_migration and receiving explicit user confirmation in chat.',
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
    },
    async ({ migration_sql, db_url, confirm_user_approved }) => {
      try {
        if (!confirm_user_approved) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error:
                      'User confirmation required. You must ask the human user for approval before calling apply_migration with confirm_user_approved: true.',
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const targetUrl =
          db_url ||
          process.env.TARGET_DATABASE_URL ||
          process.env.DATABASE_URL;

        if (!targetUrl) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error:
                      'No database connection URL found. Please pass db_url or set the DATABASE_URL environment variable.',
                  },
                  null,
                  2
                ),
              },
            ],
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
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: (err as Error).message,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Extract info from a report and write to the shared activity log.
 */
function logActivityFromReport(tool: string, report: MigrationReport): void {
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
    });
  } catch {
    // Never let logging break the MCP response
  }
}
