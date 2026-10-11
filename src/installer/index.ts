import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';
import chalk from 'chalk';

export interface SetupOptions {
  client?: string;
  yes?: boolean;
  withRules?: boolean;
  /** Uninstall only: also delete audit logs (~/.mgcheck and <project>/.mgcheck) */
  purge?: boolean;
  workspaceDir?: string;
}

export interface DetectedClient {
  name: string;
  detected: boolean;
  description?: string;
}

export interface DetectResult {
  antigravity: boolean;
  cursor: boolean;
  claude: boolean;
  claudeCode: boolean;
  windsurf: boolean;
  cline: boolean;
  rooCode: boolean;
  continueDev: boolean;
  zed: boolean;
  goose: boolean;
  aider: boolean;
  openhands: boolean;
  vscode: boolean;
  clients: DetectedClient[];
  hasAny: boolean;
}

function isOnPath(command: string): boolean {
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${command}` : `which ${command}`;
    execSync(cmd, { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function hasVsCodeExtension(prefix: string): boolean {
  try {
    const extDir = join(os.homedir(), '.vscode', 'extensions');
    if (!existsSync(extDir)) return false;
    return readdirSync(extDir).some((d) => d.toLowerCase().startsWith(prefix.toLowerCase()));
  } catch {
    return false;
  }
}

export function getClineMcpPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  } else if (process.platform === 'darwin') {
    return join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  } else {
    return join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  }
}

export function getRooMcpPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
  } else if (process.platform === 'darwin') {
    return join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
  } else {
    return join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
  }
}

export function getZedSettingsPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || '', 'Zed', 'settings.json');
  } else {
    return join(os.homedir(), '.config', 'zed', 'settings.json');
  }
}

export function getGooseConfigPath(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData && existsSync(join(localAppData, 'goose'))) {
      return join(localAppData, 'goose', 'config.yaml');
    }
  }
  return join(os.homedir(), '.config', 'goose', 'config.yaml');
}

export function getClaudeDesktopConfigPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
  } else if (process.platform === 'darwin') {
    return join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

const MCP_KEY = 'migration-guardian';
const BLOCK_START = '# >>> migration-guardian';
const BLOCK_END = '# <<< migration-guardian';

/**
 * Strip // and /* *\/ comments and trailing commas from JSONC text (string-aware).
 * Editors like Zed and VS Code allow these in their settings files.
 */
export function stripJsonc(text: string): string {
  const removeComments = (src: string): string => {
    let out = '';
    let inStr = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      const next = src[i + 1];
      if (inStr) {
        out += ch;
        if (ch === '\\') {
          out += next ?? '';
          i++;
        } else if (ch === '"') {
          inStr = false;
        }
      } else if (ch === '"') {
        inStr = true;
        out += ch;
      } else if (ch === '/' && next === '/') {
        while (i < src.length && src[i] !== '\n') i++;
        out += '\n';
      } else if (ch === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        i = end === -1 ? src.length : end + 1;
      } else {
        out += ch;
      }
    }
    return out;
  };

  const removeTrailingCommas = (src: string): string => {
    let out = '';
    let inStr = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inStr) {
        out += ch;
        if (ch === '\\') {
          out += src[i + 1] ?? '';
          i++;
        } else if (ch === '"') {
          inStr = false;
        }
      } else if (ch === '"') {
        inStr = true;
        out += ch;
      } else if (ch === ',' && /^\s*[}\]]/.test(src.slice(i + 1))) {
        // drop trailing comma
      } else {
        out += ch;
      }
    }
    return out;
  };

  return removeTrailingCommas(removeComments(text.replace(/^﻿/, '')));
}

/**
 * Read a JSON/JSONC config file. Returns {} when the file is missing or empty.
 * Throws when the file exists but cannot be parsed — callers must never
 * overwrite a file they could not read.
 */
export function readJsonConfig(filePath: string): any {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf-8');
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(stripJsonc(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    throw new Error(`Could not parse ${filePath} (left untouched): ${(err as Error).message}`);
  }
}

/**
 * Write a JSON config file, saving a one-time `.mgcheck.bak` of the original first.
 */
export function writeJsonConfig(filePath: string, config: any): void {
  backupOnce(filePath);
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function backupOnce(filePath: string): void {
  const backup = `${filePath}.mgcheck.bak`;
  if (existsSync(filePath) && !existsSync(backup)) {
    copyFileSync(filePath, backup);
  }
}

/**
 * Add the migration-guardian server entry to a JSON MCP config file.
 */
function upsertMcpEntry(filePath: string, value: unknown, key = 'mcpServers'): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const config = readJsonConfig(filePath);
  if (!config[key] || typeof config[key] !== 'object') config[key] = {};
  config[key][MCP_KEY] = value;
  writeJsonConfig(filePath, config);
}

/**
 * Remove a `# >>> migration-guardian` … `# <<< migration-guardian` block (inclusive).
 */
function removeMarkedBlock(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === BLOCK_START) {
      inside = true;
      continue;
    }
    if (t === BLOCK_END) {
      inside = false;
      continue;
    }
    if (!inside) out.push(line);
  }
  return out.join('\n');
}

/**
 * Insert the migration-guardian Goose extension, nesting it under an existing
 * top-level `extensions:` key instead of creating a duplicate key.
 */
