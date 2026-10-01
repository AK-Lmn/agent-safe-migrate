import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import type { RiskLevel } from './risk-classifier.js';

const LOG_DIR = join(os.homedir(), '.mgcheck');
const LOG_FILE = join(LOG_DIR, 'activity.log');
const AUDIT_FILE = join(LOG_DIR, 'audit.jsonl');
const PENDING_DIR = join(LOG_DIR, 'pending');
const DECISIONS_DIR = join(LOG_DIR, 'decisions');

// ── Audit Entry ────────────────────────────────────────────────────

export interface AuditEntry {
  /** Unique ID for this audit entry */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Which MCP tool triggered this */
  tool: string;
  /** Risk classification */
  risk: RiskLevel;
  /** What happened */
  decision: 'blocked' | 'user_approved' | 'user_rejected' | 'auto_allowed' | 'pending';
  /** The full SQL query attempted */
  query: string;
  /** Violations found */
  violations: {
    ruleId: string;
    severity: 'error' | 'warning';
    message: string;
    line?: number;
  }[];
  /** Count of errors */
  errorCount: number;
  /** Count of warnings */
  warningCount: number;
}

// ── Legacy Activity Entry (kept for backward compat) ─────────────

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

// ── Directory Setup ─────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [LOG_DIR, PENDING_DIR, DECISIONS_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// ── Audit Log Functions ────────────────────────────────────────────

/**
 * Append an audit entry to ~/.mgcheck/audit.jsonl
 */
export function writeAuditEntry(entry: AuditEntry): void {
  ensureDirs();
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(AUDIT_FILE, line, 'utf-8');
}

/**
 * Read all audit entries from the log file.
 */
export function readAuditLog(): AuditEntry[] {
  if (!existsSync(AUDIT_FILE)) return [];
  const content = readFileSync(AUDIT_FILE, 'utf-8');
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l) as AuditEntry; }
      catch { return null; }
    })
    .filter((e): e is AuditEntry => e !== null);
}

// ── Pending Approval IPC ───────────────────────────────────────────

/**
 * Write a pending approval request that the watch terminal will pick up.
 */
export function writePendingApproval(entry: AuditEntry): void {
  ensureDirs();
  const filePath = join(PENDING_DIR, `${entry.id}.json`);
  writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
}

/**
 * Read all pending approval requests.
 */
export function readPendingApprovals(): AuditEntry[] {
  ensureDirs();
  const files = readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json'));
  return files.map((f) => {
    try {
      return JSON.parse(readFileSync(join(PENDING_DIR, f), 'utf-8')) as AuditEntry;
    } catch {
      return null;
    }
  }).filter((e): e is AuditEntry => e !== null);
}

/**
 * Remove a pending approval request after it's been handled.
 */
export function removePendingApproval(id: string): void {
  const filePath = join(PENDING_DIR, `${id}.json`);
  try { unlinkSync(filePath); } catch { /* already removed */ }
}

/**
 * Write a decision for a pending approval request.
 */
export function writeDecision(id: string, approved: boolean): void {
  ensureDirs();
  const filePath = join(DECISIONS_DIR, `${id}.json`);
  writeFileSync(filePath, JSON.stringify({ id, approved, timestamp: new Date().toISOString() }), 'utf-8');
}

/**
 * Check if a decision exists for a pending approval.
 * Returns true (approved), false (rejected), or null (no decision yet).
 */
