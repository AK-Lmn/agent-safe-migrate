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
