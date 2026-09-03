#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig } from './core/config.js';
import { runCheck } from './core/engine.js';
import { renderReport, getExitCode } from './reporter/index.js';
import type { MgcheckConfig, OutputFormat, ShadowProvider } from './core/types.js';

const program = new Command();

program
  .name('mgcheck')
  .description('🛡️  Migration Guardian — Catch unsafe database migrations before they hit production')
  .version('0.1.0');

// ─── mgcheck run ────────────────────────────────────────────────────

program
  .command('run')
  .description('Analyze and execute a migration against a shadow database')
  .argument('<path>', 'Path to migration file or directory')
  .option('--db-url <url>', 'Use existing Postgres URL instead of spinning up Docker')
  .option('--target-db-url <url>', 'Target real PostgreSQL URL to apply verified migration to')
  .option('--apply', 'Automatically apply to target database if verification passes', false)
  .option('--seed <path>', 'Base schema SQL to apply before target migration')
  .option('--docker-image <image>', 'Postgres Docker image', 'postgres:16-alpine')
  .option('--provider <provider>', 'Shadow DB provider: docker | pglite', 'docker')
  .option('--format <format>', 'Output format: terminal | json | markdown', 'terminal')
  .option('--ci', 'Machine-readable JSON output + exit codes only', false)
  .option('--confirm-destructive', 'Allow destructive operations (DROP, TRUNCATE)', false)
  .option('--verbose', 'Show detailed execution logs', false)
  .option('--config <path>', 'Path to config file')
  .action(async (inputPath: string, options: any) => {
    try {
      const config = buildConfig(options);
      const format = options.ci ? 'json' : (config.output.format as OutputFormat);

      const report = await runCheck(inputPath, config, 'run', (msg) => {
        if (config.output.verbose && !options.ci) {
          console.error(`  ${msg}`);
        }
      });

      const output = renderReport(report, format);
      console.log(output);

      // If verification passed and not in CI mode, prompt to apply to real database
      if (report.passed && !options.ci) {
        const fullSql = report.migration.files.map((f) => f.sql).join('\n');
        const { promptAndApplyIfConfirmed } = await import('./core/applier.js');
        await promptAndApplyIfConfirmed(fullSql, {
          targetDbUrl: options.targetDbUrl,
          autoApply: options.apply,
          isCi: options.ci,
        });
      }

      process.exitCode = getExitCode(report);
    } catch (err) {
      if (options.ci) {
        console.log(JSON.stringify({ error: (err as Error).message }, null, 2));
      } else {
        console.error(`\n  ❌ Error: ${(err as Error).message}\n`);
      }
      process.exitCode = 3;
    }
  });

// ─── mgcheck analyze ───────────────────────────────────────────────

program
  .command('analyze')
  .description('Static analysis only — check migration SQL against safety rules (no shadow DB)')
  .argument('<path>', 'Path to migration file or directory')
  .option('--format <format>', 'Output format: terminal | json | markdown', 'terminal')
  .option('--ci', 'Machine-readable JSON output + exit codes only', false)
  .option('--confirm-destructive', 'Allow destructive operations', false)
  .option('--verbose', 'Show detailed logs', false)
  .option('--config <path>', 'Path to config file')
  .action(async (inputPath: string, options: any) => {
    try {
      const config = buildConfig(options);
      const format = options.ci ? 'json' : (config.output.format as OutputFormat);

      const report = await runCheck(inputPath, config, 'analyze', (msg) => {
        if (config.output.verbose && !options.ci) {
          console.error(`  ${msg}`);
        }
      });

      const output = renderReport(report, format);
      console.log(output);

      process.exitCode = getExitCode(report);
    } catch (err) {
      if (options.ci) {
        console.log(JSON.stringify({ error: (err as Error).message }, null, 2));
      } else {
        console.error(`\n  ❌ Error: ${(err as Error).message}\n`);
      }
      process.exitCode = 3;
    }
  });

// ─── mgcheck mcp ───────────────────────────────────────────────────

program
  .command('mcp')
  .description('Start the MCP server for AI agent integration (stdio transport)')
  .action(async () => {
    await import('./mcp/server.js');
  });

// ─── mgcheck setup ─────────────────────────────────────────────────

program
  .command('setup')
  .alias('init')
  .alias('install-mcp')
  .description('Interactive wizard to connect Migration Guardian to Antigravity, Cursor, and Claude')
  .option('-y, --yes', 'Skip confirmation prompt and connect automatically', false)
  .option('--client <client>', 'Target client: antigravity | claude | cursor | all', 'all')
  .action(async (options: any) => {
    const { runInteractiveWizard } = await import('./installer/index.js');
    await runInteractiveWizard({ yes: options.yes, client: options.client });
  });

// ─── Helpers ────────────────────────────────────────────────────────

function buildConfig(options: any): MgcheckConfig {
  const overrides: Partial<MgcheckConfig> = {
    shadowDb: {
      provider: (options.provider || 'docker') as ShadowProvider,
      dockerImage: options.dockerImage || 'postgres:16-alpine',
      dbUrl: options.dbUrl,
      seedFile: options.seed,
    },
    output: {
      format: (options.format || 'terminal') as OutputFormat,
      verbose: options.verbose || false,
    },
    confirmDestructive: options.confirmDestructive || false,
  };

  return loadConfig(overrides, options.config);
}

// ─── Entry Point ────────────────────────────────────────────────────

// If no arguments are passed (e.g. npx mgcheck), launch interactive wizard
if (process.argv.slice(2).length === 0) {
  const { runInteractiveWizard } = await import('./installer/index.js');
  await runInteractiveWizard();
} else {
  program.parse();
}