export function readDecision(id: string): boolean | null {
  const filePath = join(DECISIONS_DIR, `${id}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    return data.approved;
  } catch {
    return null;
  }
}

/**
 * Remove a decision file after it's been consumed.
 */
export function removeDecision(id: string): void {
  const filePath = join(DECISIONS_DIR, `${id}.json`);
  try { unlinkSync(filePath); } catch { /* already removed */ }
}

/**
 * Wait for a decision from the watch terminal.
 * Polls the decisions directory until a file appears or timeout is reached.
 * Returns true (approved), false (rejected), or null (timed out).
 */
export async function waitForDecision(id: string, timeoutMs: number = 120_000): Promise<boolean | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const decision = readDecision(id);
    if (decision !== null) {
      removeDecision(id);
      return decision;
    }
    // Poll every 500ms
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // Timed out — treat as rejected
  return null;
}

// ── Legacy Activity Log (backward compat) ─────────────────────────

/**
 * Clear the activity log file, ensuring directory exists.
 */
export function clearActivityLog(): void {
  ensureDirs();
  writeFileSync(LOG_FILE, '', 'utf-8');
}

/**
 * Append an activity entry to the shared log file.
 * Called by the MCP server when a tool is invoked.
 */
export function logActivity(entry: ActivityEntry): void {
  ensureDirs();
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(LOG_FILE, line, 'utf-8');
}

/**
 * Watch the activity log and call the handler for each new entry.
 * Returns a cleanup function to stop watching.
 */
export function watchActivityLog(handler: (entry: ActivityEntry) => void): () => void {
  ensureDirs();

  // Create log file if it doesn't exist
  if (!existsSync(LOG_FILE)) {
    appendFileSync(LOG_FILE, '', 'utf-8');
  }

  // Track current file size to only read new content
  const { statSync } = require('node:fs') as typeof import('node:fs');
  let lastSize = 0;
  try {
    lastSize = statSync(LOG_FILE).size;
  } catch { /* fresh start */ }

  const interval = setInterval(() => {
    try {
      const currentSize = statSync(LOG_FILE).size;
      if (currentSize > lastSize) {
        const fd = readFileSync(LOG_FILE, 'utf-8');
        const newContent = fd.substring(lastSize);
        lastSize = currentSize;

        const lines = newContent.split('\n').filter((l: string) => l.trim());
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
 * Watch the pending approvals directory for new requests.
 * Returns a cleanup function to stop watching.
 */
export function watchPendingApprovals(handler: (entry: AuditEntry) => void): () => void {
  ensureDirs();
  const seen = new Set<string>();

  const interval = setInterval(() => {
    try {
      const pending = readPendingApprovals();
      for (const entry of pending) {
        if (!seen.has(entry.id)) {
          seen.add(entry.id);
          handler(entry);
        }
      }
    } catch {
      // Directory may be temporarily unavailable
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

/**
 * Format an audit entry for terminal display with risk coloring.
 */
export function formatAuditEntry(entry: AuditEntry): string {
  const time = chalk.dim(`[${new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })}]`);

  const riskColors: Record<RiskLevel, (s: string) => string> = {
    high: chalk.red,
    medium: chalk.yellow,
    low: chalk.green,
  };
  const riskEmoji: Record<RiskLevel, string> = {
    high: '🔴',
    medium: '🟡',
    low: '🟢',
  };

  const riskColor = riskColors[entry.risk];
  const emoji = riskEmoji[entry.risk];
  const riskLabel = riskColor(`${entry.risk.toUpperCase()} RISK`);

  const decisionLabels: Record<string, string> = {
    blocked: chalk.red('AUTO-BLOCKED'),
    user_approved: chalk.green('APPROVED'),
    user_rejected: chalk.red('REJECTED'),
    auto_allowed: chalk.green('ALLOWED'),
    pending: chalk.yellow('PENDING'),
  };
  const decisionLabel = decisionLabels[entry.decision] || entry.decision;

  const lines: string[] = [];
  lines.push(`  ${time} ${emoji} ${riskLabel} — ${decisionLabel}`);

  // Show the SQL query
  const queryLines = entry.query.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const ql of queryLines.slice(0, 3)) {
    const truncated = ql.length > 75 ? ql.substring(0, 72) + '...' : ql;
    lines.push(chalk.dim('  │ ') + chalk.white(truncated));
  }
  if (queryLines.length > 3) {
    lines.push(chalk.dim(`  │ ... and ${queryLines.length - 3} more lines`));
  }

  // Show violations
  for (const v of entry.violations) {
    const sevIcon = v.severity === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
    lines.push(chalk.dim('  │ ') + sevIcon + ' ' + chalk.dim(`${v.ruleId}: `) + v.message);
  }

  lines.push(chalk.dim(`  └─ Decision: ${entry.decision}`));

  return lines.join('\n');
}

/**
 * Generate a short unique ID for audit entries.
 */
export function generateAuditId(): string {
  return `mg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

export { LOG_FILE, AUDIT_FILE, LOG_DIR, PENDING_DIR, DECISIONS_DIR };
