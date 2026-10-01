import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import os from 'node:os';
import chalk from 'chalk';

export interface SetupOptions {
  client?: string;
  yes?: boolean;
  withRules?: boolean;
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
      const geminiConfigDir = join(os.homedir(), '.gemini', 'config');
      const mcpConfigFile = join(geminiConfigDir, 'mcp_config.json');

      if (!existsSync(geminiConfigDir)) {
        mkdirSync(geminiConfigDir, { recursive: true });
      }

      let config: any = { mcpServers: {} };
      if (existsSync(mcpConfigFile)) {
        try {
          config = JSON.parse(readFileSync(mcpConfigFile, 'utf-8'));
          if (!config.mcpServers) config.mcpServers = {};
        } catch {
          config = { mcpServers: {} };
        }
      }

      config.mcpServers['migration-guardian'] = mcpServerConfig;

      writeFileSync(mcpConfigFile, JSON.stringify(config, null, 2), 'utf-8');
      results.push(chalk.green('  ✅ Google Antigravity') + chalk.dim(` (${mcpConfigFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Google Antigravity: ') + (err as Error).message);
    }
  }

  // 2. Cursor Configuration (Global ~/.cursor/mcp.json — zero workspace clutter)
  if (targetClient === 'all' || targetClient === 'cursor') {
    try {
      const cursorDir = join(os.homedir(), '.cursor');
      const cursorFile = join(cursorDir, 'mcp.json');

      if (!existsSync(cursorDir)) {
        mkdirSync(cursorDir, { recursive: true });
      }

      let config: any = { mcpServers: {} };
      if (existsSync(cursorFile)) {
        try {
          config = JSON.parse(readFileSync(cursorFile, 'utf-8'));
          if (!config.mcpServers) config.mcpServers = {};
        } catch {
          config = { mcpServers: {} };
        }
      }

      config.mcpServers['migration-guardian'] = mcpServerConfig;

      writeFileSync(cursorFile, JSON.stringify(config, null, 2), 'utf-8');
      results.push(chalk.green('  ✅ Cursor IDE') + chalk.dim(` (${cursorFile})`));

      // If a local .cursor already exists in the workspace, also update it
      const localCursorFile = join(workspaceDir, '.cursor', 'mcp.json');
      if (existsSync(join(workspaceDir, '.cursor'))) {
        writeFileSync(localCursorFile, JSON.stringify(config, null, 2), 'utf-8');
      }
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Cursor IDE: ') + (err as Error).message);
    }
  }

  // 3. Claude Desktop Configuration
  if (targetClient === 'claude' || targetClient === 'claude-desktop' || (targetClient === 'all' && detected.claude)) {
    try {
      let claudeDir = '';
      if (process.platform === 'win32') {
        claudeDir = join(process.env.APPDATA || '', 'Claude');
      } else if (process.platform === 'darwin') {
        claudeDir = join(os.homedir(), 'Library', 'Application Support', 'Claude');
      } else {
        claudeDir = join(os.homedir(), '.config', 'Claude');
      }

      const claudeConfigFile = join(claudeDir, 'claude_desktop_config.json');

      if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
      let config: any = { mcpServers: {} };
      if (existsSync(claudeConfigFile)) {
        try {
          config = JSON.parse(readFileSync(claudeConfigFile, 'utf-8'));
          if (!config.mcpServers) config.mcpServers = {};
        } catch {
          config = { mcpServers: {} };
        }
      }

      config.mcpServers['migration-guardian'] = mcpServerConfig;

      writeFileSync(claudeConfigFile, JSON.stringify(config, null, 2), 'utf-8');
      results.push(chalk.green('  ✅ Claude Desktop') + chalk.dim(` (${claudeConfigFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Claude Desktop: ') + (err as Error).message);
    }
  }

  // 4. Claude Code CLI (~/.claude.json)
  if (targetClient === 'claude-code' || targetClient === 'claudecode' || (targetClient === 'all' && detected.claudeCode)) {
    try {
      const claudeCodeFile = join(os.homedir(), '.claude.json');
      let config: any = {};
      if (existsSync(claudeCodeFile)) {
        try {
          config = JSON.parse(readFileSync(claudeCodeFile, 'utf-8'));
        } catch {
          config = {};
        }
      }
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers['migration-guardian'] = mcpServerConfig;
      writeFileSync(claudeCodeFile, JSON.stringify(config, null, 2), 'utf-8');
      results.push(chalk.green('  ✅ Claude Code CLI') + chalk.dim(` (${claudeCodeFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Claude Code CLI: ') + (err as Error).message);
    }
  }

  // 5. Cline (VS Code Autonomous Coding Agent)
  if (targetClient === 'cline' || (targetClient === 'all' && detected.cline)) {
    try {
      const clineFile = getClineMcpPath();
      const clineDir = dirname(clineFile);
      if (!existsSync(clineDir)) mkdirSync(clineDir, { recursive: true });
      let config: any = { mcpServers: {} };
      if (existsSync(clineFile)) {
        try {
          config = JSON.parse(readFileSync(clineFile, 'utf-8'));
          if (!config.mcpServers) config.mcpServers = {};
        } catch {
          config = { mcpServers: {} };
        }
      }
      config.mcpServers['migration-guardian'] = mcpServerConfig;
      writeFileSync(clineFile, JSON.stringify(config, null, 2), 'utf-8');
      results.push(chalk.green('  ✅ Cline') + chalk.dim(` (${clineFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Cline: ') + (err as Error).message);
    }
  }

  // 6. Roo Code (VS Code Coding Agent)
  if (targetClient === 'roo' || targetClient === 'roo-code' || targetClient === 'roocode' || (targetClient === 'all' && detected.rooCode)) {
    try {
      const rooFile = getRooMcpPath();
      const rooDir = dirname(rooFile);
      if (!existsSync(rooDir)) mkdirSync(rooDir, { recursive: true });
      let config: any = { mcpServers: {} };
      if (existsSync(rooFile)) {
        try {
          config = JSON.parse(readFileSync(rooFile, 'utf-8'));
          if (!config.mcpServers) config.mcpServers = {};
        } catch {
          config = { mcpServers: {} };
        }
      }
      config.mcpServers['migration-guardian'] = mcpServerConfig;
      writeFileSync(rooFile, JSON.stringify(config, null, 2), 'utf-8');

      // Also mirror to roo_mcp_settings.json for multi-version Roo compatibility
      const rooAltFile = join(rooDir, 'roo_mcp_settings.json');
      writeFileSync(rooAltFile, JSON.stringify(config, null, 2), 'utf-8');

      results.push(chalk.green('  ✅ Roo Code') + chalk.dim(` (${rooFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Roo Code: ') + (err as Error).message);
    }
  }

  // 7. Continue.dev (~/.continue/config.json)
  if (targetClient === 'continue' || targetClient === 'continue-dev' || targetClient === 'continuedev' || (targetClient === 'all' && detected.continueDev)) {
    try {
      const contDir = join(os.homedir(), '.continue');
      if (!existsSync(contDir)) mkdirSync(contDir, { recursive: true });
      const contJson = join(contDir, 'config.json');
      let config: any = {};
      if (existsSync(contJson)) {
        try {
          config = JSON.parse(readFileSync(contJson, 'utf-8'));
        } catch {
          config = {};
        }
      }
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers['migration-guardian'] = mcpServerConfig;
      writeFileSync(contJson, JSON.stringify(config, null, 2), 'utf-8');
      results.push(chalk.green('  ✅ Continue.dev') + chalk.dim(` (${contJson})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Continue.dev: ') + (err as Error).message);
    }
  }

  // 8. Windsurf Configuration (~/.codeium/windsurf/mcp_config.json)
  if (targetClient === 'windsurf' || targetClient === 'codeium' || (targetClient === 'all' && detected.windsurf)) {
    try {
      const windsurfDir = join(os.homedir(), '.codeium', 'windsurf');
      const windsurfConfigFile = join(windsurfDir, 'mcp_config.json');

      if (!existsSync(windsurfDir)) mkdirSync(windsurfDir, { recursive: true });
      let config: any = { mcpServers: {} };
      if (existsSync(windsurfConfigFile)) {
        try {
          config = JSON.parse(readFileSync(windsurfConfigFile, 'utf-8'));
          if (!config.mcpServers) config.mcpServers = {};
        } catch {
          config = { mcpServers: {} };
        }
      }

      config.mcpServers['migration-guardian'] = mcpServerConfig;

      writeFileSync(windsurfConfigFile, JSON.stringify(config, null, 2), 'utf-8');
      results.push(chalk.green('  ✅ Windsurf') + chalk.dim(` (${windsurfConfigFile})`));
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Windsurf: ') + (err as Error).message);
    }
  }

  // 9. Zed Editor Configuration
  if (targetClient === 'zed' || (targetClient === 'all' && detected.zed)) {
    try {
      const zedFile = getZedSettingsPath();
      const zedDir = dirname(zedFile);
      if (!existsSync(zedDir)) mkdirSync(zedDir, { recursive: true });
      let config: any = {};
      if (existsSync(zedFile)) {
        try {
          config = JSON.parse(readFileSync(zedFile, 'utf-8'));
        } catch {
          config = {};
        }
      }
      if (!config.context_servers) config.context_servers = {};
      config.context_servers['migration-guardian'] = {
        command: {
          path: 'npx',
          args: ['-y', 'mgcheck', 'mcp'],
        },
      };
      writeFileSync(zedFile, JSON.stringify(config, null, 2), 'utf-8');
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
      if (!yamlContent.includes('migration-guardian')) {
        const gooseSnippet = `\nextensions:\n  migration-guardian:\n    name: migration-guardian\n    cmd: npx\n    args:\n      - -y\n      - mgcheck\n      - mcp\n    type: stdio\n    enabled: true\n`;
        writeFileSync(gooseFile, (yamlContent + gooseSnippet).trimStart(), 'utf-8');
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
      if (!aiderContent.includes('mgcheck')) {
        const snippet = `\n# Migration Guardian Safety Linter\nlint-cmd: "npx mgcheck analyze"\n`;
        writeFileSync(aiderFile, (aiderContent + snippet).trimStart(), 'utf-8');
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

  // 14. Only inject workspace rule files if explicitly requested via options.withRules
  if (options.withRules) {
    const ruleResults = injectAgentRules(workspaceDir);
    results.push(...ruleResults);
  }

  // 15. Install Git Pre-Commit Safety Hook if in a git repository
  const hookResult = installGitHook(workspaceDir);
  if (hookResult) results.push(hookResult);

  return results;
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

    const hooksDir = join(gitDir, 'hooks');
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }

    const hookFile = join(hooksDir, 'pre-commit');
    const hookScript = `#!/bin/sh
# Migration Guardian Git Pre-Commit Safety Hook
# Automatically blocks commits containing unsafe database migrations.

STAGED_MIGRATIONS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\\.(sql)$')

if [ -n "$STAGED_MIGRATIONS" ]; then
  echo "🛡️  Migration Guardian: Checking staged migrations for safety..."
  for file in $STAGED_MIGRATIONS; do
    if [ -f "$file" ]; then
      npx mgcheck run "$file" --provider pglite --ci
      EXIT_CODE=$?
      if [ $EXIT_CODE -ne 0 ]; then
        echo ""
        echo "❌ Migration Guardian: Commit rejected! Unsafe database migration detected in $file."
        echo "💡 Run 'npx mgcheck analyze $file' to see safe rewrite recommendations."
        echo ""
        exit $EXIT_CODE
      fi
    fi
  done
  echo "✅ Migration Guardian: All staged migrations verified safe."
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
      return chalk.green('  🗑️  Removed Git Pre-Commit Hook') + chalk.dim(` (${hookFile})`);
    }

    return null;
  } catch (err) {
    return chalk.yellow('  ⚠️  Git Hook: ') + (err as Error).message;
  }
}

const GUARDIAN_RULE_BANNER = '<!-- MIGRATION GUARDIAN SAFETY RULES -->';
const GUARDIAN_RULE_CONTENT = `${GUARDIAN_RULE_BANNER}
## Database Migration Safety (Enforced by Migration Guardian)

When creating, modifying, or executing database migrations (SQL, Prisma, Drizzle, TypeORM, Knex, etc.):
1. **NEVER execute raw DDL or database migrations directly** on databases without prior safety verification.
2. **Standard 3-Step AI Workflow**:
   - **Step 1 (Verify)**: Call \`check_migration\` (or \`analyze_migration\`) to test against the disposable shadow DB and AST safety rules.
   - **Step 2 (Prompt User)**: Once verified safe (0 blocking errors), ask the human user: *"Migration verified safe (0 errors). Would you like me to apply it to your database now?"*.
   - **Step 3 (Apply)**: When the user confirms "yes", call \`apply_migration\` with \`confirm_user_approved: true\` to execute the migration against their target database!
3. **Follow Zero-Downtime Migration Standards**:
   - \`MG001\`: Always use \`CREATE INDEX CONCURRENTLY\` instead of blocking indexes.
   - \`MG002\`: Never use \`ALTER COLUMN TYPE\` directly (use expand/contract pattern).
   - \`MG003\`: Always provide a \`DEFAULT\` value when adding \`NOT NULL\` columns.
   - \`MG004\`: Add constraints with \`NOT VALID\`, then validate them in a subsequent step.
   - \`MG005\` / \`MG006\`: Never drop columns or tables without explicit user confirmation.
   - \`MG009\`: Always set \`SET lock_timeout = '5s';\` before risky DDL.
   - \`MG010\`: Provide a rollback / down migration file whenever applicable.
`;

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

  // 1. Cursor IDE Rules (.cursor/rules/migration-guardian.mdc and .cursorrules)
  const cursorRuleFile = join(workspaceDir, '.cursor', 'rules', 'migration-guardian.mdc');
  const resCursorMdc = appendOrWriteRule(cursorRuleFile, 'Cursor Rule (.cursor/rules)');
  if (resCursorMdc) results.push(resCursorMdc);

  const cursorRulesLegacy = join(workspaceDir, '.cursorrules');
  const resCursorLegacy = appendOrWriteRule(cursorRulesLegacy, 'Cursor Rules (.cursorrules)');
  if (resCursorLegacy) results.push(resCursorLegacy);

  // 2. Claude Code / Claude Desktop Rules (CLAUDE.md)
  const claudeMd = join(workspaceDir, 'CLAUDE.md');
  const resClaude = appendOrWriteRule(claudeMd, 'Claude Rules (CLAUDE.md)');
  if (resClaude) results.push(resClaude);

  // 3. Antigravity & General Agent Rules (AGENTS.md)
  const agentsMd = join(workspaceDir, 'AGENTS.md');
  const resAgents = appendOrWriteRule(agentsMd, 'Agent Rules (AGENTS.md)');
  if (resAgents) results.push(resAgents);

  // 4. Windsurf Rules (.windsurfrules)
  const windsurfRules = join(workspaceDir, '.windsurfrules');
  const resWindsurf = appendOrWriteRule(windsurfRules, 'Windsurf Rules (.windsurfrules)');
  if (resWindsurf) results.push(resWindsurf);

  // 5. GitHub Copilot Instructions (.github/copilot-instructions.md)
  const copilotInstructions = join(workspaceDir, '.github', 'copilot-instructions.md');
  const resCopilot = appendOrWriteRule(copilotInstructions, 'GitHub Copilot Instructions');
  if (resCopilot) results.push(resCopilot);

  return results;
}

/**
 * Verify that migration-guardian is present in each AI client's MCP config.
 * Returns human-readable status lines.
 */
export function verifyConnections(): string[] {
  const lines: string[] = [];

  // 1. Antigravity
  const antigravityConfig = join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
  if (existsSync(antigravityConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(antigravityConfig, 'utf-8'));
      if (cfg?.mcpServers?.['migration-guardian']) {
        lines.push(chalk.green('  ✅ Connected to Google Antigravity'));
      }
    } catch { /* skip */ }
  }

  // 2. Cursor (check global ~/.cursor/mcp.json first, then workspace .cursor)
  const cursorGlobal = join(os.homedir(), '.cursor', 'mcp.json');
  const cursorWorkspace = join(process.cwd(), '.cursor', 'mcp.json');
  const cursorConfig = existsSync(cursorGlobal) ? cursorGlobal : cursorWorkspace;
  if (existsSync(cursorConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(cursorConfig, 'utf-8'));
      if (cfg?.mcpServers?.['migration-guardian']) {
        lines.push(chalk.green('  ✅ Connected to Cursor IDE'));
      }
    } catch { /* skip */ }
  }

  // 3. Claude Desktop
  let claudeConfig = '';
  if (process.platform === 'win32') {
    claudeConfig = join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
  } else if (process.platform === 'darwin') {
    claudeConfig = join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else {
    claudeConfig = join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
  }
  if (existsSync(claudeConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(claudeConfig, 'utf-8'));
      if (cfg?.mcpServers?.['migration-guardian']) {
        lines.push(chalk.green('  ✅ Connected to Claude Desktop'));
      }
    } catch { /* skip */ }
  }

  // 4. Claude Code CLI
  const claudeCodeConfig = join(os.homedir(), '.claude.json');
  if (existsSync(claudeCodeConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(claudeCodeConfig, 'utf-8'));
      if (cfg?.mcpServers?.['migration-guardian']) {
        lines.push(chalk.green('  ✅ Connected to Claude Code CLI'));
      }
    } catch { /* skip */ }
  }

  // 5. Cline
  const clineConfig = getClineMcpPath();
  if (existsSync(clineConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(clineConfig, 'utf-8'));
      if (cfg?.mcpServers?.['migration-guardian']) {
        lines.push(chalk.green('  ✅ Connected to Cline (VS Code)'));
      }
    } catch { /* skip */ }
  }

  // 6. Roo Code
  const rooConfig = getRooMcpPath();
  if (existsSync(rooConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(rooConfig, 'utf-8'));
      if (cfg?.mcpServers?.['migration-guardian']) {
        lines.push(chalk.green('  ✅ Connected to Roo Code (VS Code)'));
      }
    } catch { /* skip */ }
  }

  // 7. Continue.dev
  const contConfig = join(os.homedir(), '.continue', 'config.json');
  if (existsSync(contConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(contConfig, 'utf-8'));
      if (cfg?.mcpServers?.['migration-guardian']) {
        lines.push(chalk.green('  ✅ Connected to Continue.dev'));
      }
    } catch { /* skip */ }
  }

  // 8. Windsurf
  const windsurfConfig = join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
  if (existsSync(windsurfConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(windsurfConfig, 'utf-8'));
      if (cfg?.mcpServers?.['migration-guardian']) {
        lines.push(chalk.green('  ✅ Connected to Windsurf'));
      }
    } catch { /* skip */ }
  }

  // 9. Zed Editor
  const zedConfig = getZedSettingsPath();
  if (existsSync(zedConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(zedConfig, 'utf-8'));
      if (cfg?.context_servers?.['migration-guardian']) {
        lines.push(chalk.green('  ✅ Connected to Zed Editor'));
      }
    } catch { /* skip */ }
  }

  // 10. Goose
  const gooseConfig = getGooseConfigPath();
  if (existsSync(gooseConfig)) {
    try {
      const content = readFileSync(gooseConfig, 'utf-8');
      if (content.includes('migration-guardian')) {
        lines.push(chalk.green('  ✅ Connected to Goose (Block)'));
      }
    } catch { /* skip */ }
  }

  // 11. Aider
  const aiderConfig = join(os.homedir(), '.aider.conf.yml');
  if (existsSync(aiderConfig)) {
    try {
      const content = readFileSync(aiderConfig, 'utf-8');
      if (content.includes('mgcheck')) {
        lines.push(chalk.green('  ✅ Connected to Aider'));
      }
    } catch { /* skip */ }
  }

  // 12. OpenHands
  const openhandsConfig = join(os.homedir(), '.openhands', 'microagents', 'migration-guardian.md');
  if (existsSync(openhandsConfig)) {
    lines.push(chalk.green('  ✅ Connected to OpenHands'));
  }

  return lines;
}

/**
 * Interactive Wizard: Auto-detects clients, prompts the user, and connects.
 */
export async function runInteractiveWizard(options: SetupOptions = {}) {
  console.log('');
  console.log(chalk.bold.cyan('  🛡️  Migration Guardian') + chalk.dim(' (mgcheck) — Database Migration Safety'));
  console.log(chalk.dim('  Catch unsafe database migrations before they hit production.\n'));

  const detected = detectClients();
  const detectedList = detected.clients.filter((c) => c.detected).map((c) => c.name);

  if (detectedList.length > 0) {
    console.log(chalk.bold('  Detected AI Clients on your system:'));
    for (const client of detectedList) {
      console.log(`  ${chalk.cyan('•')} ${chalk.white(client)}`);
    }
    console.log('');
  } else {
    console.log(chalk.dim('  No AI editors detected. Configuring MCP integration anyway...\n'));
  }

  // Check if --yes was passed to bypass the prompt
  let shouldProceed = options.yes ?? false;

  if (!shouldProceed) {
    const promptText = detectedList.length > 0
      ? `  Connect Migration Guardian to ${detectedList.join(' & ')}? ${chalk.dim('[Y/n]')} `
      : `  Connect Migration Guardian to your AI agents? ${chalk.dim('[Y/n]')} `;

    const rl = readline.createInterface({ input, output });

    try {
      const answer = await rl.question(promptText);
      const trimmed = answer.trim().toLowerCase();
      shouldProceed = trimmed === '' || trimmed === 'y' || trimmed === 'yes';
    } finally {
      rl.close();
    }
  }

  if (!shouldProceed) {
    console.log(chalk.dim('\n  Setup skipped.'));
    console.log(chalk.white('  You can connect anytime by running: ') + chalk.cyan('npx mgcheck setup'));
    console.log(chalk.white('  Or run checks manually with: ') + chalk.cyan('npx mgcheck run <migration.sql>\n'));
    return;
  }

  console.log(chalk.dim('\n  Configuring MCP integrations...\n'));
  const results = setupMcp(options);

  for (const res of results) {
    console.log(res);
  }

  // ── Connection Verification ──────────────────────────────────────
  console.log('');
  console.log(chalk.bold('  🔗 Connection Status'));

  const verified = verifyConnections();
  if (verified.length === 0) {
    console.log(chalk.yellow('  ⚠  No active connections found. Run ') + chalk.cyan('mgcheck setup') + chalk.yellow(' to retry.'));
  } else {
    for (const v of verified) {
      console.log(v);
    }
  }

  console.log(chalk.bold.green('\n  🎉 Migration Guardian is ready!'));
  console.log(chalk.white('  Your AI assistant will now automatically check migrations before executing.\n'));
  console.log(chalk.dim('  Behavior:'));
  console.log(chalk.dim('  • 🔴 HIGH risk queries   → Auto-blocked (AI receives error)'));
  console.log(chalk.dim('  • 🟡 MEDIUM risk queries → You will be asked to approve/reject'));
  console.log(chalk.dim('  • 🟢 LOW risk queries    → You will be asked to approve/reject\n'));
  console.log(chalk.white('  Audit Log: ~/.mgcheck/audit.jsonl'));
  console.log(chalk.white('  View log anytime: mgcheck log\n'));

  // ── Enter Watch Mode ──────────────────────────────────────────────
  console.log(chalk.bold.cyan('  👁️  Guardian Active — Watching for AI migration activity...'));
  console.log(chalk.dim('  Press Ctrl+C to stop.\n'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────'));
  console.log('');

  const {
    watchPendingApprovals,
    formatAuditEntry,
    writeDecision,
    removePendingApproval,
    clearActivityLog,
    AUDIT_FILE,
  } = await import('../core/activity-log.js');
  const rl = readline.createInterface({ input, output });

  // Clear old log entries so they don't replay on startup
  clearActivityLog();

  const stopWatching = watchPendingApprovals(async (entry) => {
    console.log('');
    console.log(formatAuditEntry(entry));
    console.log('');

    // Prompt user for approval
    const riskColors: Record<string, (s: string) => string> = {
      high: chalk.red,
      medium: chalk.yellow,
      low: chalk.green,
    };
    const color = riskColors[entry.risk] || chalk.white;

    try {
      const answer = await rl.question(
        color(`  ➜ Allow this ${entry.risk.toUpperCase()} risk migration? `) +
        chalk.dim('[y/N] ')
      );
      const trimmed = answer.trim().toLowerCase();
      const approved = trimmed === 'y' || trimmed === 'yes';

      writeDecision(entry.id, approved);
      removePendingApproval(entry.id);

      if (approved) {
        console.log(chalk.green('  ✅ Approved — AI agent may proceed.\n'));
      } else {
        console.log(chalk.red('  ❌ Rejected — AI agent received error.\n'));
      }

      console.log(chalk.dim('  ─────────────────────────────────────────────────────────'));
      console.log('');
    } catch {
      // readline was closed (e.g. Ctrl+C during prompt)
      writeDecision(entry.id, false);
      removePendingApproval(entry.id);
    }
  });

  // Keep the process alive with an active interval timer
  const keepAlive = setInterval(() => {}, 1000 * 60 * 60);

  // Handle graceful shutdown on Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(keepAlive);
    stopWatching();
    rl.close();
    console.log(chalk.dim('\n  Migration Guardian stopped. Goodbye! 👋\n'));
    process.exit(0);
  });
}

/**
 * Remove Migration Guardian MCP configuration and hooks from specified clients.
 */
export function uninstallMcp(options: SetupOptions = {}): string[] {
  const targetClient = (options.client || 'all').toLowerCase();
  const workspaceDir = options.workspaceDir || process.cwd();
  const results: string[] = [];

  // Helper to remove 'migration-guardian' key from JSON file
  const removeFromMcpJson = (filePath: string, clientName: string, key = 'mcpServers') => {
    if (existsSync(filePath)) {
      try {
        const config = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (config[key] && config[key]['migration-guardian']) {
          delete config[key]['migration-guardian'];
          writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
          results.push(chalk.green(`  🗑️  Removed from ${clientName}`) + chalk.dim(` (${filePath})`));
        }
      } catch (err) {
        results.push(chalk.yellow(`  ⚠️  ${clientName}: `) + (err as Error).message);
      }
    }
  };

  // 1. Google Antigravity
  if (targetClient === 'all' || targetClient === 'antigravity' || targetClient === 'gemini') {
    const p = join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
    removeFromMcpJson(p, 'Google Antigravity');
  }

  // 2. Cursor IDE
  if (targetClient === 'all' || targetClient === 'cursor') {
    const globalP = join(os.homedir(), '.cursor', 'mcp.json');
    removeFromMcpJson(globalP, 'Cursor IDE (Global)');
    const localP = join(workspaceDir, '.cursor', 'mcp.json');
    removeFromMcpJson(localP, 'Cursor IDE (Workspace)');
  }

  // 3. Claude Desktop
  if (targetClient === 'all' || targetClient === 'claude' || targetClient === 'claude-desktop') {
    let claudeDir = '';
    if (process.platform === 'win32') {
      claudeDir = join(process.env.APPDATA || '', 'Claude');
    } else if (process.platform === 'darwin') {
      claudeDir = join(os.homedir(), 'Library', 'Application Support', 'Claude');
    } else {
      claudeDir = join(os.homedir(), '.config', 'Claude');
    }
    const claudeP = join(claudeDir, 'claude_desktop_config.json');
    removeFromMcpJson(claudeP, 'Claude Desktop');
  }

  // 4. Claude Code CLI
  if (targetClient === 'all' || targetClient === 'claude-code' || targetClient === 'claudecode') {
    const p = join(os.homedir(), '.claude.json');
    removeFromMcpJson(p, 'Claude Code CLI');
  }

  // 5. Cline
  if (targetClient === 'all' || targetClient === 'cline') {
    const p = getClineMcpPath();
    removeFromMcpJson(p, 'Cline');
  }

  // 6. Roo Code
  if (targetClient === 'all' || targetClient === 'roo' || targetClient === 'roo-code' || targetClient === 'roocode') {
    const p = getRooMcpPath();
    removeFromMcpJson(p, 'Roo Code');
    const altP = join(dirname(p), 'roo_mcp_settings.json');
    removeFromMcpJson(altP, 'Roo Code (Alternate)');
  }

  // 7. Continue.dev
  if (targetClient === 'all' || targetClient === 'continue' || targetClient === 'continue-dev' || targetClient === 'continuedev') {
    const p = join(os.homedir(), '.continue', 'config.json');
    if (existsSync(p)) {
      try {
        const config = JSON.parse(readFileSync(p, 'utf-8'));
        let modified = false;
        if (config.mcpServers?.['migration-guardian']) {
          delete config.mcpServers['migration-guardian'];
          modified = true;
        }
        if (config.experimental?.modelContextProtocolServers && Array.isArray(config.experimental.modelContextProtocolServers)) {
          const originalLen = config.experimental.modelContextProtocolServers.length;
          config.experimental.modelContextProtocolServers = config.experimental.modelContextProtocolServers.filter(
            (s: any) => !s.transport?.args?.includes('mgcheck')
          );
          if (config.experimental.modelContextProtocolServers.length !== originalLen) {
            modified = true;
          }
        }
        if (modified) {
          writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
          results.push(chalk.green('  🗑️  Removed from Continue.dev') + chalk.dim(` (${p})`));
        }
      } catch (err) {
        results.push(chalk.yellow('  ⚠️  Continue.dev: ') + (err as Error).message);
      }
    }
  }

  // 8. Windsurf
  if (targetClient === 'all' || targetClient === 'windsurf' || targetClient === 'codeium') {
    const p = join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
    removeFromMcpJson(p, 'Windsurf');
  }

  // 9. Zed Editor
  if (targetClient === 'all' || targetClient === 'zed') {
    const p = getZedSettingsPath();
    removeFromMcpJson(p, 'Zed Editor', 'context_servers');
  }

  // 10. Goose
  if (targetClient === 'all' || targetClient === 'goose') {
    const p = getGooseConfigPath();
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        if (content.includes('migration-guardian')) {
          const cleaned = content.replace(/extensions:\s*\n\s*migration-guardian:[\s\S]*?(?=\n\S|\n\n|$)/g, '')
                                .replace(/\s*migration-guardian:[\s\S]*?(?=\n\S|\n\n|$)/g, '');
          writeFileSync(p, cleaned.trim() + '\n', 'utf-8');
          results.push(chalk.green('  🗑️  Removed from Goose') + chalk.dim(` (${p})`));
        }
      } catch (err) {
        results.push(chalk.yellow('  ⚠️  Goose: ') + (err as Error).message);
      }
    }
  }

  // 11. Aider
  if (targetClient === 'all' || targetClient === 'aider') {
    const p = join(os.homedir(), '.aider.conf.yml');
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        if (content.includes('mgcheck')) {
          const cleaned = content
            .split('\n')
            .filter((line) => !line.includes('mgcheck') && !line.includes('Migration Guardian'))
            .join('\n');
          writeFileSync(p, cleaned.trim() + '\n', 'utf-8');
          results.push(chalk.green('  🗑️  Removed from Aider') + chalk.dim(` (${p})`));
        }
      } catch (err) {
        results.push(chalk.yellow('  ⚠️  Aider: ') + (err as Error).message);
      }
    }
  }

  // 12. OpenHands
  if (targetClient === 'all' || targetClient === 'openhands' || targetClient === 'opendevin') {
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

  // 13. Git Pre-Commit Hook
  if (targetClient === 'all') {
    const hookResult = uninstallGitHook(workspaceDir);
    if (hookResult) results.push(hookResult);
  }

  return results;
}

