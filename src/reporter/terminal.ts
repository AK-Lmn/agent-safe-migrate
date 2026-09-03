import type { MigrationReport } from '../core/types.js';
import chalk from 'chalk';
import { basename } from 'node:path';

/**
 * Rich terminal reporter with colors, symbols, and structured output.
 */
export function renderTerminalReport(report: MigrationReport): string {
  const lines: string[] = [];
  const { migration, execution, violations, passed, hasDestructive } = report;

  // Header
  lines.push('');
  lines.push(chalk.bold.cyan('  mgcheck') + chalk.dim(' v0.1.0 — Migration Guardian'));
  lines.push('');

  // Migration info
  const formatLabel =
    migration.format === 'raw-sql'
      ? 'Raw SQL'
      : migration.format === 'prisma'
        ? 'Prisma'
        : 'Drizzle';

  lines.push(chalk.dim('  📁 Detected: ') + chalk.white(formatLabel + ' migration'));

  for (const file of migration.files) {
    lines.push(chalk.dim('  📄 File: ') + chalk.white(basename(file.path)));
  }

  lines.push('');

  // Inspected Statements
  if (report.statements && report.statements.length > 0) {
    lines.push(chalk.bold(`  📋 Inspected Statements (${report.statements.length})`));
    for (let i = 0; i < report.statements.length; i++) {
      const s = report.statements[i];
      const isLast = i === report.statements.length - 1;
      const prefix = isLast ? '  └─ ' : '  ├─ ';
      const cleanSql = s.raw.replace(/\s+/g, ' ').trim();
      const truncated = cleanSql.length > 70 ? cleanSql.substring(0, 67) + '...' : cleanSql;
      lines.push(chalk.dim(prefix) + chalk.cyan(`[Line ${s.line}] `) + chalk.white(truncated));
    }
    lines.push('');
  }

  // Shadow DB Execution
  if (execution) {
    lines.push(chalk.bold('  ⚡ Shadow Database'));

    if (report.mode === 'run') {
      lines.push(chalk.dim('  ├─ Provider: ') + chalk.white('Shadow Postgres'));
    }

    if (execution.success) {
      lines.push(
        chalk.dim('  └─ Execution: ') +
          chalk.green('✅ Success') +
          chalk.dim(
            ` (${execution.executionTimeMs}ms, ${execution.statementsExecuted} statement${execution.statementsExecuted !== 1 ? 's' : ''})`
          )
      );
    } else {
      lines.push(chalk.dim('  └─ Execution: ') + chalk.red('❌ Failed'));
      lines.push('');
      lines.push(chalk.red('  Error:'));
      const errorLines = (execution.error || 'Unknown error').split('\n');
      for (const errorLine of errorLines) {
        lines.push(chalk.red('    ' + errorLine));
      }
    }

    lines.push('');
  }

  // Rule Analysis
  if (violations.length > 0) {
    lines.push(chalk.bold('  🔍 Rule Analysis'));
    lines.push('');

    // Summary table
    const errors = violations.filter((v) => v.severity === 'error');
    const warnings = violations.filter((v) => v.severity === 'warning');

    if (errors.length > 0 || warnings.length > 0) {
      lines.push(
        chalk.dim('  ┌─────────┬────────────────────────────────────────┬──────────┐')
      );
      lines.push(
        chalk.dim('  │') +
          chalk.bold(' Rule    ') +
          chalk.dim('│') +
          chalk.bold(' Issue                                  ') +
          chalk.dim('│') +
          chalk.bold(' Severity ') +
          chalk.dim('│')
      );
      lines.push(
        chalk.dim('  ├─────────┼────────────────────────────────────────┼──────────┤')
      );

      for (const v of violations) {
        const ruleCol = v.ruleId.padEnd(7);
        const issueCol = truncate(v.ruleName, 38).padEnd(38);
        const sevIcon = v.severity === 'error' ? chalk.red('❌ error') : chalk.yellow('⚠  warn');
        const sevCol = v.severity === 'error' ? sevIcon + ' ' : sevIcon + '  ';

        lines.push(
          chalk.dim('  │ ') + chalk.white(ruleCol) + chalk.dim(' │ ') + chalk.white(issueCol) + chalk.dim(' │ ') + sevCol + chalk.dim('│')
        );
      }

      lines.push(
        chalk.dim('  └─────────┴────────────────────────────────────────┴──────────┘')
      );
      lines.push('');
    }

    // Detailed violations
    for (const v of violations) {
      const icon = v.severity === 'error' ? chalk.red('❌') : chalk.yellow('⚠️');
      lines.push(
        `  ${icon} ${chalk.bold(v.ruleId)}: ${chalk.bold(v.ruleName)}`
      );

      if (v.line && v.sql && v.sql !== '(no down migration file found)') {
        lines.push(
          chalk.dim(`  Line ${v.line}: `) + chalk.gray(truncate(v.sql, 80))
        );
      }

      lines.push('');
      lines.push(chalk.dim('  Why this is dangerous:'));
      const msgLines = wordWrap(v.message, 70);
      for (const ml of msgLines) {
        lines.push(chalk.white('    ' + ml));
      }

      if (v.suggestion) {
        lines.push('');
        lines.push(chalk.dim('  Suggested fix:'));
        const sugLines = v.suggestion.split('\n');
        for (const sl of sugLines) {
          lines.push(chalk.green('    ' + sl));
        }
      }

      lines.push('');
      lines.push(chalk.dim('  ──────────────────────────────────────────'));
      lines.push('');
    }
  } else if (report.mode === 'analyze') {
    lines.push(chalk.bold('  🔍 Rule Analysis'));
    lines.push('');
    lines.push(chalk.green('  ✅ No rule violations found'));
    lines.push('');
  }

  // Destructive warning
  if (hasDestructive) {
    lines.push(
      chalk.bgRed.white.bold(' ⚠  DESTRUCTIVE OPERATIONS DETECTED ') +
        chalk.red(' Use --confirm-destructive to proceed')
    );
    lines.push('');
  }

  // Final result
  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warnCount = violations.filter((v) => v.severity === 'warning').length;

  if (passed) {
    lines.push(
      chalk.bgGreen.black.bold(' ✅ PASSED ') +
        chalk.green(
          warnCount > 0
            ? ` (${warnCount} warning${warnCount !== 1 ? 's' : ''})`
            : ' All checks passed'
        )
    );
  } else {
    lines.push(
      chalk.bgRed.white.bold(' ❌ FAILED ') +
        chalk.red(
          ` (${errorCount} error${errorCount !== 1 ? 's' : ''}, ${warnCount} warning${warnCount !== 1 ? 's' : ''})`
        )
    );
  }

  lines.push('');

  return lines.join('\n');
}

function truncate(str: string, maxLen: number): string {
  // Remove newlines for table display
  const clean = str.replace(/\n/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, maxLen - 3) + '...';
}

function wordWrap(str: string, maxLen: number): string[] {
  const words = str.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 > maxLen && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }

  if (current) lines.push(current);
  return lines;
}
