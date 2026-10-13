import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runMcpTools, resetAllRetrySessions } from '../../src/mcp/tools.js';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getApprovalMode,
  setApprovalMode,
  validateAutoApproveLevels,
} from '../../src/core/approval-mode.js';
import {
  getGlobalLogDir,
  startWatcherHeartbeat,
  readPendingApprovals,
  writeDecision,
  readAuditLog,
} from '../../src/core/activity-log.js';

describe('Approval Modes & Dynamic Permission Gate', () => {
  let projectDir: string;
  let originalEnvMode: string | undefined;
  let originalEnvLevels: string | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mgcheck-mode-test-'));
    writeFileSync(join(projectDir, 'package.json'), '{}', 'utf-8');
    resetAllRetrySessions();

    originalEnvMode = process.env.MGCHECK_MODE;
    originalEnvLevels = process.env.MGCHECK_AUTO_APPROVE;
    delete process.env.MGCHECK_MODE;
    delete process.env.MGCHECK_AUTO_APPROVE;

    // Clean any global settings in sandboxed home
    const settingsPath = join(getGlobalLogDir(), 'settings.json');
    if (existsSync(settingsPath)) {
      try {
        rmSync(settingsPath, { force: true });
      } catch {}
    }
  });

  afterEach(() => {
    resetAllRetrySessions();
    if (originalEnvMode !== undefined) process.env.MGCHECK_MODE = originalEnvMode;
    else delete process.env.MGCHECK_MODE;

    if (originalEnvLevels !== undefined) process.env.MGCHECK_AUTO_APPROVE = originalEnvLevels;
    else delete process.env.MGCHECK_AUTO_APPROVE;

    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {}
  });

  async function getTool(name: string) {
    const server = new McpServer({ name: 'test-mode', version: '1.0.0' });
    runMcpTools(server);
    return (server as any)._registeredTools[name];
  }

  // ── Mode Resolution & Priority Tests ──────────────────────────────

  it('resolves default mode to manual when no config or env is set', () => {
    const config = getApprovalMode(projectDir);
    expect(config.mode).toBe('manual');
    expect(config.source).toBe('default');
    expect(config.autoApprove).toEqual(['low']);
  });

  it('reads global settings from ~/.mgcheck/settings.json', () => {
    setApprovalMode({ mode: 'auto', autoApprove: ['low', 'medium'] });
    const config = getApprovalMode(projectDir);
    expect(config.mode).toBe('auto');
    expect(config.source).toBe('global');
    expect(config.autoApprove).toEqual(['low', 'medium']);
  });

  it('project config overrides global settings', () => {
    setApprovalMode({ mode: 'auto', autoApprove: ['low', 'medium'] });
    // Write project config
    setApprovalMode({ mode: 'manual', autoApprove: ['low'], project: true, projectDir });

    const config = getApprovalMode(projectDir);
    expect(config.mode).toBe('manual');
    expect(config.source).toBe('project');
    expect(config.autoApprove).toEqual(['low']);
  });

  it('environment variable MGCHECK_MODE overrides both project and global config', () => {
    setApprovalMode({ mode: 'manual', project: true, projectDir });
    process.env.MGCHECK_MODE = 'auto';

    const config = getApprovalMode(projectDir);
    expect(config.mode).toBe('auto');
    expect(config.source).toBe('env');
    expect(config.autoApprove).toEqual(['low', 'medium']);
  });

  it('falls back to manual and logs warning to stderr on invalid mode', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.env.MGCHECK_MODE = 'invalid-mode';

    const config = getApprovalMode(projectDir);
    expect(config.mode).toBe('manual');
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('strictly rejects "high" in autoApprove list', () => {
    expect(() => validateAutoApproveLevels(['low', 'high'])).toThrow(
      'Risk level "high" can never be auto-approved.'
    );
    expect(() =>
      setApprovalMode({ mode: 'auto', autoApprove: ['low', 'high' as any] })
    ).toThrow('Risk level "high" can never be auto-approved.');
  });

  // ── Auto Mode MCP Tool Execution Tests ────────────────────────────

  it('auto-approves low risk queries immediately in auto mode with no watcher running', async () => {
    setApprovalMode({ mode: 'auto' });
    const tool = await getTool('analyze_migration');

    // Safe query: CREATE TABLE with lock_timeout
    const safeSql = "SET lock_timeout = '5s';\nCREATE TABLE test_users (id serial PRIMARY KEY, name text);";
    const res = await tool.handler({
      migration_sql: safeSql,
      project_dir: projectDir,
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.guardian.decision).toBe('auto_allowed');
    expect(parsed.guardian.risk).toBe('low');
    expect(parsed.guardian.message).toContain('Auto-approved');

    // Verify NO pending approval file was written
    const pending = readPendingApprovals(getGlobalLogDir());
    expect(pending.length).toBe(0);

    // Verify audit log has auto_allowed
    const auditFile = join(projectDir, '.mgcheck', 'audit.jsonl');
    const entries = readAuditLog({ path: auditFile });
    expect(entries.length).toBe(1);
    expect(entries[0].decision).toBe('auto_allowed');
  });

  it('auto-approves unfixable medium risk queries in auto mode when medium is allowed', async () => {
    setApprovalMode({ mode: 'auto', autoApprove: ['low', 'medium'] });
    const tool = await getTool('analyze_migration');

    // RENAME COLUMN is a warning (medium risk) with no automated AST rewrite
    const mediumSql = "SET lock_timeout = '5s';\nALTER TABLE users RENAME COLUMN legacy_col TO new_col;";
    const res = await tool.handler({
      migration_sql: mediumSql,
      project_dir: projectDir,
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.guardian.decision).toBe('auto_allowed');
    expect(parsed.guardian.risk).toBe('medium');
  });

  it('prompts user in watcher if medium is NOT in autoApprove list', async () => {
    setApprovalMode({ mode: 'auto', autoApprove: ['low'] });
    const tool = await getTool('analyze_migration');

    const mediumSql = "SET lock_timeout = '5s';\nALTER TABLE users RENAME COLUMN legacy_col TO new_col;";
    // Without watcher active, non-auto-approved queries pause/await watcher
    const res = await tool.handler({
      migration_sql: mediumSql,
      project_dir: projectDir,
    });

    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.guardian.decision).toBe('awaiting_watcher');
    expect(parsed.guardian.message).toContain('Migration Guardian terminal');
  });

  it('auto mode guides agent through retry loop to fix fixable medium warnings first', async () => {
    setApprovalMode({ mode: 'auto', autoApprove: ['low', 'medium'] });
    const tool = await getTool('analyze_migration');

    // Missing lock_timeout with ALTER TABLE is a fixable warning (MG009)
    const fixableMediumSql = "ALTER TABLE users ADD COLUMN age int;";
    const res = await tool.handler({
      migration_sql: fixableMediumSql,
      project_dir: projectDir,
    });

    // Attempt 1: Guardian intercepts and provides safe fix with lock_timeout
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.guardian.decision).toBe('auto_retry');
    expect(parsed.guardian.auto_fix.available).toBe(true);
    expect(parsed.guardian.auto_fix.suggested_safe_sql).toContain("SET lock_timeout = '5s';");
  });

  it('auto mode keeps HIGH risk blocked unless overridden with watcher terminal', async () => {
    setApprovalMode({ mode: 'auto' });
    const tool = await getTool('analyze_migration');

    // Unconfirmed destructive DROP TABLE (high risk)
    const highSql = "DROP TABLE users;";
    const res = await tool.handler({
      migration_sql: highSql,
      project_dir: projectDir,
      confirm_destructive: false,
    });

    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.guardian.decision).toBe('blocked');
    expect(parsed.guardian.risk).toBe('high');
  });

  it('apply_migration respects auto mode and confirm_user_approved guard', async () => {
    setApprovalMode({ mode: 'auto' });
    const tool = await getTool('apply_migration');

    // Missing confirm_user_approved still rejected
    const unconfirmedRes = await tool.handler({
      migration_sql: "SET lock_timeout = '5s';\nCREATE TABLE test_tab (id int);",
      confirm_user_approved: false,
      project_dir: projectDir,
    });
    expect(unconfirmedRes.isError).toBe(true);
    expect(JSON.parse(unconfirmedRes.content[0].text).error).toContain('User confirmation required');
  });
});
