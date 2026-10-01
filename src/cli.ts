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
  .version('0.1.5');

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

      let report = await runCheck(inputPath, config, 'run', (msg) => {
        if (config.output.verbose && !options.ci) {
          console.error(`  ${msg}`);
        }
      });

      // If blocked because of unconfirmed destructive operations in an interactive terminal, prompt user
      if (
        !report.passed &&
        report.hasDestructive &&
        !config.confirmDestructive &&
        !options.ci &&
        process.stdin.isTTY
      ) {
        const destructiveViolations = report.violations.filter(
          (v) => v.ruleId === 'MG005' || v.ruleId === 'MG006'
        );
        const { promptDestructiveConfirmation } = await import('./core/applier.js');
        const approved = await promptDestructiveConfirmation(destructiveViolations, options.ci);
        if (approved) {
          config.confirmDestructive = true;
          report = await runCheck(inputPath, config, 'run');
        }
      }

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

      let report = await runCheck(inputPath, config, 'analyze', (msg) => {
        if (config.output.verbose && !options.ci) {
          console.error(`  ${msg}`);
        }
      });

      // If blocked because of unconfirmed destructive operations in an interactive terminal, prompt user
      if (
        !report.passed &&
        report.hasDestructive &&
        !config.confirmDestructive &&
        !options.ci &&
        process.stdin.isTTY
      ) {
        const destructiveViolations = report.violations.filter(
          (v) => v.ruleId === 'MG005' || v.ruleId === 'MG006'
        );
        const { promptDestructiveConfirmation } = await import('./core/applier.js');
        const approved = await promptDestructiveConfirmation(destructiveViolations, options.ci);
        if (approved) {
          config.confirmDestructive = true;
          report = await runCheck(inputPath, config, 'analyze');
        }
      }

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
  .description('Interactive wizard to connect Migration Guardian to AI agents (Antigravity, Cursor, Claude, Cline, Roo, Zed, Continue, Goose, Aider, OpenHands, Windsurf)')
  .option('-y, --yes', 'Skip confirmation prompt and connect automatically', false)
  .option(
    '--client <client>',
    'Target client: antigravity | cursor | claude | claude-code | cline | roo | continue | windsurf | zed | goose | aider | openhands | all',
    'all'
  )
  .option('--with-rules', 'Also write workspace AI rule files (.cursorrules, CLAUDE.md, etc.)', false)
  .action(async (options: any) => {
    const { runInteractiveWizard } = await import('./installer/index.js');
    await runInteractiveWizard({ yes: options.yes, client: options.client, withRules: options.withRules });
  });

// ─── mgcheck uninstall ─────────────────────────────────────────────

program
  .command('uninstall')
  .alias('remove')
  .description('Safely remove Migration Guardian from AI agents, MCP configs, and Git hooks')
  .option('-y, --yes', 'Skip confirmation prompt and uninstall automatically', false)
  .option(
    '--client <client>',
    'Target client: antigravity | cursor | claude | claude-code | cline | roo | continue | windsurf | zed | goose | aider | openhands | all',
    'all'
  )
  .action(async (options: any) => {
    const { runUninstallWizard } = await import('./installer/index.js');
    await runUninstallWizard({ yes: options.yes, client: options.client });
  });

// ─── mgcheck hook ───────────────────────────────────────────────────

program
  .command('hook')
  .description('Manage Git pre-commit safety hooks in the current repository')
  .argument('[action]', 'Action to perform: install | uninstall | status', 'install')
  .action(async (action: string) => {
    const { installGitHook, uninstallGitHook } = await import('./installer/index.js');
    if (action === 'install') {
      const res = installGitHook(process.cwd());
      if (res) {
        console.log(`\n${res}\n`);
      } else {
        console.log('\n  ℹ️  No .git repository found in current directory. Skipped.\n');
      }
    } else if (action === 'uninstall' || action === 'remove') {
      const res = uninstallGitHook(process.cwd());
      if (res) {
        console.log(`\n${res}\n`);
      } else {
        console.log('\n  ℹ️  No active Migration Guardian Git hook found. Skipped.\n');
      }
    }
  });

// ─── mgcheck log ────────────────────────────────────────────────────

program
  .command('log')
  .description('View the audit log of all migration queries intercepted by Migration Guardian')
  .option('--all', 'Show all entries (default: last 20)', false)
  .option('--risk <level>', 'Filter by risk level: high | medium | low')
  .option('--tail', 'Live tail mode — watch for new entries', false)
  .option('--json', 'Output raw JSON lines', false)
  .action(async (options: any) => {
    try {
      const {
        readAuditLog,
        formatAuditEntry,
        AUDIT_FILE,
      } = await import('./core/activity-log.js');
      const chalk = (await import('chalk')).default;

      let entries = readAuditLog();

      if (entries.length === 0) {
        console.log(chalk.dim('\n  No audit entries found yet.'));
        console.log(chalk.dim(`  Audit log location: ${AUDIT_FILE}`));
        console.log(chalk.dim('  Run `mgcheck setup` to start the guardian.\n'));
        return;
      }

      // Filter by risk level
      if (options.risk) {
        entries = entries.filter((e) => e.risk === options.risk);
      }

      // Limit to last 20 unless --all
      if (!options.all) {
        entries = entries.slice(-20);
      }

      if (options.json) {
        for (const entry of entries) {
          console.log(JSON.stringify(entry));
        }
        return;
      }

      // Pretty print
      console.log('');
      console.log(chalk.bold.cyan('  📋 Migration Guardian Audit Log'));
      console.log(chalk.dim(`  File: ${AUDIT_FILE}`));
      console.log(chalk.dim(`  Showing ${entries.length} entries\n`));
      console.log(chalk.dim('  ─────────────────────────────────────────────────────────'));

      for (const entry of entries) {
        console.log('');
        console.log(formatAuditEntry(entry));
      }
      console.log('');
      console.log(chalk.dim('  ─────────────────────────────────────────────────────────\n'));

      // Summary stats
      const blocked = entries.filter((e) => e.decision === 'blocked').length;
      const approved = entries.filter((e) => e.decision === 'user_approved').length;
      const rejected = entries.filter((e) => e.decision === 'user_rejected').length;
      console.log(chalk.dim('  Summary: ') +
        chalk.red(`${blocked} blocked`) + chalk.dim(' | ') +
        chalk.green(`${approved} approved`) + chalk.dim(' | ') +
        chalk.yellow(`${rejected} rejected`)
      );
      console.log('');
    } catch (err) {
      console.error(`\n  ❌ Error reading audit log: ${(err as Error).message}\n`);
      process.exitCode = 3;
    }
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
