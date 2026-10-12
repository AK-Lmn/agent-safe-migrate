import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os, { tmpdir } from 'node:os';
import {
  setupMcp,
  uninstallMcp,
  injectAgentRules,
  installGitHook,
  uninstallGitHook,
  findConnections,
  stripJsonc,
  stripGuardianRules,
  addGooseExtension,
  removeGooseExtension,
  getZedSettingsPath,
  getGooseConfigPath,
  getStagedMigrations,
  HOOK_COMMAND,
  detectClients,
} from '../../src/installer/index.js';
import { execSync } from 'node:child_process';

const home = () => os.homedir();

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

describe('Installer / Uninstaller', () => {
  let workspace: string | undefined;

  beforeEach(() => {
    workspace = undefined;
    // Guard: never run installer tests against the real home directory
    expect(home()).toContain('mgcheck-home-');
    workspace = mkdtempSync(join(tmpdir(), 'mgcheck-ws-'));
  });

  afterEach(() => {
    // Only clean up when both home and workspace are sandboxed
    if (!workspace || !home().includes('mgcheck-home-')) return;
    uninstallMcp({ client: 'all', workspaceDir: workspace, purge: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  describe('stripJsonc', () => {
    it('removes comments and trailing commas but not inside strings', () => {
      const src = `{
        // line comment
        "url": "http://example.com/a,}", /* block */
        "list": [1, 2,],
      }`;
      expect(JSON.parse(stripJsonc(src))).toEqual({ url: 'http://example.com/a,}', list: [1, 2] });
    });
  });

  describe('JSONC editor configs (Zed)', () => {
    it('keeps user settings on setup and removes only our entry on uninstall', () => {
      const zed = getZedSettingsPath();
      write(zed, `// Zed settings\n{\n  "theme": "One Dark", // mine\n  "context_servers": { "other": {} },\n}\n`);

      setupMcp({ client: 'zed', workspaceDir: workspace });
      const afterSetup = JSON.parse(readFileSync(zed, 'utf-8'));
      expect(afterSetup.theme).toBe('One Dark');
      expect(afterSetup.context_servers.other).toEqual({});
      expect(afterSetup.context_servers['migration-guardian']).toBeDefined();
      expect(existsSync(`${zed}.mgcheck.bak`)).toBe(true);

      const res = uninstallMcp({ client: 'zed', workspaceDir: workspace });
      expect(res.some((r) => r.includes('Removed from Zed'))).toBe(true);
      const afterUninstall = JSON.parse(readFileSync(zed, 'utf-8'));
      expect(afterUninstall).toEqual({ theme: 'One Dark', context_servers: { other: {} } });
    });

    it('refuses to overwrite a config it cannot parse', () => {
      const zed = getZedSettingsPath();
      const broken = '{ "theme": "One Dark" ';
      write(zed, broken);
      const res = setupMcp({ client: 'zed', workspaceDir: workspace });
      expect(res.some((r) => r.includes('Zed Editor') && r.includes('Could not parse'))).toBe(true);
      expect(readFileSync(zed, 'utf-8')).toBe(broken);
    });
  });

  describe('Goose YAML', () => {
    const userYaml = `GOOSE_PROVIDER: openai\nextensions:\n  developer:\n    name: developer\n    enabled: true\n  memory:\n    name: memory\n    enabled: true\n`;

    it('nests under an existing extensions key instead of duplicating it', () => {
      const out = addGooseExtension(userYaml);
      expect(out.match(/^extensions:/gm)).toHaveLength(1);
      expect(out).toContain('  migration-guardian:');
    });

    it('setup then uninstall leaves sibling extensions intact', () => {
      const goose = getGooseConfigPath();
      write(goose, userYaml);
      setupMcp({ client: 'goose', workspaceDir: workspace });
      uninstallMcp({ client: 'goose', workspaceDir: workspace });
      expect(readFileSync(goose, 'utf-8')).toBe(userYaml);
    });

    it('removes legacy (unmarked) installs without eating later extensions', () => {
      const legacy = `extensions:\n  migration-guardian:\n    name: migration-guardian\n    cmd: npx\n    args:\n      - -y\n      - mgcheck\n      - mcp\n  developer:\n    name: developer\nGOOSE_MODEL: gpt-4o\n`;
      const out = removeGooseExtension(legacy);
      expect(out).toBe(`extensions:\n  developer:\n    name: developer\nGOOSE_MODEL: gpt-4o\n`);
    });

    it('drops an extensions key that only contained our entry', () => {
      const out = removeGooseExtension(addGooseExtension('GOOSE_PROVIDER: openai\n'));
      expect(out).toBe('GOOSE_PROVIDER: openai\n');
    });
  });

  describe('Aider', () => {
    it('removes only our block, keeping unrelated mgcheck mentions', () => {
      const aider = join(home(), '.aider.conf.yml');
      const user = `model: gpt-4o\n# notes about mgcheck-like tools\n`;
      write(aider, user);
      setupMcp({ client: 'aider', workspaceDir: workspace });
      expect(readFileSync(aider, 'utf-8')).toContain('lint-cmd: "npx mgcheck analyze"');
      uninstallMcp({ client: 'aider', workspaceDir: workspace });
      expect(readFileSync(aider, 'utf-8')).toBe(user);
    });

    it('does not add a duplicate lint-cmd key', () => {
      const aider = join(home(), '.aider.conf.yml');
      write(aider, 'lint-cmd: "eslint"\n');
      const res = setupMcp({ client: 'aider', workspaceDir: workspace });
      expect(res.some((r) => r.includes('already defines lint-cmd'))).toBe(true);
      expect(readFileSync(aider, 'utf-8')).toBe('lint-cmd: "eslint"\n');
    });
  });

  describe('Claude Code', () => {
    it('removes user-scope, per-project and .mcp.json entries', () => {
      const claudeJson = join(home(), '.claude.json');
      write(claudeJson, JSON.stringify({
        numStartups: 3,
        mcpServers: { 'migration-guardian': {}, other: {} },
        projects: {
          '/a': { mcpServers: { 'migration-guardian': {} } },
          '/b': { mcpServers: { keep: {} } },
        },
      }));
      write(join(workspace, '.mcp.json'), JSON.stringify({ mcpServers: { 'migration-guardian': {} } }));

      uninstallMcp({ client: 'claude-code', workspaceDir: workspace });

      const cfg = JSON.parse(readFileSync(claudeJson, 'utf-8'));
      expect(cfg.numStartups).toBe(3);
      expect(cfg.mcpServers).toEqual({ other: {} });
      expect(cfg.projects['/a'].mcpServers).toEqual({});
      expect(cfg.projects['/b'].mcpServers).toEqual({ keep: {} });
      expect(JSON.parse(readFileSync(join(workspace, '.mcp.json'), 'utf-8')).mcpServers).toEqual({});
    });
  });

  describe('Agent rule files', () => {
    it('strips our rules block and keeps user content', () => {
      const claudeMd = join(workspace, 'CLAUDE.md');
      write(claudeMd, '# My Project\n\nUse pnpm.\n');
      injectAgentRules(workspace);
      expect(readFileSync(claudeMd, 'utf-8')).toContain('MIGRATION GUARDIAN SAFETY RULES');

      uninstallMcp({ client: 'all', workspaceDir: workspace });
      expect(readFileSync(claudeMd, 'utf-8')).toBe('# My Project\n\nUse pnpm.\n');
      expect(existsSync(join(workspace, 'AGENTS.md'))).toBe(false);
      expect(existsSync(join(workspace, '.cursor', 'rules', 'migration-guardian.mdc'))).toBe(false);
    });

    it('strips legacy blocks that have no end marker', () => {
      const legacy = '<!-- MIGRATION GUARDIAN SAFETY RULES -->\n## Database Migration Safety\n   - `MG010`: Provide a rollback.\n\n## Other notes\nkeep me\n';
      expect(stripGuardianRules(legacy)).toBe('## Other notes\nkeep me');
    });
  });

  describe('Git hook', () => {
    it('backs up an existing user hook and restores it on uninstall', () => {
      const hook = join(workspace, '.git', 'hooks', 'pre-commit');
      const original = '#!/bin/sh\necho "lint"\n';
      write(hook, original);

      installGitHook(workspace);
      expect(readFileSync(hook, 'utf-8')).toContain('Migration Guardian');
      expect(readFileSync(hook, 'utf-8')).toContain('pre-commit.mgcheck-backup');

      const res = uninstallGitHook(workspace);
      expect(res).toContain('restored');
      expect(readFileSync(hook, 'utf-8')).toBe(original);
    });

    it('does not write to .git/hooks when core.hooksPath is set (Husky/Lefthook)', () => {
      execSync('git init -q', { cwd: workspace });
      execSync('git config core.hooksPath .husky', { cwd: workspace });

      const res = installGitHook(workspace);
      expect(res).toContain('core.hooksPath (.husky)');
      expect(res).toContain(HOOK_COMMAND);
      expect(existsSync(join(workspace, '.git', 'hooks', 'pre-commit'))).toBe(false);
    });

    it('lists only staged .sql files, including paths with spaces', () => {
      execSync('git init -q', { cwd: workspace });
      write(join(workspace, 'db', 'my migration.sql'), 'SELECT 1;');
      write(join(workspace, 'b.SQL'), 'SELECT 1;');
      write(join(workspace, 'notes.txt'), 'x');
      write(join(workspace, 'unstaged.sql'), 'SELECT 1;');
      execSync('git add "db/my migration.sql" b.SQL notes.txt', { cwd: workspace });

      const staged = getStagedMigrations(workspace).map((f) => f.replace(/\\/g, '/'));
      expect(staged).toHaveLength(2);
      expect(staged.some((f) => f.endsWith('db/my migration.sql'))).toBe(true);
      expect(staged.some((f) => f.endsWith('b.SQL'))).toBe(true);
    });
  });

  describe('detectClients', () => {
    const detectedNames = () => detectClients().clients.filter((c) => c.detected).map((c) => c.name);

    it('does not count config folders that mgcheck setup itself created', () => {
      // Earlier tests leave a user-authored Aider config behind, which is a real signal
      rmSync(join(home(), '.aider.conf.yml'), { force: true });
      for (const c of ['cursor', 'zed', 'goose', 'aider', 'openhands', 'continue', 'cline', 'windsurf', 'antigravity', 'claude']) {
        setupMcp({ client: c, workspaceDir: workspace });
      }
      const fake = ['Google Antigravity', 'Cursor IDE', 'Claude Desktop', 'Cline (VS Code)', 'Continue.dev',
        'Windsurf (Codeium)', 'Zed Editor', 'Goose (Block)', 'Aider', 'OpenHands'];
      expect(detectedNames().filter((n) => fake.includes(n))).toEqual([]);
    });

    it('detects apps from files the app itself creates', () => {
      mkdirSync(join(home(), '.cursor', 'extensions'), { recursive: true });
      mkdirSync(join(home(), '.gemini', 'antigravity-ide'), { recursive: true });
      write(join(home(), '.vscode', 'extensions', 'saoudrizwan.claude-dev-4.1.23', 'package.json'), '{}');
      const names = detectedNames();
      expect(names).toEqual(expect.arrayContaining(['Cursor IDE', 'Google Antigravity', 'Cline (VS Code)']));
      rmSync(join(home(), '.cursor', 'extensions'), { recursive: true, force: true });
      rmSync(join(home(), '.gemini', 'antigravity-ide'), { recursive: true, force: true });
      rmSync(join(home(), '.vscode'), { recursive: true, force: true });
    });

    it('setup --client all only configures detected apps', () => {
      setupMcp({ client: 'all', workspaceDir: workspace });
      const connected = findConnections(workspace).map((c) => c.client);
      const detected = detectClients();
      for (const client of connected) {
        expect(detected[client]).toBe(true);
      }
    });
  });

  describe('Full cycle', () => {
    it('leaves no connections or central rules behind after uninstall --client all', () => {
      setupMcp({ client: 'all', workspaceDir: workspace, withRules: true });
      for (const c of ['cursor', 'zed', 'goose', 'aider', 'openhands', 'continue', 'cline', 'claude-code']) {
        setupMcp({ client: c, workspaceDir: workspace });
      }
      expect(findConnections(workspace).length).toBeGreaterThan(0);
      expect(existsSync(join(home(), '.mgcheck', 'rules.md'))).toBe(true);

      uninstallMcp({ client: 'all', workspaceDir: workspace });

      expect(findConnections(workspace)).toEqual([]);
      expect(existsSync(join(home(), '.mgcheck', 'rules.md'))).toBe(false);
      // Audit storage is kept without --purge
      expect(existsSync(join(workspace, '.mgcheck'))).toBe(true);
    });

    it('--purge deletes audit storage and the .gitignore entry', () => {
      write(join(workspace, 'package.json'), '{}');
      write(join(workspace, '.gitignore'), 'node_modules/\n');
      setupMcp({ client: 'cursor', workspaceDir: workspace });
      expect(readFileSync(join(workspace, '.gitignore'), 'utf-8')).toContain('.mgcheck/');

      uninstallMcp({ client: 'all', workspaceDir: workspace, purge: true });
      expect(existsSync(join(workspace, '.mgcheck'))).toBe(false);
      expect(readFileSync(join(workspace, '.gitignore'), 'utf-8')).toBe('node_modules/\n');
    });
  });
});
