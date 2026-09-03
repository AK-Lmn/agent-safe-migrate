import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, statSync, watchFile, unwatchFile } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import chalk from 'chalk';

const LOG_DIR = join(os.homedir(), '.mgcheck');
const LOG_FILE = join(LOG_DIR, 'activity.log');

export interface ActivityEntry {
  timestamp: string;
  tool: string;
  summary: string;
  violations: number;
  errors: number;
  warnings: number;
  passed: boolean;
  statements: string[];
}

/**
 * Clear the activity log file, ensuring directory exists.
 */
export function clearActivityLog(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  writeFileSync(LOG_FILE, '', 'utf-8');
}

/**
 * Append an activity entry to the shared log file.
 * Called by the MCP server when a tool is invoked.
 */
export function logActivity(entry: ActivityEntry): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(LOG_FILE, line, 'utf-8');
}

/**
 * Watch the activity log and call the handler for each new entry.
 * Returns a cleanup function to stop watching.
 */
export function watchActivityLog(handler: (entry: ActivityEntry) => void): () => void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }

  // Create log file if it doesn't exist
  if (!existsSync(LOG_FILE)) {
    appendFileSync(LOG_FILE, '', 'utf-8');
  }

  // Track current file size to only read new content
  let lastSize = statSync(LOG_FILE).size;

  const interval = setInterval(() => {
    try {
      const currentSize = statSync(LOG_FILE).size;
      if (currentSize > lastSize) {
        // Read only the new bytes
        const fd = readFileSync(LOG_FILE, 'utf-8');
        const newContent = fd.substring(lastSize);
        lastSize = currentSize;

        const lines = newContent.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const entry: ActivityEntry = JSON.parse(line);
            handler(entry);
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch {
      // File may be temporarily unavailable
    }
  }, 500);

  return () => {
    clearInterval(interval);
  };
}

/**
 * Format an activity entry for terminal display.
 */
export function formatActivityEntry(entry: ActivityEntry): string {
  const time = chalk.dim(`[${entry.timestamp}]`);
  const tool = chalk.cyan(entry.tool);

  const lines: string[] = [];
  lines.push(`${time} ${tool} called`);

  // Show each statement
  if (entry.statements.length > 0) {
    for (const stmt of entry.statements) {
      const truncated = stmt.length > 80 ? stmt.substring(0, 77) + '...' : stmt;
      lines.push(chalk.dim('  │ ') + chalk.white(truncated));
    }
  }

  // Show result
  if (entry.passed) {
    lines.push(chalk.dim('  └─ ') + chalk.green('✅ PASSED') + chalk.dim(` (${entry.violations} violations)`));
  } else {
    lines.push(
      chalk.dim('  └─ ') +
        chalk.red('❌ BLOCKED') +
        chalk.dim(` (${entry.errors} error${entry.errors !== 1 ? 's' : ''}, ${entry.warnings} warning${entry.warnings !== 1 ? 's' : ''})`)
    );
  }

  return lines.join('\n');
}

export { LOG_FILE };