export function addGooseExtension(yamlContent: string): string {
  const entry = [
    `  ${BLOCK_START}`,
    `  ${MCP_KEY}:`,
    `    name: ${MCP_KEY}`,
    '    cmd: npx',
    '    args:',
    '      - -y',
    '      - mgcheck',
    '      - mcp',
    '    type: stdio',
    '    enabled: true',
    `  ${BLOCK_END}`,
  ];
  const lines = yamlContent.split('\n');
  const extIdx = lines.findIndex((l) => /^extensions:\s*(#.*)?$/.test(l));
  if (extIdx !== -1) {
    lines.splice(extIdx + 1, 0, ...entry);
    return lines.join('\n');
  }
  if (lines.some((l) => /^extensions:/.test(l))) {
    throw new Error('Goose config uses an inline `extensions:` value; add migration-guardian manually.');
  }
  const base = yamlContent.trimEnd();
  return `${base ? base + '\n' : ''}extensions:\n${entry.join('\n')}\n`;
}

/**
 * Remove the migration-guardian Goose extension. Handles marked blocks and
 * legacy (unmarked) installs without touching sibling extensions.
 */
export function removeGooseExtension(yamlContent: string): string {
  let lines = removeMarkedBlock(yamlContent).split('\n');

  // Legacy installs: drop the `migration-guardian:` key and its more-indented children
  const keyIdx = lines.findIndex((l) => /^\s*migration-guardian:\s*$/.test(l));
  if (keyIdx !== -1) {
    const indent = lines[keyIdx].search(/\S/);
    let end = keyIdx + 1;
    while (end < lines.length) {
      const l = lines[end];
      if (l.trim() !== '' && l.search(/\S/) <= indent) break;
      end++;
    }
    lines.splice(keyIdx, end - keyIdx);
  }

  // Drop `extensions:` keys that are now empty
  lines = lines.filter((l, i) => {
    if (!/^extensions:\s*$/.test(l)) return true;
    const next = lines.slice(i + 1).find((n) => n.trim() !== '');
    return next !== undefined && /^\s/.test(next);
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Detect which AI editors/clients/agents are actually installed on the user's system.
 */
export function detectClients(): DetectResult {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || '';
  const appData = process.env.APPDATA || '';

  // 1. Google Antigravity
  const geminiDir = join(home, '.gemini');
  const antigravity = Boolean(
    existsSync(join(geminiDir, 'antigravity-ide')) ||
    existsSync(geminiDir) ||
    process.env.ANTIGRAVITY_APP_DIR ||
    process.env.ANTIGRAVITY_IDE
  );

  // 2. Cursor IDE
  let cursor = false;
  if (process.platform === 'win32') {
    cursor = existsSync(join(localAppData, 'Programs', 'cursor', 'Cursor.exe')) ||
             existsSync(join(programFiles, 'Cursor', 'Cursor.exe')) ||
             existsSync(join(home, '.cursor'));
  } else if (process.platform === 'darwin') {
    cursor = existsSync('/Applications/Cursor.app') ||
             existsSync(join(home, 'Applications', 'Cursor.app')) ||
             existsSync(join(home, '.cursor'));
  } else {
    cursor = existsSync('/opt/Cursor/cursor') ||
             existsSync(join(home, '.config', 'Cursor')) ||
             existsSync(join(home, '.cursor'));
  }

  // 3. Claude Desktop (GUI app)
  let claude = false;
  if (process.platform === 'win32') {
    claude = existsSync(join(localAppData, 'Programs', 'claude', 'Claude.exe')) ||
             existsSync(join(localAppData, 'AnthropicClaude', 'Claude.exe')) ||
             existsSync(join(appData, 'Claude'));
  } else if (process.platform === 'darwin') {
    claude = existsSync('/Applications/Claude.app') ||
             existsSync(join(home, 'Applications', 'Claude.app')) ||
             existsSync(join(home, 'Library', 'Application Support', 'Claude'));
  } else {
    const claudeConfig = join(home, '.config', 'Claude', 'claude_desktop_config.json');
    claude = existsSync(claudeConfig) || existsSync(join(home, '.config', 'Claude'));
  }

  // 4. Claude Code CLI
  const claudeCode = existsSync(join(home, '.claude.json')) ||
                     existsSync(join(home, '.claude')) ||
                     hasVsCodeExtension('anthropic.claude-code') ||
                     isOnPath('claude');

  // 5. Cline (VS Code Autonomous Coding Agent)
  const clineMcpPath = getClineMcpPath();
  const cline = existsSync(dirname(clineMcpPath)) || hasVsCodeExtension('saoudrizwan.claude-dev');

  // 6. Roo Code (VS Code Autonomous Agent)
  const rooMcpPath = getRooMcpPath();
  const rooCode = existsSync(dirname(rooMcpPath)) || hasVsCodeExtension('rooveterinaryinc.roo-cline');

  // 7. Continue.dev (VS Code & JetBrains Agent)
  const continueDev = existsSync(join(home, '.continue')) || hasVsCodeExtension('continue.continue');

  // 8. Windsurf (Codeium)
  let windsurf = false;
  if (process.platform === 'win32') {
    windsurf = existsSync(join(localAppData, 'Programs', 'windsurf', 'Windsurf.exe')) ||
               existsSync(join(localAppData, 'Windsurf')) ||
               existsSync(join(home, '.codeium', 'windsurf'));
  } else if (process.platform === 'darwin') {
    windsurf = existsSync('/Applications/Windsurf.app') ||
               existsSync(join(home, 'Applications', 'Windsurf.app')) ||
               existsSync(join(home, '.codeium', 'windsurf'));
  } else {
    windsurf = existsSync(join(home, '.config', 'Windsurf')) || existsSync(join(home, '.codeium', 'windsurf'));
  }

  // 9. Zed Editor
  let zed = false;
  if (process.platform === 'win32') {
    zed = existsSync(join(localAppData, 'Programs', 'Zed', 'Zed.exe')) ||
          existsSync(join(appData, 'Zed')) ||
          existsSync(join(home, '.config', 'zed')) ||
          isOnPath('zed');
  } else if (process.platform === 'darwin') {
    zed = existsSync('/Applications/Zed.app') || existsSync(join(home, 'Applications', 'Zed.app')) || isOnPath('zed');
  } else {
    zed = existsSync(join(home, '.config', 'zed')) || isOnPath('zed');
  }

  // 10. Goose (Block / Square Agent)
  const gooseConfig = getGooseConfigPath();
  const goose = existsSync(join(home, '.config', 'goose')) || existsSync(dirname(gooseConfig)) || isOnPath('goose');

  // 11. Aider (CLI Pair Programmer)
  const aider = existsSync(join(home, '.aider.conf.yml')) || isOnPath('aider');

  // 12. OpenHands (Autonomous Software Engineer)
  const openhands = existsSync(join(home, '.openhands')) || existsSync(join(process.cwd(), '.openhands')) || Boolean(process.env.OPENHANDS_WORKSPACE);

  // 13. VS Code + GitHub Copilot
  const vscode = hasVsCodeExtension('github.copilot') || hasVsCodeExtension('github.copilot-chat');

  // ── Build client list ─────────────────────────────────────────────
  const clients: DetectedClient[] = [
    { name: 'Google Antigravity', detected: antigravity },
    { name: 'Cursor IDE', detected: cursor },
    { name: 'Claude Desktop', detected: claude },
    { name: 'Claude Code CLI', detected: claudeCode },
    { name: 'Cline (VS Code)', detected: cline },
    { name: 'Roo Code (VS Code)', detected: rooCode },
    { name: 'Continue.dev', detected: continueDev },
    { name: 'Windsurf (Codeium)', detected: windsurf },
    { name: 'Zed Editor', detected: zed },
    { name: 'Goose (Block)', detected: goose },
    { name: 'Aider', detected: aider },
    { name: 'OpenHands', detected: openhands },
    { name: 'VS Code + Copilot', detected: vscode },
  ];

  return {
    antigravity,
    cursor,
    claude,
    claudeCode,
    windsurf,
    cline,
    rooCode,
    continueDev,
    zed,
    goose,
    aider,
    openhands,
    vscode,
    clients,
    hasAny: clients.some((c) => c.detected),
  };
}

/**
 * Apply the MCP server configuration to the specified clients.
 */
export function setupMcp(options: SetupOptions = {}): string[] {
  const targetClient = (options.client || 'all').toLowerCase();
  const workspaceDir = options.workspaceDir || process.cwd();
  const results: string[] = [];
  const detected = detectClients();

  // Generalized, portable MCP command that runs on any machine / OS
  const mcpServerConfig = {
    command: 'npx',
    args: ['-y', 'mgcheck', 'mcp'],
  };

  // 1. Google Antigravity Configuration (~/.gemini/config/mcp_config.json)
  if (targetClient === 'all' || targetClient === 'antigravity' || targetClient === 'gemini') {
    try {
      const mcpConfigFile = join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
      upsertMcpEntry(mcpConfigFile, mcpServerConfig);
      results.push(chalk.green('  ✅ Google Antigravity') + chalk.dim(` (${mcpConfigFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Google Antigravity: ') + (err as Error).message);
    }
  }

  // 2. Cursor Configuration (Global ~/.cursor/mcp.json — zero workspace clutter)
  if (targetClient === 'all' || targetClient === 'cursor') {
    try {
      const cursorFile = join(os.homedir(), '.cursor', 'mcp.json');
      upsertMcpEntry(cursorFile, mcpServerConfig);
      results.push(chalk.green('  ✅ Cursor IDE') + chalk.dim(` (${cursorFile})`));

      // If a local .cursor already exists in the workspace, also add the entry there
      if (existsSync(join(workspaceDir, '.cursor'))) {
        upsertMcpEntry(join(workspaceDir, '.cursor', 'mcp.json'), mcpServerConfig);
      }
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Cursor IDE: ') + (err as Error).message);
    }
  }

  // 3. Claude Desktop Configuration
  if (targetClient === 'claude' || targetClient === 'claude-desktop' || (targetClient === 'all' && detected.claude)) {
    try {
      const claudeConfigFile = getClaudeDesktopConfigPath();
      upsertMcpEntry(claudeConfigFile, mcpServerConfig);
      results.push(chalk.green('  ✅ Claude Desktop') + chalk.dim(` (${claudeConfigFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Claude Desktop: ') + (err as Error).message);
    }
  }

  // 4. Claude Code CLI (~/.claude.json)
  if (targetClient === 'claude-code' || targetClient === 'claudecode' || (targetClient === 'all' && detected.claudeCode)) {
    try {
      const claudeCodeFile = join(os.homedir(), '.claude.json');
      upsertMcpEntry(claudeCodeFile, mcpServerConfig);
      results.push(chalk.green('  ✅ Claude Code CLI') + chalk.dim(` (${claudeCodeFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Claude Code CLI: ') + (err as Error).message);
    }
  }

  // 5. Cline (VS Code Autonomous Coding Agent)
  if (targetClient === 'cline' || (targetClient === 'all' && detected.cline)) {
    try {
      const clineFile = getClineMcpPath();
      upsertMcpEntry(clineFile, mcpServerConfig);
      results.push(chalk.green('  ✅ Cline') + chalk.dim(` (${clineFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Cline: ') + (err as Error).message);
    }
  }

  // 6. Roo Code (VS Code Coding Agent)
  if (targetClient === 'roo' || targetClient === 'roo-code' || targetClient === 'roocode' || (targetClient === 'all' && detected.rooCode)) {
    try {
      const rooFile = getRooMcpPath();
      upsertMcpEntry(rooFile, mcpServerConfig);

      // Also add to roo_mcp_settings.json for multi-version Roo compatibility
      upsertMcpEntry(join(dirname(rooFile), 'roo_mcp_settings.json'), mcpServerConfig);

      results.push(chalk.green('  ✅ Roo Code') + chalk.dim(` (${rooFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Roo Code: ') + (err as Error).message);
    }
  }

  // 7. Continue.dev (~/.continue/config.json)
  if (targetClient === 'continue' || targetClient === 'continue-dev' || targetClient === 'continuedev' || (targetClient === 'all' && detected.continueDev)) {
    try {
      const contJson = join(os.homedir(), '.continue', 'config.json');
      upsertMcpEntry(contJson, mcpServerConfig);
      results.push(chalk.green('  ✅ Continue.dev') + chalk.dim(` (${contJson})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Continue.dev: ') + (err as Error).message);
    }
  }

  // 8. Windsurf Configuration (~/.codeium/windsurf/mcp_config.json)
  if (targetClient === 'windsurf' || targetClient === 'codeium' || (targetClient === 'all' && detected.windsurf)) {
    try {
      const windsurfConfigFile = join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
      upsertMcpEntry(windsurfConfigFile, mcpServerConfig);
      results.push(chalk.green('  ✅ Windsurf') + chalk.dim(` (${windsurfConfigFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Windsurf: ') + (err as Error).message);
    }
  }

  // 9. Zed Editor Configuration
  if (targetClient === 'zed' || (targetClient === 'all' && detected.zed)) {
    try {
      const zedFile = getZedSettingsPath();
      upsertMcpEntry(zedFile, {
        command: {
          path: 'npx',
          args: ['-y', 'mgcheck', 'mcp'],
        },
      }, 'context_servers');
      results.push(chalk.green('  ✅ Zed Editor') + chalk.dim(` (${zedFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Zed Editor: ') + (err as Error).message);
    }
  }

  // 10. Goose (Block / Square)
  if (targetClient === 'goose' || (targetClient === 'all' && detected.goose)) {
    try {
      const gooseFile = getGooseConfigPath();
      const gooseDir = dirname(gooseFile);
      if (!existsSync(gooseDir)) mkdirSync(gooseDir, { recursive: true });
      const yamlContent = existsSync(gooseFile) ? readFileSync(gooseFile, 'utf-8') : '';
      if (!yamlContent.includes(MCP_KEY)) {
        const updated = addGooseExtension(yamlContent);
        backupOnce(gooseFile);
        writeFileSync(gooseFile, updated, 'utf-8');
        results.push(chalk.green('  ✅ Goose') + chalk.dim(` (${gooseFile})`));
      } else {
        results.push(chalk.green('  ✅ Goose') + chalk.dim(` (already configured in ${gooseFile})`));
      }
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Goose: ') + (err as Error).message);
    }
  }

  // 11. Aider (~/.aider.conf.yml)
  if (targetClient === 'aider' || (targetClient === 'all' && detected.aider)) {
    try {
      const aiderFile = join(os.homedir(), '.aider.conf.yml');
      const aiderContent = existsSync(aiderFile) ? readFileSync(aiderFile, 'utf-8') : '';
      const alreadyConfigured = aiderContent.includes('npx mgcheck analyze');
      if (/^lint-cmd:/m.test(aiderContent) && !alreadyConfigured) {
        results.push(chalk.yellow('  ⚠️  Aider: ') + `${aiderFile} already defines lint-cmd; add "npx mgcheck analyze" manually.`);
      } else if (!alreadyConfigured) {
        const snippet = `${BLOCK_START}\n# Migration Guardian Safety Linter\nlint-cmd: "npx mgcheck analyze"\n${BLOCK_END}\n`;
        const base = aiderContent.trimEnd();
        backupOnce(aiderFile);
        writeFileSync(aiderFile, base ? `${base}\n\n${snippet}` : snippet, 'utf-8');
        results.push(chalk.green('  ✅ Aider') + chalk.dim(` (${aiderFile})`));
      } else {
        results.push(chalk.green('  ✅ Aider') + chalk.dim(` (already configured in ${aiderFile})`));
      }
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Aider: ') + (err as Error).message);
    }
  }

  // 12. OpenHands
  if (targetClient === 'openhands' || targetClient === 'opendevin' || (targetClient === 'all' && detected.openhands)) {
    try {
      const openhandsDir = join(os.homedir(), '.openhands', 'microagents');
      if (!existsSync(openhandsDir)) mkdirSync(openhandsDir, { recursive: true });
      const openhandsFile = join(openhandsDir, 'migration-guardian.md');
      writeFileSync(openhandsFile, GUARDIAN_RULE_CONTENT, 'utf-8');
      results.push(chalk.green('  ✅ OpenHands') + chalk.dim(` (${openhandsFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  OpenHands: ') + (err as Error).message);
    }
  }

  // 13. Central Safety Rules (Saved once to ~/.mgcheck/rules.md — zero workspace clutter)
  try {
    const mgcheckDir = join(os.homedir(), '.mgcheck');
    if (!existsSync(mgcheckDir)) {
      mkdirSync(mgcheckDir, { recursive: true });
    }
    const rulesPath = join(mgcheckDir, 'rules.md');
    writeFileSync(rulesPath, GUARDIAN_RULE_CONTENT, 'utf-8');
    results.push(chalk.green('  ✅ Safety Rules Centralized') + chalk.dim(` (${rulesPath})`));
  } catch { /* skip */ }

  // 14. Project Local Storage & GitIgnore Setup (.mgcheck/ in project workspace)
  try {
    const projectMgcheck = join(workspaceDir, '.mgcheck');
    if (!existsSync(projectMgcheck)) {
      mkdirSync(projectMgcheck, { recursive: true });
    }
  } catch { /* skip */ }

  const gitIgnoreRes = ensureGitIgnore(workspaceDir);
  if (gitIgnoreRes?.updated) {
    results.push(chalk.green('  ✅ Added .mgcheck/ to .gitignore') + chalk.dim(` (${gitIgnoreRes.file})`));
  }

  // 15. Only inject workspace rule files if explicitly requested via options.withRules
  if (options.withRules) {
    const ruleResults = injectAgentRules(workspaceDir);
    results.push(...ruleResults);
  }

  return results;
}

/**
 * Ensures that .mgcheck/ is ignored by Git in the project workspace.
 * Adds .mgcheck/ to .gitignore if not already present.
 */
export function ensureGitIgnore(workspaceDir: string = process.cwd()): { updated: boolean; file: string } | null {
  try {
    const gitignorePath = join(workspaceDir, '.gitignore');
    const entryToIgnore = '.mgcheck/';

    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8');
      const lines = content.split('\n').map((l) => l.trim());
      const alreadyIgnored = lines.some((l) => l === '.mgcheck' || l === '.mgcheck/' || l === '/.mgcheck' || l === '/.mgcheck/');
      if (!alreadyIgnored) {
        const comment = '# Migration Guardian audit logs & temporary approvals';
        const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
        writeFileSync(gitignorePath, `${content}${separator}\n${comment}\n${entryToIgnore}\n`, 'utf-8');
        return { updated: true, file: gitignorePath };
      }
      return { updated: false, file: gitignorePath };
    } else {
      // Create .gitignore if project has .git or package.json
      if (existsSync(join(workspaceDir, '.git')) || existsSync(join(workspaceDir, 'package.json'))) {
        const comment = '# Migration Guardian audit logs & temporary approvals';
        writeFileSync(gitignorePath, `${comment}\n${entryToIgnore}\n`, 'utf-8');
        return { updated: true, file: gitignorePath };
      }
      return null;
    }
  } catch {
    return null;
  }
}

/** Command the pre-commit hook runs; also what Husky/Lefthook users add to their own hook. */
export const HOOK_COMMAND = 'npx --yes mgcheck hook run';

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).toString();
}

/**
 * Returns core.hooksPath if set (Husky, Lefthook, etc.). When it is set, Git
 * never runs scripts in .git/hooks.
 */
export function getHooksPath(workspaceDir: string = process.cwd()): string | null {
  try {
    return git('config --get core.hooksPath', workspaceDir).trim() || null;
  } catch {
    return null; // unset (git exits 1) or git unavailable
  }
}

/**
 * Absolute paths of staged (added/copied/modified) .sql files in the repo.
 */
export function getStagedMigrations(workspaceDir: string = process.cwd()): string[] {
  const root = git('rev-parse --show-toplevel', workspaceDir).trim();
  return git('diff --cached --name-only --diff-filter=ACM -z', workspaceDir)
    .split('\0')
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .map((f) => join(root, f))
    .filter((f) => existsSync(f));
}

/**
 * Installs Git pre-commit safety hook in workspace if .git directory exists.
 */
export function installGitHook(workspaceDir: string = process.cwd()): string | null {
  try {
    const gitDir = join(workspaceDir, '.git');
    if (!existsSync(gitDir)) {
      return null;
    }

    const hooksPath = getHooksPath(workspaceDir);
    if (hooksPath) {
      return chalk.yellow('  ⚠️  Git Hook not installed: ') +
        `this repo sets core.hooksPath (${hooksPath}), e.g. Husky or Lefthook, so Git ignores .git/hooks.\n` +
        chalk.white('     Add this line to your pre-commit hook instead:  ') + chalk.cyan(HOOK_COMMAND);
    }

    const hooksDir = join(gitDir, 'hooks');
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }

    const hookFile = join(hooksDir, 'pre-commit');
    const backupHook = join(hooksDir, 'pre-commit.mgcheck-backup');

    // Preserve an existing user hook; ours chains to it and uninstall restores it
    if (existsSync(hookFile) && !readFileSync(hookFile, 'utf-8').includes('Migration Guardian') && !existsSync(backupHook)) {
      renameSync(hookFile, backupHook);
    }

    const hookScript = `#!/bin/sh
# Migration Guardian Git Pre-Commit Safety Hook
# Blocks commits whose staged .sql migrations break a blocking safety rule.

# Skip the npx startup entirely when no SQL is staged
if git diff --cached --name-only --diff-filter=ACM | grep -qiE '\\.sql$'; then
  ${HOOK_COMMAND} || exit $?
fi

# Run the repository's original pre-commit hook, if one existed before install
ORIGINAL_HOOK="$(dirname "$0")/pre-commit.mgcheck-backup"
if [ -f "$ORIGINAL_HOOK" ]; then
  sh "$ORIGINAL_HOOK" "$@" || exit $?
fi
exit 0
`;

    writeFileSync(hookFile, hookScript, { encoding: 'utf-8', mode: 0o755 });
    return chalk.green('  ✅ Git Pre-Commit Hook') + chalk.dim(` (${hookFile})`);
  } catch (err) {
    return chalk.yellow('  ⚠️  Git Hook: ') + (err as Error).message;
  }
}

/**
 * Uninstalls Git pre-commit safety hook in workspace if present.
 */
export function uninstallGitHook(workspaceDir: string = process.cwd()): string | null {
  try {
    const gitDir = join(workspaceDir, '.git');
    if (!existsSync(gitDir)) {
      return null;
    }

    const hookFile = join(gitDir, 'hooks', 'pre-commit');
    if (!existsSync(hookFile)) {
      return null;
    }

    const content = readFileSync(hookFile, 'utf-8');
    if (content.includes('Migration Guardian')) {
      rmSync(hookFile, { force: true });
      const backupHook = join(gitDir, 'hooks', 'pre-commit.mgcheck-backup');
      if (existsSync(backupHook)) {
        renameSync(backupHook, hookFile);
        return chalk.green('  🗑️  Removed Git Pre-Commit Hook (restored your original hook)') + chalk.dim(` (${hookFile})`);
      }
      return chalk.green('  🗑️  Removed Git Pre-Commit Hook') + chalk.dim(` (${hookFile})`);
    }

    return null;
  } catch (err) {
    return chalk.yellow('  ⚠️  Git Hook: ') + (err as Error).message;
  }
}

const GUARDIAN_RULE_BANNER = '<!-- MIGRATION GUARDIAN SAFETY RULES -->';
const GUARDIAN_RULE_END = '<!-- /MIGRATION GUARDIAN SAFETY RULES -->';
const GUARDIAN_RULE_CONTENT = `${GUARDIAN_RULE_BANNER}
## Database Migration Safety (Enforced by Migration Guardian)

When creating, modifying, or executing database migrations (SQL, Prisma, Drizzle, TypeORM, Knex, etc.):
1. **NEVER execute raw DDL or database migrations directly** on databases without prior safety verification.
2. **Standard 3-Step AI Workflow**:
   - **Step 1 (Verify)**: Call \`check_migration\` (or \`analyze_migration\`) to test against the disposable shadow DB and AST safety rules.
   - **Step 2 (Prompt User)**: Once verified safe (0 blocking errors), ask the human user: *"Migration verified safe (0 errors). Would you like me to apply it to your database now?"*.
   - **Step 3 (Apply)**: When the user confirms "yes", call \`apply_migration\` with \`confirm_user_approved: true\` to execute the migration against their target database!
   - Always pass \`project_dir\` (the absolute path of the current workspace root) so the audit log is written to that project's \`.mgcheck/audit.jsonl\`.
3. **Follow Zero-Downtime Migration Standards**:
   - \`MG001\`: Always use \`CREATE INDEX CONCURRENTLY\` instead of blocking indexes.
   - \`MG002\`: Never use \`ALTER COLUMN TYPE\` directly (use expand/contract pattern).
   - \`MG003\`: Always provide a \`DEFAULT\` value when adding \`NOT NULL\` columns.
   - \`MG004\`: Add constraints with \`NOT VALID\`, then validate them in a subsequent step.
   - \`MG005\` / \`MG006\`: Never drop columns or tables without explicit user confirmation.
   - \`MG009\`: Always set \`SET lock_timeout = '5s';\` before risky DDL.
   - \`MG010\`: Provide a rollback / down migration file whenever applicable.
${GUARDIAN_RULE_END}
`;

/** Workspace rule files that `setup --with-rules` writes to. */
function getAgentRuleFiles(workspaceDir: string): { path: string; name: string; ownedFile?: boolean }[] {
  return [
    { path: join(workspaceDir, '.cursor', 'rules', 'migration-guardian.mdc'), name: 'Cursor Rule (.cursor/rules)', ownedFile: true },
    { path: join(workspaceDir, '.cursorrules'), name: 'Cursor Rules (.cursorrules)' },
    { path: join(workspaceDir, 'CLAUDE.md'), name: 'Claude Rules (CLAUDE.md)' },
    { path: join(workspaceDir, 'AGENTS.md'), name: 'Agent Rules (AGENTS.md)' },
    { path: join(workspaceDir, '.windsurfrules'), name: 'Windsurf Rules (.windsurfrules)' },
    { path: join(workspaceDir, '.github', 'copilot-instructions.md'), name: 'GitHub Copilot Instructions' },
  ];
}

/**
 * Append or create AI agent rule files (.cursorrules, CLAUDE.md, AGENTS.md, etc.)
 */
function appendOrWriteRule(filePath: string, name: string): string | null {
  try {
    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf-8');
      if (existing.includes(GUARDIAN_RULE_BANNER) || existing.includes('Migration Guardian')) {
        return null; // Already present
      }
      writeFileSync(filePath, `${existing.trimEnd()}\n\n${GUARDIAN_RULE_CONTENT}`, 'utf-8');
      return chalk.green(`  ✅ Updated ${name}`) + chalk.dim(` (${filePath})`);
    } else {
      writeFileSync(filePath, GUARDIAN_RULE_CONTENT, 'utf-8');
      return chalk.green(`  ✅ Created ${name}`) + chalk.dim(` (${filePath})`);
    }
  } catch (err) {
    return chalk.yellow(`  ⚠️  ${name}: `) + (err as Error).message;
  }
}

/**
 * Injects Migration Guardian safety rules into AI rule files across popular AI IDEs and agents.
 */
export function injectAgentRules(workspaceDir: string = process.cwd()): string[] {
  const results: string[] = [];
  for (const { path, name } of getAgentRuleFiles(workspaceDir)) {
    const res = appendOrWriteRule(path, name);
    if (res) results.push(res);
  }
  return results;
}

/**
 * Remove the Migration Guardian rules block from text. Uses the end marker when
 * present; older installs had no end marker, so cut through the last rule line (MG010).
 */
export function stripGuardianRules(content: string): string {
  const start = content.indexOf(GUARDIAN_RULE_BANNER);
  if (start === -1) return content;

  let end = content.indexOf(GUARDIAN_RULE_END, start);
  if (end !== -1) {
    end += GUARDIAN_RULE_END.length;
  } else {
    const lastRule = content.indexOf('`MG010`', start);
    if (lastRule === -1) return content;
    const eol = content.indexOf('\n', lastRule);
    end = eol === -1 ? content.length : eol;
  }

  const before = content.slice(0, start).trimEnd();
  const after = content.slice(end).replace(/^\s*\n/, '').trimEnd();
  return [before, after].filter(Boolean).join('\n\n');
}

/**
 * Removes injected Migration Guardian rule blocks from workspace AI rule files.
 * Files that contained nothing but our rules are deleted.
 */
export function removeAgentRules(workspaceDir: string = process.cwd()): string[] {
  const results: string[] = [];
  for (const { path, name, ownedFile } of getAgentRuleFiles(workspaceDir)) {
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, 'utf-8');
      if (!content.includes(GUARDIAN_RULE_BANNER)) continue;
      const remaining = stripGuardianRules(content);
      if (ownedFile || !remaining.trim()) {
        rmSync(path, { force: true });
        results.push(chalk.green(`  🗑️  Removed ${name}`) + chalk.dim(` (${path})`));
      } else {
        writeFileSync(path, remaining + '\n', 'utf-8');
        results.push(chalk.green(`  🗑️  Removed rules from ${name}`) + chalk.dim(` (${path})`));
      }
    } catch (err) {
      results.push(chalk.yellow(`  ⚠️  ${name}: `) + (err as Error).message);
    }
  }
  return results;
}

export interface ConnectionLocation {
  name: string;
  file: string;
}

function jsonHasEntry(file: string, key = 'mcpServers'): boolean {
  try {
    return Boolean(readJsonConfig(file)?.[key]?.[MCP_KEY]);
  } catch {
    return false;
  }
}

function textHas(file: string, needle: string): boolean {
  try {
    return existsSync(file) && readFileSync(file, 'utf-8').includes(needle);
  } catch {
    return false;
  }
}

/**
 * List every config file that still registers Migration Guardian.
 */
export function findConnections(workspaceDir: string = process.cwd()): ConnectionLocation[] {
  const home = os.homedir();
  const found: ConnectionLocation[] = [];
  const add = (name: string, file: string, present: boolean) => {
    if (present) found.push({ name, file });
  };

  const antigravity = join(home, '.gemini', 'config', 'mcp_config.json');
  add('Google Antigravity', antigravity, jsonHasEntry(antigravity));

  const cursorGlobal = join(home, '.cursor', 'mcp.json');
  add('Cursor IDE', cursorGlobal, jsonHasEntry(cursorGlobal));
  const cursorWorkspace = join(workspaceDir, '.cursor', 'mcp.json');
  add('Cursor IDE (Workspace)', cursorWorkspace, jsonHasEntry(cursorWorkspace));

  const claudeDesktop = getClaudeDesktopConfigPath();
  add('Claude Desktop', claudeDesktop, jsonHasEntry(claudeDesktop));

  const claudeCode = join(home, '.claude.json');
  let claudeCodePresent = false;
  try {
    const cfg = readJsonConfig(claudeCode);
    claudeCodePresent = Boolean(cfg.mcpServers?.[MCP_KEY]) ||
      Object.values(cfg.projects || {}).some((p: any) => p?.mcpServers?.[MCP_KEY]);
  } catch { /* skip */ }
  add('Claude Code CLI', claudeCode, claudeCodePresent);
  const claudeProjectMcp = join(workspaceDir, '.mcp.json');
  add('Claude Code (Project .mcp.json)', claudeProjectMcp, jsonHasEntry(claudeProjectMcp));

  const cline = getClineMcpPath();
  add('Cline (VS Code)', cline, jsonHasEntry(cline));

  const roo = getRooMcpPath();
  add('Roo Code (VS Code)', roo, jsonHasEntry(roo));
  const rooAlt = join(dirname(roo), 'roo_mcp_settings.json');
  add('Roo Code (Alternate)', rooAlt, jsonHasEntry(rooAlt));

  const cont = join(home, '.continue', 'config.json');
  add('Continue.dev', cont, jsonHasEntry(cont));

  const windsurf = join(home, '.codeium', 'windsurf', 'mcp_config.json');
  add('Windsurf', windsurf, jsonHasEntry(windsurf));

  const zed = getZedSettingsPath();
  add('Zed Editor', zed, jsonHasEntry(zed, 'context_servers'));

  const goose = getGooseConfigPath();
  add('Goose (Block)', goose, textHas(goose, MCP_KEY));

  const aider = join(home, '.aider.conf.yml');
  add('Aider', aider, textHas(aider, 'npx mgcheck analyze'));

  const openhands = join(home, '.openhands', 'microagents', 'migration-guardian.md');
  add('OpenHands', openhands, existsSync(openhands));

  return found;
}

/**
 * Verify that migration-guardian is present in each AI client's MCP config.
 * Returns human-readable status lines.
 */
export function verifyConnections(workspaceDir: string = process.cwd()): string[] {
  return findConnections(workspaceDir).map((c) => chalk.green(`  ✅ Connected to ${c.name}`));
}

/**
 * Remove Migration Guardian MCP configuration and hooks from specified clients.
 */
export function uninstallMcp(options: SetupOptions = {}): string[] {
  const targetClient = (options.client || 'all').toLowerCase();
  const workspaceDir = options.workspaceDir || process.cwd();
  const results: string[] = [];
  const is = (...names: string[]) => targetClient === 'all' || names.includes(targetClient);

  // Helper to remove the 'migration-guardian' key from a JSON/JSONC file
  const removeFromMcpJson = (filePath: string, clientName: string, key = 'mcpServers') => {
    if (!existsSync(filePath)) return;
    try {
      const config = readJsonConfig(filePath);
      if (config[key]?.[MCP_KEY]) {
        delete config[key][MCP_KEY];
        writeJsonConfig(filePath, config);
        results.push(chalk.green(`  🗑️  Removed from ${clientName}`) + chalk.dim(` (${filePath})`));
      }
    } catch (err) {
      results.push(chalk.yellow(`  ⚠️  ${clientName}: `) + (err as Error).message);
    }
  };

  // Helper to rewrite a text config through a cleaning function
  const cleanTextFile = (filePath: string, clientName: string, needle: string, clean: (content: string) => string) => {
    if (!existsSync(filePath)) return;
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (!content.includes(needle)) return;
      const cleaned = clean(content);
      if (cleaned === content) return;
      backupOnce(filePath);
      writeFileSync(filePath, cleaned, 'utf-8');
      results.push(chalk.green(`  🗑️  Removed from ${clientName}`) + chalk.dim(` (${filePath})`));
    } catch (err) {
      results.push(chalk.yellow(`  ⚠️  ${clientName}: `) + (err as Error).message);
    }
  };

  // 1. Google Antigravity
  if (is('antigravity', 'gemini')) {
    removeFromMcpJson(join(os.homedir(), '.gemini', 'config', 'mcp_config.json'), 'Google Antigravity');
  }

  // 2. Cursor IDE
  if (is('cursor')) {
    removeFromMcpJson(join(os.homedir(), '.cursor', 'mcp.json'), 'Cursor IDE (Global)');
    removeFromMcpJson(join(workspaceDir, '.cursor', 'mcp.json'), 'Cursor IDE (Workspace)');
  }

  // 3. Claude Desktop
  if (is('claude', 'claude-desktop')) {
    removeFromMcpJson(getClaudeDesktopConfigPath(), 'Claude Desktop');
  }

  // 4. Claude Code CLI — user scope, every per-project (local) scope, and project .mcp.json
  if (is('claude-code', 'claudecode')) {
    const p = join(os.homedir(), '.claude.json');
    if (existsSync(p)) {
      try {
        const config = readJsonConfig(p);
        let modified = false;
        if (config.mcpServers?.[MCP_KEY]) {
          delete config.mcpServers[MCP_KEY];
          modified = true;
        }
        for (const project of Object.values(config.projects || {}) as any[]) {
          if (project?.mcpServers?.[MCP_KEY]) {
            delete project.mcpServers[MCP_KEY];
            modified = true;
          }
        }
        if (modified) {
          writeJsonConfig(p, config);
          results.push(chalk.green('  🗑️  Removed from Claude Code CLI') + chalk.dim(` (${p})`));
        }
      } catch (err) {
        results.push(chalk.yellow('  ⚠️  Claude Code CLI: ') + (err as Error).message);
      }
    }
    removeFromMcpJson(join(workspaceDir, '.mcp.json'), 'Claude Code (Project .mcp.json)');
  }

  // 5. Cline
  if (is('cline')) {
    removeFromMcpJson(getClineMcpPath(), 'Cline');
  }

  // 6. Roo Code
  if (is('roo', 'roo-code', 'roocode')) {
    const p = getRooMcpPath();
    removeFromMcpJson(p, 'Roo Code');
    removeFromMcpJson(join(dirname(p), 'roo_mcp_settings.json'), 'Roo Code (Alternate)');
  }

  // 7. Continue.dev
  if (is('continue', 'continue-dev', 'continuedev')) {
    const p = join(os.homedir(), '.continue', 'config.json');
    if (existsSync(p)) {
      try {
        const config = readJsonConfig(p);
        let modified = false;
        if (config.mcpServers?.[MCP_KEY]) {
          delete config.mcpServers[MCP_KEY];
          modified = true;
        }
        if (Array.isArray(config.experimental?.modelContextProtocolServers)) {
          const originalLen = config.experimental.modelContextProtocolServers.length;
          config.experimental.modelContextProtocolServers = config.experimental.modelContextProtocolServers.filter(
            (s: any) => !s.transport?.args?.includes('mgcheck')
          );
          if (config.experimental.modelContextProtocolServers.length !== originalLen) {
            modified = true;
          }
        }
        if (modified) {
          writeJsonConfig(p, config);
          results.push(chalk.green('  🗑️  Removed from Continue.dev') + chalk.dim(` (${p})`));
        }
      } catch (err) {
        results.push(chalk.yellow('  ⚠️  Continue.dev: ') + (err as Error).message);
      }
    }
  }

  // 8. Windsurf
  if (is('windsurf', 'codeium')) {
    removeFromMcpJson(join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'), 'Windsurf');
  }

  // 9. Zed Editor
  if (is('zed')) {
    removeFromMcpJson(getZedSettingsPath(), 'Zed Editor', 'context_servers');
  }

  // 10. Goose
  if (is('goose')) {
    cleanTextFile(getGooseConfigPath(), 'Goose', MCP_KEY, removeGooseExtension);
  }

  // 11. Aider — remove only our marked block (or the exact legacy lines)
  if (is('aider')) {
    cleanTextFile(join(os.homedir(), '.aider.conf.yml'), 'Aider', 'npx mgcheck analyze', (content) => {
      const cleaned = removeMarkedBlock(content)
        .split('\n')
        .filter((line) => {
          const t = line.trim();
          return t !== '# Migration Guardian Safety Linter' && t !== 'lint-cmd: "npx mgcheck analyze"';
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return cleaned ? cleaned + '\n' : '';
    });
  }

  // 12. OpenHands
  if (is('openhands', 'opendevin')) {
    const p = join(os.homedir(), '.openhands', 'microagents', 'migration-guardian.md');
    if (existsSync(p)) {
      try {
        rmSync(p, { force: true });
        results.push(chalk.green('  🗑️  Removed OpenHands Microagent') + chalk.dim(` (${p})`));
      } catch (err) {
        results.push(chalk.yellow('  ⚠️  OpenHands: ') + (err as Error).message);
      }
    }
  }

  if (targetClient === 'all') {
    // 13. Git Pre-Commit Hook
    const hookResult = uninstallGitHook(workspaceDir);
    if (hookResult) results.push(hookResult);

    // 14. Workspace AI rule files (CLAUDE.md, AGENTS.md, .cursorrules, ...)
    results.push(...removeAgentRules(workspaceDir));

    // 15. Central safety rules (~/.mgcheck/rules.md)
    const rulesPath = join(os.homedir(), '.mgcheck', 'rules.md');
    if (existsSync(rulesPath)) {
      try {
        rmSync(rulesPath, { force: true });
        results.push(chalk.green('  🗑️  Removed Central Safety Rules') + chalk.dim(` (${rulesPath})`));
      } catch (err) {
        results.push(chalk.yellow('  ⚠️  Safety Rules: ') + (err as Error).message);
      }
    }

    // 16. Audit logs & .gitignore entry (only with --purge)
    if (options.purge) {
      results.push(...purgeStorage(workspaceDir));
    }
  }

  return results;
}

/**
 * Delete audit logs and IPC queues (~/.mgcheck and <project>/.mgcheck) and
 * remove the .mgcheck/ entry that setup added to .gitignore.
 */
function purgeStorage(workspaceDir: string): string[] {
  const results: string[] = [];
  for (const dir of [join(os.homedir(), '.mgcheck'), join(workspaceDir, '.mgcheck')]) {
    if (!existsSync(dir)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      results.push(chalk.green('  🗑️  Deleted audit logs') + chalk.dim(` (${dir})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Audit logs: ') + (err as Error).message);
    }
  }

  const gitignorePath = join(workspaceDir, '.gitignore');
  if (existsSync(gitignorePath)) {
    try {
      const content = readFileSync(gitignorePath, 'utf-8');
      const cleaned = content
        .split('\n')
        .filter((l) => {
          const t = l.trim();
          return t !== '# Migration Guardian audit logs & temporary approvals' &&
            !['.mgcheck', '.mgcheck/', '/.mgcheck', '/.mgcheck/'].includes(t);
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
      if (cleaned !== content.trimEnd()) {
        writeFileSync(gitignorePath, cleaned ? cleaned + '\n' : '', 'utf-8');
        results.push(chalk.green('  🗑️  Removed .mgcheck/ from .gitignore') + chalk.dim(` (${gitignorePath})`));
      }
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  .gitignore: ') + (err as Error).message);
    }
  }
  return results;
}

export { runInteractiveWizard, runUninstallWizard } from './terminal.js';

