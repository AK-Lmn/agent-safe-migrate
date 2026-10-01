import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runMcpTools } from '../../src/mcp/tools.js';
import { installGitHook } from '../../src/installer/index.js';

describe('Ironclad Safety Gates', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mgcheck-ironclad-test-'));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Git Pre-Commit Hook Installer', () => {
    it('should return null if not in a git repository', () => {
      const result = installGitHook(tmpDir);
      expect(result).toBeNull();
    });

    it('should create .git/hooks/pre-commit when .git exists', () => {
      const gitDir = join(tmpDir, '.git');
      mkdirSync(gitDir, { recursive: true });

      const result = installGitHook(tmpDir);
      expect(result).not.toBeNull();
      expect(result).toContain('Git Pre-Commit Hook');

      const hookPath = join(gitDir, 'hooks', 'pre-commit');
      expect(existsSync(hookPath)).toBe(true);

      const content = readFileSync(hookPath, 'utf-8');
      expect(content).toContain('Migration Guardian Git Pre-Commit Safety Hook');
      expect(content).toContain('STAGED_MIGRATIONS');
      expect(content).toContain('npx mgcheck run');
    });
  });

  describe('In-Code AST Gate in apply_migration MCP Tool', () => {
    it('should reject unsafe SQL with AST errors even if user approval is claimed', async () => {
      const server = new McpServer({ name: 'test-server', version: '1.0.0' });
      runMcpTools(server);

      // Access registered tool handler
      const toolInstance = (server as any)._registeredTools?.['apply_migration'];
      expect(toolInstance).toBeDefined();

      const unsafeSql = 'CREATE INDEX idx_users ON users (email);';
      const response = await toolInstance.handler({
        migration_sql: unsafeSql,
        confirm_user_approved: true,
      });

      expect(response.isError).toBe(true);
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('SECURITY GATE REJECTION');
      expect(parsed.error).toContain('MG001');
    });

    it('should reject call when confirm_user_approved is false', async () => {
      const server = new McpServer({ name: 'test-server', version: '1.0.0' });
      runMcpTools(server);

      const toolInstance = (server as any)._registeredTools?.['apply_migration'];
      expect(toolInstance).toBeDefined();

      const response = await toolInstance.handler({
        migration_sql: 'CREATE INDEX CONCURRENTLY idx_users ON users (email);',
        confirm_user_approved: false,
      });

      expect(response.isError).toBe(true);
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('User confirmation required');
    });
  });
});
