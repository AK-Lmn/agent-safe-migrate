import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findProjectRoot,
  getLogDir,
  setLogDir,
  getAuditFile,
  writeAuditEntry,
  readAuditLog,
  type AuditEntry,
} from '../../src/core/activity-log.js';
import { ensureGitIgnore, setupMcp } from '../../src/installer/index.js';

describe('Per-Project Audit Log & Storage Resolution', () => {
  let tmpProjectDir: string;

  beforeEach(() => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), 'mgcheck-project-test-'));
    setLogDir(null);
    delete process.env.MGCHECK_STORAGE_DIR;
  });

  afterEach(() => {
    setLogDir(null);
    delete process.env.MGCHECK_STORAGE_DIR;
    try {
      rmSync(tmpProjectDir, { recursive: true, force: true });
    } catch {}
  });

  describe('findProjectRoot', () => {
    it('should identify root containing package.json', () => {
      writeFileSync(join(tmpProjectDir, 'package.json'), '{}', 'utf-8');
      const found = findProjectRoot(tmpProjectDir);
      expect(found).toBe(tmpProjectDir);
    });

    it('should identify root containing .git directory', () => {
      mkdirSync(join(tmpProjectDir, '.git'), { recursive: true });
      const found = findProjectRoot(tmpProjectDir);
      expect(found).toBe(tmpProjectDir);
    });

    it('should identify root containing .mgcheck directory', () => {
      mkdirSync(join(tmpProjectDir, '.mgcheck'), { recursive: true });
      const found = findProjectRoot(tmpProjectDir);
      expect(found).toBe(tmpProjectDir);
    });

    it('should find root from deep subdirectories', () => {
      writeFileSync(join(tmpProjectDir, 'package.json'), '{}', 'utf-8');
      const subDir = join(tmpProjectDir, 'src', 'db', 'migrations');
      mkdirSync(subDir, { recursive: true });

      const found = findProjectRoot(subDir);
      expect(found).toBe(tmpProjectDir);
    });
  });

  describe('getLogDir and getAuditFile', () => {
    it('should prioritize explicit setLogDir override', () => {
      const customPath = join(tmpProjectDir, 'custom-log');
      setLogDir(customPath);
      expect(getLogDir()).toBe(customPath);
      expect(getAuditFile()).toBe(join(customPath, 'audit.jsonl'));
    });

    it('should prioritize MGCHECK_STORAGE_DIR env variable', () => {
      const envPath = join(tmpProjectDir, 'env-storage');
      process.env.MGCHECK_STORAGE_DIR = envPath;
      expect(getLogDir()).toBe(envPath);
      expect(getAuditFile()).toBe(join(envPath, 'audit.jsonl'));
    });

    it('should resolve to projectRoot/.mgcheck when in a project folder', () => {
      writeFileSync(join(tmpProjectDir, 'package.json'), '{}', 'utf-8');
      const expected = join(tmpProjectDir, '.mgcheck');
      expect(getLogDir(tmpProjectDir)).toBe(expected);
      expect(getAuditFile(tmpProjectDir)).toBe(join(expected, 'audit.jsonl'));
    });
  });

  describe('writeAuditEntry and readAuditLog in project folder', () => {
    it('should write and read audit entries from project-local .mgcheck folder', () => {
      writeFileSync(join(tmpProjectDir, 'package.json'), '{}', 'utf-8');
      setLogDir(join(tmpProjectDir, '.mgcheck'));

      const testEntry: AuditEntry = {
        id: 'test-123',
        timestamp: new Date().toISOString(),
        tool: 'check_migration',
        risk: 'high',
        decision: 'blocked',
        query: 'DROP TABLE users;',
        violations: [
          {
            ruleId: 'MG006',
            severity: 'error',
            message: 'DROP TABLE is destructive',
          },
        ],
        errorCount: 1,
        warningCount: 0,
      };

      writeAuditEntry(testEntry);

      const auditFilePath = join(tmpProjectDir, '.mgcheck', 'audit.jsonl');
      expect(existsSync(auditFilePath)).toBe(true);

      const entries = readAuditLog();
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('test-123');
      expect(entries[0].query).toBe('DROP TABLE users;');
      expect(entries[0].risk).toBe('high');
      expect(entries[0].decision).toBe('blocked');
    });
  });

  describe('ensureGitIgnore', () => {
    it('should create .gitignore with .mgcheck/ when package.json exists', () => {
      writeFileSync(join(tmpProjectDir, 'package.json'), '{}', 'utf-8');
      const res = ensureGitIgnore(tmpProjectDir);
      expect(res).not.toBeNull();
      expect(res?.updated).toBe(true);

      const gitignore = readFileSync(join(tmpProjectDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('.mgcheck/');
    });

    it('should append .mgcheck/ to existing .gitignore', () => {
      const gitignorePath = join(tmpProjectDir, '.gitignore');
      writeFileSync(gitignorePath, 'node_modules/\ndist/\n', 'utf-8');

      const res = ensureGitIgnore(tmpProjectDir);
      expect(res?.updated).toBe(true);

      const updated = readFileSync(gitignorePath, 'utf-8');
      expect(updated).toContain('node_modules/');
      expect(updated).toContain('dist/');
      expect(updated).toContain('.mgcheck/');
    });

    it('should not duplicate .mgcheck/ if already present in .gitignore', () => {
      const gitignorePath = join(tmpProjectDir, '.gitignore');
      writeFileSync(gitignorePath, 'node_modules/\n.mgcheck/\n', 'utf-8');

      const res = ensureGitIgnore(tmpProjectDir);
      expect(res?.updated).toBe(false);

      const content = readFileSync(gitignorePath, 'utf-8');
      const matches = content.match(/\.mgcheck\//g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('setupMcp project initialization', () => {
    it('should create .mgcheck directory and update .gitignore during setup', () => {
      writeFileSync(join(tmpProjectDir, 'package.json'), '{}', 'utf-8');
      const results = setupMcp({ client: 'cursor', workspaceDir: tmpProjectDir });

      expect(existsSync(join(tmpProjectDir, '.mgcheck'))).toBe(true);
      expect(existsSync(join(tmpProjectDir, '.gitignore'))).toBe(true);

      const gitignore = readFileSync(join(tmpProjectDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('.mgcheck/');

      expect(results.some((r) => r.includes('.mgcheck/ to .gitignore'))).toBe(true);
    });
  });
});

describe('MCP tool storage routing', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mgcheck-routing-'));
    writeFileSync(join(projectDir, 'package.json'), '{}', 'utf-8');
    setLogDir(null);
    delete process.env.MGCHECK_STORAGE_DIR;
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function getTool(name: string) {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { runMcpTools } = await import('../../src/mcp/tools.js');
    const server = new McpServer({ name: 'test-server', version: '1.0.0' });
    runMcpTools(server);
    return (server as any)._registeredTools[name];
  }

  it('writes the audit entry to <project_dir>/.mgcheck even when cwd is elsewhere', async () => {
    const tool = await getTool('apply_migration');
    await tool.handler({
      migration_sql: 'CREATE INDEX idx_users ON users (email);',
      confirm_user_approved: true,
      project_dir: projectDir,
    });

    const entries = readAuditLog({ path: join(projectDir, '.mgcheck', 'audit.jsonl') });
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe('blocked');
    expect(entries[0].project).toBe(projectDir);
  });

  it('routes approval requests through the global queue and logs the decision per project', async () => {
    const { getGlobalLogDir, readPendingApprovals, writeDecision, startWatcherHeartbeat } = await import('../../src/core/activity-log.js');
    const ipcDir = getGlobalLogDir();
    const stopHeartbeat = startWatcherHeartbeat(ipcDir);
    const tool = await getTool('analyze_migration');

    const pending = tool.handler({
      migration_sql: 'CREATE INDEX CONCURRENTLY idx_users ON users (email);',
      project_dir: projectDir,
    });

    let request: AuditEntry | undefined;
    for (let i = 0; i < 100 && !request; i++) {
      await new Promise((r) => setTimeout(r, 100));
      request = readPendingApprovals(ipcDir).find((e) => e.project === projectDir);
    }
    expect(request).toBeDefined();
    expect(existsSync(join(projectDir, '.mgcheck', 'pending'))).toBe(false);
    writeDecision(request!.id, true, ipcDir);

    const response = await pending;
    stopHeartbeat();
    expect(response.isError).toBeFalsy();
    const entries = readAuditLog({ path: join(projectDir, '.mgcheck', 'audit.jsonl') });
    expect(entries.map((e) => e.decision)).toEqual(['user_approved']);
  });

  /** Run a tool while a simulated watcher answers the first request it sees. */
  async function runWithWatcher(toolName: string, args: Record<string, unknown>, answer: boolean) {
    const { getGlobalLogDir, readPendingApprovals, writeDecision, startWatcherHeartbeat } = await import('../../src/core/activity-log.js');
    const ipcDir = getGlobalLogDir();
    const stopHeartbeat = startWatcherHeartbeat(ipcDir);
    try {
      const tool = await getTool(toolName);
      const pending = tool.handler({ ...args, project_dir: projectDir });
      let request: AuditEntry | undefined;
      for (let i = 0; i < 100 && !request; i++) {
        await new Promise((r) => setTimeout(r, 100));
        request = readPendingApprovals(ipcDir).find((e) => e.project === projectDir);
      }
      expect(request).toBeDefined();
      writeDecision(request!.id, answer, ipcDir);
      return { request: request!, response: await pending };
    } finally {
      stopHeartbeat();
    }
  }

  it('shows HIGH risk queries in the watcher and lets the user override them', async () => {
    const { request, response } = await runWithWatcher('analyze_migration', { migration_sql: 'DROP TABLE customers;' }, true);
    expect(request.risk).toBe('high');
    expect(response.isError).toBeFalsy();
    expect(JSON.parse(response.content[0].text).guardian.decision).toBe('user_override');
    const entries = readAuditLog({ path: join(projectDir, '.mgcheck', 'audit.jsonl') });
    expect(entries.map((e) => e.decision)).toEqual(['user_override']);
  });

  it('keeps HIGH risk queries blocked when the user does not override', async () => {
    const { response } = await runWithWatcher('analyze_migration', { migration_sql: 'DROP TABLE customers;' }, false);
    expect(response.isError).toBe(true);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.guardian.decision).toBe('blocked');
    expect(parsed.guardian.message).toContain('kept it blocked');
  });

  it('answers MEDIUM/LOW immediately when no watcher terminal is running', async () => {
    const tool = await getTool('analyze_migration');
    const started = Date.now();
    const response = await tool.handler({
      migration_sql: 'CREATE INDEX CONCURRENTLY idx_users ON users (email);',
      project_dir: projectDir,
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(response.isError).toBe(true);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.guardian.decision).toBe('awaiting_watcher');
    expect(parsed.guardian.message).toContain('npx mgcheck');
  });

  it('treats a stale heartbeat as no watcher', async () => {
    const { getGlobalLogDir, isWatcherActive } = await import('../../src/core/activity-log.js');
    const ipcDir = getGlobalLogDir();
    mkdirSync(ipcDir, { recursive: true });
    writeFileSync(join(ipcDir, 'watcher.json'), JSON.stringify({ pid: process.pid, updatedAt: Date.now() - 60_000 }), 'utf-8');
    expect(isWatcherActive(ipcDir)).toBe(false);
    writeFileSync(join(ipcDir, 'watcher.json'), JSON.stringify({ pid: process.pid, updatedAt: Date.now() }), 'utf-8');
    expect(isWatcherActive(ipcDir)).toBe(true);
    rmSync(join(ipcDir, 'watcher.json'), { force: true });
  });
});

describe('Live event feed', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mgcheck-events-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const entry = (id: string): AuditEntry => ({
    id,
    timestamp: new Date().toISOString(),
    tool: 'cli:analyze',
    risk: 'high',
    decision: 'blocked',
    query: 'DROP TABLE customers;',
    violations: [],
    errorCount: 1,
    warningCount: 0,
  });

  it('delivers only events published after watching starts, across truncation', async () => {
    const { publishEvent, watchEvents } = await import('../../src/core/activity-log.js');
    publishEvent(entry('old'), dir);

    const seen: string[] = [];
    const stop = watchEvents((e) => seen.push(e.id), dir);
    publishEvent(entry('new-1'), dir);
    await new Promise((r) => setTimeout(r, 700));

    writeFileSync(join(dir, 'events.jsonl'), '', 'utf-8'); // simulate rotation
    await new Promise((r) => setTimeout(r, 700));
    publishEvent(entry('new-2'), dir);
    await new Promise((r) => setTimeout(r, 700));
    stop();

    expect(seen).toEqual(['new-1', 'new-2']);
  });

  it('publishes auto-blocked MCP calls to the global feed', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { runMcpTools } = await import('../../src/mcp/tools.js');
    const { getGlobalLogDir } = await import('../../src/core/activity-log.js');
    const server = new McpServer({ name: 'test-server', version: '1.0.0' });
    runMcpTools(server);

    writeFileSync(join(dir, 'package.json'), '{}', 'utf-8');
    await (server as any)._registeredTools['analyze_migration'].handler({
      migration_sql: 'DROP TABLE customers;',
      project_dir: dir,
    });

    const feed = readFileSync(join(getGlobalLogDir(), 'events.jsonl'), 'utf-8').trim().split('\n');
    const last = JSON.parse(feed[feed.length - 1]);
    expect(last.decision).toBe('blocked');
    expect(last.query).toBe('DROP TABLE customers;');
    expect(last.project).toBe(dir);
  });
});
