import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runMcpTools, resetAllRetrySessions } from '../../src/mcp/tools.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Autonomous Agent Retry Loop & Comparison', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mgcheck-retry-test-'));
    writeFileSync(join(projectDir, 'package.json'), '{}', 'utf-8');
    resetAllRetrySessions();
  });

  afterEach(() => {
    resetAllRetrySessions();
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {}
  });

  async function getTool(name: string) {
    const server = new McpServer({ name: 'test-retry', version: '1.0.0' });
    runMcpTools(server);
    return (server as any)._registeredTools[name];
  }

  it('rejects unsafe migration with auto_retry and guidance on attempt 1 without prompting human', async () => {
    const tool = await getTool('apply_migration');
    const response = await tool.handler({
      migration_sql: 'CREATE INDEX idx_users_role ON users (role);',
      confirm_user_approved: true,
      project_dir: projectDir,
    });

    expect(response.isError).toBe(true);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.guardian.decision).toBe('auto_retry');
    expect(parsed.guardian.attempt).toBe(1);
    expect(parsed.guardian.max_attempts).toBe(4);
    expect(parsed.auto_fix.available).toBe(true);
    expect(parsed.auto_fix.suggested_safe_sql).toContain('CONCURRENTLY');
  });

  it('preserves originalDraft and sets attempt count when agent retries with safe SQL', async () => {
    const tool = await getTool('apply_migration');

    // Attempt 1: Unsafe
    const res1 = await tool.handler({
      migration_sql: 'CREATE INDEX idx_users_role ON users (role);',
      confirm_user_approved: true,
      project_dir: projectDir,
    });
    expect(res1.isError).toBe(true);

    // Attempt 2: Safe rewrite (with lock_timeout and CONCURRENTLY)
    const safeSql = "SET lock_timeout = '5s';\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role ON users (role);";
    
    // In test environment without watcher, low risk returns without blocking
    const res2 = await tool.handler({
      migration_sql: safeSql,
      confirm_user_approved: true,
      project_dir: projectDir,
    });

    // Check audit log has the comparison data recorded
    const { readAuditLog } = await import('../../src/core/activity-log.js');
    const entries = readAuditLog({ path: join(projectDir, '.mgcheck', 'audit.jsonl') });

    // Entry 1 is auto_retry
    expect(entries[0].decision).toBe('auto_retry');
    expect(entries[0].attempt).toBe(1);

    // Entry 2 is the verified query with originalDraft attached
    expect(entries[1].attempt).toBe(2);
    expect(entries[1].originalDraft).toBeDefined();
    expect(entries[1].originalDraft?.query).toBe('CREATE INDEX idx_users_role ON users (role);');
    expect(entries[1].originalDraft?.violations.some((v: any) => v.ruleId === 'MG001')).toBe(true);
  });

  it('exhausts auto-retry after 4 attempts and escalates to human block', async () => {
    const tool = await getTool('apply_migration');
    const unsafeSql = 'CREATE INDEX idx_users_role ON users (role);';

    // Attempts 1, 2, 3: auto_retry
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await tool.handler({
        migration_sql: unsafeSql,
        confirm_user_approved: true,
        project_dir: projectDir,
      });
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.guardian.decision).toBe('auto_retry');
      expect(parsed.guardian.attempt).toBe(attempt);
    }

    // Attempt 4: Should exhaust retry loop and not return auto_retry
    const res4 = await tool.handler({
      migration_sql: unsafeSql,
      confirm_user_approved: true,
      project_dir: projectDir,
    });
    const parsed4 = JSON.parse(res4.content[0].text);
    // At attempt 4, it falls through to blocking approval / no-watcher block
    expect(parsed4.guardian?.decision).not.toBe('auto_retry');
  });

  it('does not auto-retry destructive DROP TABLE migrations without explicit confirmation', async () => {
    const tool = await getTool('apply_migration');
    const dropSql = 'DROP TABLE customers;';

    const res = await tool.handler({
      migration_sql: dropSql,
      confirm_user_approved: true,
      confirm_destructive: false,
      project_dir: projectDir,
    });

    const parsed = JSON.parse(res.content[0].text);
    // Destructive operations must never be silently auto-retried
    expect(parsed.guardian?.decision).not.toBe('auto_retry');
  });
});
