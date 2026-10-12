import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, parse } from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import type { RiskLevel } from './risk-classifier.js';

// ── Project Root & Storage Directory Resolution ───────────────────

/**
 * Custom override for the storage directory.
 * Set via setLogDir() or MGCHECK_STORAGE_DIR environment variable.
 */
let customLogDir: string | null = null;

export function setLogDir(dir: string | null): void {
  customLogDir = dir;
}

/**
 * Searches upward from startDir for a project root indicator:
 * 1. .mgcheck/ directory (already initialized)
 * 2. mgcheck.config.json, .mgcheckrc.json, .mgcheckrc.yml, .mgcheckrc
 * 3. package.json or .git directory
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  try {
    let current = resolve(startDir);
    const { root } = parse(current);

    while (true) {
      // 1. Existing .mgcheck directory
      if (existsSync(join(current, '.mgcheck'))) {
        return current;
      }
      // 2. Config files
      if (
        existsSync(join(current, 'mgcheck.config.json')) ||
        existsSync(join(current, '.mgcheckrc.json')) ||
        existsSync(join(current, '.mgcheckrc.yml')) ||
        existsSync(join(current, '.mgcheckrc'))
      ) {
        return current;
      }
      // 3. package.json or .git
      if (existsSync(join(current, 'package.json')) || existsSync(join(current, '.git'))) {
        return current;
      }

      if (current === root) {
        break;
      }
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  } catch {
    // If permission or path error, return null
  }
  return null;
}

/**
 * Resolves the active storage directory for logs, audit files, and IPC queues.
 * Priority:
 * 1. Explicit in-memory override via setLogDir(...)
 * 2. MGCHECK_STORAGE_DIR env variable
 * 3. Nearest project root containing package.json, .git, or .mgcheck
 * 4. Fallback to ~/.mgcheck
 */
export function getLogDir(startDir?: string): string {
  if (customLogDir) {
    return customLogDir;
  }
  if (process.env.MGCHECK_STORAGE_DIR) {
    return resolve(process.env.MGCHECK_STORAGE_DIR);
  }

  const projectRoot = findProjectRoot(startDir || process.cwd());
  if (projectRoot) {
    return join(projectRoot, '.mgcheck');
  }

  return join(os.homedir(), '.mgcheck');
}

/**
 * Returns the global user directory (~/.mgcheck).
 */
export function getGlobalLogDir(): string {
  return join(os.homedir(), '.mgcheck');
}

export function getAuditFile(startDir?: string): string {
  return join(getLogDir(startDir), 'audit.jsonl');
}

export function getGlobalAuditFile(): string {
  return join(getGlobalLogDir(), 'audit.jsonl');
}

export function getLogFile(startDir?: string): string {
  return join(getLogDir(startDir), 'activity.log');
}

export function getPendingDir(startDir?: string): string {
  return join(getLogDir(startDir), 'pending');
}

export function getDecisionsDir(startDir?: string): string {
  return join(getLogDir(startDir), 'decisions');
}

// Kept for backward compatibility
export const LOG_DIR = getLogDir();
export const LOG_FILE = getLogFile();
export const AUDIT_FILE = getAuditFile();
export const PENDING_DIR = getPendingDir();
export const DECISIONS_DIR = getDecisionsDir();

// ── Audit Entry ────────────────────────────────────────────────────

