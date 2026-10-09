import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import type { FixResult } from './types.js';

/**
 * Format unified diff with rich terminal syntax colors.
 */
export function formatColoredDiff(diffText: string): string {
  const lines = diffText.split('\n');
  const formatted: string[] = [];

  for (const line of lines) {
    if (line.startsWith('+')) {
      formatted.push(chalk.green(`  ${line}`));
    } else if (line.startsWith('-')) {
      formatted.push(chalk.red(`  ${line}`));
    } else {
      formatted.push(chalk.dim(`  ${line}`));
    }
  }

  return formatted.join('\n');
}

/**
 * Displays the verified safe fix diff and interactively prompts the user for permission.
 *
 * STRICT POLICY:
 * - Default is strictly 'N' (No).
 * - Hitting Enter (empty answer) or typing anything other than 'y'/'yes' safely cancels.
 * - Only explicit 'y' or 'yes' overwrites the migration file.
 */
export async function promptUserForFix(
  filePath: string,
  fixResult: FixResult,
  options: {
    isCi?: boolean;
    autoAccept?: boolean;
  } = {}
): Promise<boolean> {
  // Never prompt or auto-write in non-interactive CI environments
  if (options.isCi || !process.stdin.isTTY) {
    return false;
  }

  console.log('\n' + chalk.bold.cyan('  ✨ Migration Guardian — Verified Safe Auto-Fix'));
  console.log(chalk.dim(`  Target File: ${filePath}\n`));

  console.log(chalk.bold('  Applied Safe Transformations:'));
  for (const fix of fixResult.appliedFixes) {
    console.log(`  ${chalk.green('✓')} ${chalk.cyan(fix.ruleId)}: ${chalk.white(fix.description)}`);
  }
  console.log('');

  console.log(chalk.bold('  Proposed Diff:'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────'));
  console.log(formatColoredDiff(fixResult.diff));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────\n'));

  let shouldApply = options.autoAccept ?? false;

  if (!shouldApply) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(
        chalk.bold.yellow(`  ? Overwrite ${filePath} with this verified safe fix? `) + chalk.dim('[y/N] ')
      );
      const trimmed = answer.trim().toLowerCase();

      // STRICT: Must be explicitly 'y' or 'yes'. Empty input or anything else is strictly FALSE (N).
      shouldApply = trimmed === 'y' || trimmed === 'yes';
    } finally {
      rl.close();
    }
  }

  if (!shouldApply) {
    console.log(chalk.dim(`\n  ℹ️  Fix declined. File ${filePath} left untouched.\n`));
    return false;
  }

  try {
    writeFileSync(filePath, fixResult.fixedSql, 'utf-8');
    console.log(chalk.bold.green(`\n  ✅ Successfully updated ${filePath} with verified safe migration.\n`));
    return true;
  } catch (err) {
    console.error(chalk.red(`\n  ❌ Failed to write file ${filePath}: ${(err as Error).message}\n`));
    return false;
  }
}