/**
 * Interactive Wizard: Uninstalls Migration Guardian from AI clients and hooks.
 */
export async function runUninstallWizard(options: SetupOptions = {}) {
  console.log('');
  console.log(chalk.bold.cyan('  🛡️  Migration Guardian') + chalk.dim(' (mgcheck) — Uninstall'));
  console.log(chalk.dim('  Safely remove Migration Guardian from AI agents and Git hooks.\n'));

  let shouldProceed = options.yes ?? false;

  if (!shouldProceed) {
    const promptText = `  Remove Migration Guardian MCP integrations and Git hooks? ${chalk.dim('[Y/n]')} `;
    const rl = readline.createInterface({ input, output });

    try {
      const answer = await rl.question(promptText);
      const trimmed = answer.trim().toLowerCase();
      shouldProceed = trimmed === '' || trimmed === 'y' || trimmed === 'yes';
    } finally {
      rl.close();
    }
  }

  if (!shouldProceed) {
    console.log(chalk.dim('\n  Uninstall cancelled.\n'));
    return;
  }

  console.log(chalk.dim('\n  Removing integrations...\n'));
  const results = uninstallMcp(options);

  if (results.length === 0) {
    console.log(chalk.dim('  No active Migration Guardian configurations were found to remove.\n'));
  } else {
    for (const res of results) {
      console.log(res);
    }
    console.log(chalk.bold.green('\n  ✨ Migration Guardian has been cleanly uninstalled.\n'));
  }
}

