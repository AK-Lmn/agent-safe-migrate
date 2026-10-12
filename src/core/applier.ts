import pg from 'pg';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

/**
 * Automatically discovers a PostgreSQL database URL from environment variables
 * or common .env file locations within a project directory (e.g. .env, Backend/.env, backend/.env).
 */
export function findDatabaseUrl(projectDir?: string): string | null {
  if (process.env.TARGET_DATABASE_URL) return process.env.TARGET_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  if (projectDir) {
    const candidates = [
      join(projectDir, '.env'),
      join(projectDir, 'Backend', '.env'),
      join(projectDir, 'backend', '.env'),
      join(projectDir, 'server', '.env'),
      join(projectDir, 'api', '.env'),
      join(projectDir, '.env.local'),
      join(projectDir, '.env.development'),
    ];
    for (const cand of candidates) {
      if (existsSync(cand)) {
        try {
          const content = readFileSync(cand, 'utf-8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
            const [k, ...v] = trimmed.split('=');
            const key = k.trim();
            if (key === 'DATABASE_URL' || key === 'TARGET_DATABASE_URL' || key === 'POSTGRES_URL') {
              let val = v.join('=').trim();
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
              }
              if (val) return val;
            }
          }
        } catch {}
      }
    }
  }
  return null;
}

export interface ApplyResult {
  success: boolean;
  error?: string;
  executionTimeMs: number;
}

/**
 * Executes verified SQL migration directly against a target real PostgreSQL database.
 */
export async function applyToRealDatabase(sql: string, dbUrl: string): Promise<ApplyResult> {
  const client = new pg.Client({ connectionString: dbUrl });
  const start = Date.now();

  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    const executionTimeMs = Date.now() - start;
    return { success: true, executionTimeMs };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors
    }
    const executionTimeMs = Date.now() - start;
    return {
      success: false,
      error: (err as Error).message,
      executionTimeMs,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Interactive prompt: displays the verified SQL and asks the user
 * whether they want to apply it to their real database.
 */
export async function promptAndApplyIfConfirmed(
  sql: string,
  options: {
    targetDbUrl?: string;
    autoApply?: boolean;
    isCi?: boolean;
  } = {}
): Promise<boolean> {
  // Never prompt in non-interactive CI environments
  if (options.isCi || !process.stdin.isTTY) {
    return false;
  }

  console.log('\n' + chalk.bold.cyan('  📜 Verified Safe SQL Query:'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────'));
  const lines = sql.trim().split('\n');
  for (const line of lines) {
    console.log(`  ${chalk.cyan('│')} ${chalk.white(line)}`);
  }
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────\n'));

  let shouldApply = options.autoApply ?? false;

  if (!shouldApply) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(
        chalk.bold.yellow('  🚀 Apply this migration to your real database now? ') + chalk.dim('[y/N] ')
      );
      const trimmed = answer.trim().toLowerCase();
      shouldApply = trimmed === 'y' || trimmed === 'yes';
    } finally {
      rl.close();
    }
  }

  if (!shouldApply) {
    console.log(chalk.dim('\n  ℹ️  Real database untouched. Continuing IDE agent workflow...\n'));
    return false;
  }

  // Determine target database URL
  let targetUrl =
    options.targetDbUrl ||
    process.env.TARGET_DATABASE_URL ||
    process.env.DATABASE_URL;

  if (!targetUrl) {
    const rl = readline.createInterface({ input, output });
    try {
      const enteredUrl = await rl.question(
        chalk.bold.cyan('  🔗 Enter target database URL ') + chalk.dim('(e.g., postgresql://user:pass@localhost:5432/mydb): ')
      );
      targetUrl = enteredUrl.trim();
    } finally {
      rl.close();
    }
  }

  if (!targetUrl) {
    console.log(chalk.yellow('\n  ⚠️  No target database URL provided. Skipped real DB application.\n'));
    return false;
  }

  console.log(chalk.dim(`\n  Connecting to target database and applying migration...`));
  const res = await applyToRealDatabase(sql, targetUrl);

  if (res.success) {
    console.log(chalk.bold.green(`\n  ✅ Successfully applied migration to target database!`) + chalk.dim(` (${res.executionTimeMs}ms)\n`));
    return true;
  } else {
    console.log(chalk.bold.red(`\n  ❌ Failed to apply migration to target database:`));
    console.log(chalk.red(`     ${res.error}\n`));
    return false;
  }
}

/**
 * Prompts the user interactively when destructive operations (DROP TABLE/COLUMN)
 * are detected to ask if they approve running this destructive code.
 */
export async function promptDestructiveConfirmation(
  violations: Array<{ ruleId: string; ruleName: string; sql: string; line?: number }>,
  isCi?: boolean
): Promise<boolean> {
  if (isCi || !process.stdin.isTTY) {
    return false;
  }

  console.log('\n' + chalk.bold.red('  🚨 DESTRUCTIVE DATABASE OPERATION DETECTED!'));
  console.log(chalk.red('  ─────────────────────────────────────────────────────────'));
  console.log(chalk.white('  The following operations permanently delete data and are IRREVERSIBLE:'));
  for (const v of violations) {
    const lineInfo = v.line ? `Line ${v.line}: ` : '';
    console.log(`  ${chalk.red('•')} ${chalk.yellow(v.ruleId)} (${v.ruleName}) - ${chalk.dim(lineInfo)}${chalk.white(v.sql.replace(/\s+/g, ' ').trim())}`);
  }
  console.log(chalk.red('  ─────────────────────────────────────────────────────────\n'));

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      chalk.bold.yellow('  ⚠️  Do you allow this destructive migration to proceed? ') + chalk.dim('[y/N] ')
    );
    const trimmed = answer.trim().toLowerCase();
    const approved = trimmed === 'y' || trimmed === 'yes';
    if (approved) {
      console.log(chalk.green('\n  ✅ Destructive operation explicitly approved by user.\n'));
    } else {
      console.log(chalk.red('\n  ❌ Destructive operation rejected. Migration blocked.\n'));
    }
    return approved;
  } finally {
    rl.close();
  }
}