export interface AuditEntry {
  /** Unique ID for this audit entry */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Which MCP tool triggered this */
  tool: string;
  /** Project directory the query came from (where its audit log is written) */
  project?: string;
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

function ensureDirs(targetDir: string = getLogDir()): void {
  const pDir = join(targetDir, 'pending');
  const dDir = join(targetDir, 'decisions');
  for (const dir of [targetDir, pDir, dDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// ── Audit Log Functions ────────────────────────────────────────────

/**
 * Append an audit entry to the active audit log file (project .mgcheck/audit.jsonl).
 */
export function writeAuditEntry(entry: AuditEntry, targetDir?: string): void {
  const baseDir = targetDir || getLogDir();
  ensureDirs(baseDir);
  const auditFile = join(baseDir, 'audit.jsonl');
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(auditFile, line, 'utf-8');
}

/**
 * Read all audit entries from the log file.
 * Supports reading the active project log or global log (~/.mgcheck/audit.jsonl).
 */
export function readAuditLog(options?: { global?: boolean; path?: string }): AuditEntry[] {
  const file = options?.path || (options?.global ? getGlobalAuditFile() : getAuditFile());
  if (!existsSync(file)) return [];
  const content = readFileSync(file, 'utf-8');
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
export function writePendingApproval(entry: AuditEntry, targetDir?: string): void {
  const baseDir = targetDir || getLogDir();
  ensureDirs(baseDir);
  const filePath = join(baseDir, 'pending', `${entry.id}.json`);
  writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
}

/**
 * Read all pending approval requests.
 */
export function readPendingApprovals(targetDir?: string): AuditEntry[] {
  const baseDir = targetDir || getLogDir();
  const pendingDir = join(baseDir, 'pending');
  ensureDirs(baseDir);
  const files = readdirSync(pendingDir).filter((f) => f.endsWith('.json'));
  return files.map((f) => {
    try {
      return JSON.parse(readFileSync(join(pendingDir, f), 'utf-8')) as AuditEntry;
    } catch {
      return null;
    }
  }).filter((e): e is AuditEntry => e !== null);
}

/**
 * Remove a pending approval request after it's been handled.
 */
export function removePendingApproval(id: string, targetDir?: string): void {
  const baseDir = targetDir || getLogDir();
  const filePath = join(baseDir, 'pending', `${id}.json`);
  try { unlinkSync(filePath); } catch { /* already removed */ }
}

/**
 * Write a decision for a pending approval request.
 */
export function writeDecision(id: string, approved: boolean, targetDir?: string): void {
  const baseDir = targetDir || getLogDir();
  ensureDirs(baseDir);
  const filePath = join(baseDir, 'decisions', `${id}.json`);
  writeFileSync(filePath, JSON.stringify({ id, approved, timestamp: new Date().toISOString() }), 'utf-8');
}

/**
 * Check if a decision exists for a pending approval.
 * Returns true (approved), false (rejected), or null (no decision yet).
 */
export function readDecision(id: string, targetDir?: string): boolean | null {
  const baseDir = targetDir || getLogDir();
  const filePath = join(baseDir, 'decisions', `${id}.json`);
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
export function removeDecision(id: string, targetDir?: string): void {
  const baseDir = targetDir || getLogDir();
  const filePath = join(baseDir, 'decisions', `${id}.json`);
  try { unlinkSync(filePath); } catch { /* already removed */ }
}

/**
 * Wait for a decision from the watch terminal.
 * Polls the decisions directory until a file appears or timeout is reached.
 * Returns true (approved), false (rejected), or null (timed out).
 */
export async function waitForDecision(id: string, timeoutMs: number = 120_000, targetDir?: string): Promise<boolean | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const decision = readDecision(id, targetDir);
    if (decision !== null) {
      removeDecision(id, targetDir);
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
export function clearActivityLog(targetDir?: string): void {
  const baseDir = targetDir || getLogDir();
  ensureDirs(baseDir);
  const logFile = join(baseDir, 'activity.log');
  writeFileSync(logFile, '', 'utf-8');
}

/**
 * Append an activity entry to the shared log file.
 * Called by the MCP server when a tool is invoked.
 */
export function logActivity(entry: ActivityEntry, targetDir?: string): void {
  const baseDir = targetDir || getLogDir();
  ensureDirs(baseDir);
  const logFile = join(baseDir, 'activity.log');
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(logFile, line, 'utf-8');
}

/**
 * Watch the activity log and call the handler for each new entry.
 * Returns a cleanup function to stop watching.
 */
export function watchActivityLog(handler: (entry: ActivityEntry) => void, targetDir?: string): () => void {
  const baseDir = targetDir || getLogDir();
  ensureDirs(baseDir);
  return tailJsonLines<ActivityEntry>(join(baseDir, 'activity.log'), handler);
}

/**
 * Follow a JSON-lines file and call the handler for each line appended after
 * this call. Handles the file being truncated. Returns a stop function.
 */
function tailJsonLines<T>(file: string, handler: (entry: T) => void): () => void {
  if (!existsSync(file)) {
    appendFileSync(file, '', 'utf-8');
  }

  // Track current byte offset to only read new content
  let offset = 0;
  try {
    offset = statSync(file).size;
  } catch { /* fresh start */ }

  const interval = setInterval(() => {
    try {
      const size = statSync(file).size;
      if (size < offset) offset = 0; // file was truncated/rotated
      if (size === offset) return;

      const newContent = readFileSync(file).subarray(offset, size).toString('utf-8');
      offset = size;

      for (const line of newContent.split('\n')) {
        if (!line.trim()) continue;
        try {
          handler(JSON.parse(line) as T);
        } catch {
          // Skip malformed lines
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

// ── Live Event Feed ───────────────────────────────────────────────

const EVENTS_FILE = 'events.jsonl';
const EVENTS_MAX_BYTES = 1_000_000;

/**
 * Publish a finished check (auto-blocked MCP call, CLI or git-hook run) to the
 * global feed that the `mgcheck setup` watcher displays live. Never throws.
 */
export function publishEvent(entry: AuditEntry, targetDir: string = getGlobalLogDir()): void {
  try {
    ensureDirs(targetDir);
    const file = join(targetDir, EVENTS_FILE);
    // The feed is only for live display; keep it bounded
    if (existsSync(file) && statSync(file).size > EVENTS_MAX_BYTES) {
      writeFileSync(file, '', 'utf-8');
    }
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Display feed must never break a check
  }
}

/**
 * Watch the global event feed for checks published after this call.
 */
export function watchEvents(handler: (entry: AuditEntry) => void, targetDir: string = getGlobalLogDir()): () => void {
  ensureDirs(targetDir);
  return tailJsonLines<AuditEntry>(join(targetDir, EVENTS_FILE), handler);
}

/**
 * Watch the pending approvals directory for new requests.
 * Returns a cleanup function to stop watching.
 */
export function watchPendingApprovals(handler: (entry: AuditEntry) => void, targetDir?: string): () => void {
  const baseDir = targetDir || getLogDir();
  ensureDirs(baseDir);
  const seen = new Set<string>();

  const interval = setInterval(() => {
    try {
      const pending = readPendingApprovals(baseDir);
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
