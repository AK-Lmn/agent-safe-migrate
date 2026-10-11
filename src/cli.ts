#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from './core/config.js';
import { runCheck } from './core/engine.js';
import { renderReport, getExitCode } from './reporter/index.js';
import type { MgcheckConfig, OutputFormat, ShadowProvider } from './core/types.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('mgcheck')
  .description('🛡️  Migration Guardian — Catch unsafe database migrations before they hit production')
  .version(VERSION);

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
  .option('--fix', 'Attempt zero-downtime auto-fix and prompt with verified diff if unsafe', false)
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

      // If check failed and --fix was requested, attempt automated safe fix
      if (!report.passed && options.fix && !options.ci) {
        const { runAutoFix } = await import('./fixer/index.js');
        const fixResult = await runAutoFix(inputPath, report.violations, {
          seedFile: options.seed,
          provider: options.provider,
          config,
        });

        if (fixResult.fixed && fixResult.verified) {
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

// ─── mgcheck fix ───────────────────────────────────────────────────

program
  .command('fix')
  .description('Automatically fix unsafe migrations with zero-downtime patterns and shadow DB verification')
  .argument('<path>', 'Path to migration file')
  .option('--seed <path>', 'Base schema SQL to apply before verification')
  .option('--provider <provider>', 'Shadow DB provider: docker | pglite', 'pglite')
  .option('--config <path>', 'Path to config file')
  .action(async (inputPath: string, options: any) => {
    try {
      const config = buildConfig(options);
      let report = await runCheck(inputPath, config, 'analyze');

      if (report.passed) {
        console.log(chalk.green('\n  ✅ Migration is already safe! No fixes needed.\n'));
        return;
      }

      const { runAutoFix } = await import('./fixer/index.js');
      const fixResult = await runAutoFix(inputPath, report.violations, {
        seedFile: options.seed,
        provider: options.provider,
        config,
      });

      if (!fixResult.fixed) {
        console.log(chalk.yellow('\n  ⚠️  No automated safe rewrite pattern available for these violations.\n'));
        process.exitCode = 1;
        return;
      }

      if (!fixResult.verified) {
        console.log(chalk.red(`\n  ❌ Automated fix failed shadow verification: ${fixResult.verificationError}\n`));
        process.exitCode = 1;
        return;
      }

      process.exitCode = 0;
    } catch (err) {
      console.error(chalk.red(`\n  ❌ Error: ${(err as Error).message}\n`));
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
  .option('--purge', 'Also delete audit logs (~/.mgcheck and ./.mgcheck) and the .gitignore entry', false)
  .action(async (options: any) => {
    const { runUninstallWizard } = await import('./installer/index.js');
    await runUninstallWizard({ yes: options.yes, client: options.client, purge: options.purge });
  });

// ─── mgcheck hook ───────────────────────────────────────────────────

program
  .command('hook')
  .description('Manage Git pre-commit safety hooks in the current repository')
  .argument('[action]', 'Action to perform: install | uninstall | run (check staged .sql files; used by the hook)', 'install')
  .action(async (action: string) => {
    const { installGitHook, uninstallGitHook } = await import('./installer/index.js');
    if (action === 'run') {
      process.exitCode = await runStagedMigrationCheck();
      return;
    }
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
    } else {
      console.error(`\n  ❌ Unknown hook action "${action}". Use: install | uninstall | run\n`);
      process.exitCode = 1;
    }
  });

/**
 * Static check of every staged .sql file (no shadow DB, so it stays fast enough
 * for a pre-commit hook). Only blocking errors fail the commit; warnings are shown.
 */
async function runStagedMigrationCheck(): Promise<number> {
  const { relative } = await import('node:path');
  const { getStagedMigrations } = await import('./installer/index.js');

  let files: string[];
  try {
    files = getStagedMigrations(process.cwd());
  } catch {
    console.error(chalk.red('  ❌ Migration Guardian: not inside a Git repository.'));
    return 1;
  }
  if (files.length === 0) return 0;

  console.log(chalk.cyan(`🛡️  Migration Guardian: checking ${files.length} staged migration${files.length === 1 ? '' : 's'}...`));
  const config = buildConfig({ format: 'terminal' });
  const rejected: string[] = [];

  for (const file of files) {
    const name = relative(process.cwd(), file);
    try {
      const report = await runCheck(file, config, 'analyze');
      if (!report.passed) {
        rejected.push(name);
        console.log(renderReport(report, 'terminal'));
      } else {
        for (const v of report.violations) {
          console.log(chalk.yellow(`  ⚠ ${name}${v.line != null ? `:${v.line}` : ''} [${v.ruleId}] `) + v.message);
        }
      }
    } catch (err) {
      rejected.push(name);
      console.log(chalk.red(`  ✗ ${name}: ${(err as Error).message}`));
    }
  }

  if (rejected.length > 0) {
    console.log(chalk.red.bold(`\n❌ Commit rejected: unsafe migration${rejected.length === 1 ? '' : 's'} in ${rejected.join(', ')}`));
    console.log(chalk.dim(`💡 Auto-fix with: npx mgcheck fix ${rejected[0]}`));
    console.log(chalk.dim('   Bypass once (not recommended): git commit --no-verify\n'));
    return 1;
  }

  console.log(chalk.green('✅ Migration Guardian: staged migrations passed (warnings do not block commits).'));
  return 0;
}

// ─── mgcheck log ────────────────────────────────────────────────────

program
  .command('log')
  .alias('audit')
  .description('View the audit log of all migration queries intercepted by Migration Guardian')
  .option('--all', 'Show all entries (default: last 20)', false)
  .option('--risk <level>', 'Filter by risk level: high | medium | low')
  .option('--tail', 'Live tail mode — watch for new entries', false)
  .option('--json', 'Output raw JSON lines', false)
  .option('--global', 'View global audit log (~/.mgcheck/audit.jsonl) instead of project audit log', false)
  .action(async (options: any) => {
    try {
      const {
        readAuditLog,
        formatAuditEntry,
        getAuditFile,
        getGlobalAuditFile,
      } = await import('./core/activity-log.js');
      const chalk = (await import('chalk')).default;

      const auditFile = options.global ? getGlobalAuditFile() : getAuditFile();
      let entries = readAuditLog({ global: options.global });

      if (entries.length === 0) {
        console.log(chalk.dim('\n  No audit entries found yet.'));
        console.log(chalk.dim(`  Audit log location: ${auditFile}`));
        if (!options.global) {
          console.log(chalk.dim('  (Run `mgcheck log --global` to check machine-wide global logs)'));
        }
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
      console.log(chalk.dim(`  File: ${auditFile}`));
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
