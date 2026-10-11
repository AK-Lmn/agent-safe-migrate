import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runMcpTools } from '../../src/mcp/tools.js';
import { installGitHook, uninstallGitHook, setupMcp, uninstallMcp, detectClients } from '../../src/installer/index.js';

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
      expect(content).toContain('git diff --cached');
      expect(content).toContain('mgcheck hook run');
    });

    it('should uninstall pre-commit hook cleanly when requested', () => {
      const gitDir = join(tmpDir, '.git');
      mkdirSync(gitDir, { recursive: true });

      installGitHook(tmpDir);
      const hookPath = join(gitDir, 'hooks', 'pre-commit');
      expect(existsSync(hookPath)).toBe(true);

      const res = uninstallGitHook(tmpDir);
      expect(res).toContain('Removed Git Pre-Commit Hook');
      expect(existsSync(hookPath)).toBe(false);
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

  describe('Pure MCP Zero-Clutter Mode', () => {
    it('should not create any markdown files in the workspace by default', () => {
      setupMcp({ client: 'cursor', workspaceDir: tmpDir });

      expect(existsSync(join(tmpDir, '.cursorrules'))).toBe(false);
      expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(false);
      expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(false);
      expect(existsSync(join(tmpDir, '.windsurfrules'))).toBe(false);
      expect(existsSync(join(tmpDir, '.github'))).toBe(false);
      expect(existsSync(join(tmpDir, '.cursor'))).toBe(false);
    });

    it('should detect and report on all 12 supported AI agents and clients', () => {
      const result = detectClients();
      expect(result).toHaveProperty('clients');
      expect(Array.isArray(result.clients)).toBe(true);

      const clientNames = result.clients.map((c) => c.name);
      expect(clientNames).toContain('Google Antigravity');
      expect(clientNames).toContain('Cursor IDE');
      expect(clientNames).toContain('Claude Desktop');
      expect(clientNames).toContain('Claude Code CLI');
      expect(clientNames).toContain('Cline (VS Code)');
      expect(clientNames).toContain('Roo Code (VS Code)');
      expect(clientNames).toContain('Continue.dev');
      expect(clientNames).toContain('Windsurf (Codeium)');
      expect(clientNames).toContain('Zed Editor');
      expect(clientNames).toContain('Goose (Block)');
      expect(clientNames).toContain('Aider');
      expect(clientNames).toContain('OpenHands');
    });

    it('should configure Cline when targeted directly', () => {
      const results = setupMcp({ client: 'cline', workspaceDir: tmpDir });
      expect(results.some((r) => r.includes('Cline'))).toBe(true);
    });

    it('should configure Zed Editor when targeted directly', () => {
      const results = setupMcp({ client: 'zed', workspaceDir: tmpDir });
      expect(results.some((r) => r.includes('Zed Editor'))).toBe(true);
    });

    it('should configure Continue.dev when targeted directly', () => {
      const results = setupMcp({ client: 'continue', workspaceDir: tmpDir });
      expect(results.some((r) => r.includes('Continue.dev'))).toBe(true);
    });

    it('should configure Goose when targeted directly', () => {
      const results = setupMcp({ client: 'goose', workspaceDir: tmpDir });
      expect(results.some((r) => r.includes('Goose'))).toBe(true);
    });

    it('should configure Aider when targeted directly', () => {
      const results = setupMcp({ client: 'aider', workspaceDir: tmpDir });
      expect(results.some((r) => r.includes('Aider'))).toBe(true);
    });

    it('should configure OpenHands when targeted directly', () => {
      const results = setupMcp({ client: 'openhands', workspaceDir: tmpDir });
      expect(results.some((r) => r.includes('OpenHands'))).toBe(true);
    });

    it('should uninstall MCP config cleanly when targeted directly', () => {
      setupMcp({ client: 'cline', workspaceDir: tmpDir });
      const uninstResults = uninstallMcp({ client: 'cline', workspaceDir: tmpDir });
      expect(uninstResults.some((r) => r.includes('Removed from Cline'))).toBe(true);
    });
  });
});
