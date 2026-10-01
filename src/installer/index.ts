import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import os from 'node:os';
import chalk from 'chalk';

export interface SetupOptions {
  client?: 'antigravity' | 'claude' | 'cursor' | 'windsurf' | 'vscode' | 'all';
  yes?: boolean;
}

export interface DetectedClient {
  name: string;
  detected: boolean;
}

export interface DetectResult {
  antigravity: boolean;
  cursor: boolean;
  claude: boolean;
  windsurf: boolean;
  vscode: boolean;
  clients: DetectedClient[];
  hasAny: boolean;
}

/**
 * Detect which AI editors/clients are actually installed on the user's system.
 *
 * Uses strict OS-level application checks (installed executables, app bundles)
 * to avoid false positives from workspace config folders or unrelated CLI tools.
 */
export function detectClients(): DetectResult {
  const home = os.homedir();

  // ── 1. Google Antigravity ──────────────────────────────────────────
  const geminiDir = join(home, '.gemini');
  const antigravity = Boolean(
    existsSync(join(geminiDir, 'antigravity-ide')) ||
    process.env.ANTIGRAVITY_APP_DIR ||
    process.env.ANTIGRAVITY_IDE
  );

  // ── 2. Cursor IDE ─────────────────────────────────────────────────
  let cursor = false;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || '';
    cursor = existsSync(join(localAppData, 'Programs', 'cursor', 'Cursor.exe')) ||
             existsSync(join(programFiles, 'Cursor', 'Cursor.exe'));
  } else if (process.platform === 'darwin') {
    cursor = existsSync('/Applications/Cursor.app') ||
             existsSync(join(home, 'Applications', 'Cursor.app'));
  } else {
    cursor = existsSync('/opt/Cursor/cursor') ||
             existsSync(join(home, '.config', 'Cursor'));
  }

  // ── 3. Claude Desktop (GUI app, NOT the Claude Code CLI) ──────────
  let claude = false;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    // Claude Desktop installs to AppData\Local\Programs\claude
    claude = existsSync(join(localAppData, 'Programs', 'claude', 'Claude.exe')) ||
             existsSync(join(localAppData, 'AnthropicClaude', 'Claude.exe'));
  } else if (process.platform === 'darwin') {
    claude = existsSync('/Applications/Claude.app') ||
             existsSync(join(home, 'Applications', 'Claude.app'));
  } else {
    // On Linux, Claude Desktop stores config here when installed
    const claudeConfig = join(home, '.config', 'Claude', 'claude_desktop_config.json');
    claude = existsSync(claudeConfig);
  }

  // ── 4. Windsurf (by Codeium) ──────────────────────────────────────
  let windsurf = false;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    windsurf = existsSync(join(localAppData, 'Programs', 'windsurf', 'Windsurf.exe')) ||
               existsSync(join(localAppData, 'Windsurf'));
  } else if (process.platform === 'darwin') {
    windsurf = existsSync('/Applications/Windsurf.app') ||
               existsSync(join(home, 'Applications', 'Windsurf.app'));
  } else {
    windsurf = existsSync(join(home, '.config', 'Windsurf'));
  }

  // ── 5. VS Code + GitHub Copilot ───────────────────────────────────
  let vscode = false;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || '';
    const vsCodeInstalled = existsSync(join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe')) ||
                            existsSync(join(programFiles, 'Microsoft VS Code', 'Code.exe'));
    // Check if Copilot extension is installed
    const copilotExt = existsSync(join(home, '.vscode', 'extensions')) &&
      existsSync(join(home, '.vscode', 'extensions'))
      ? readdirSync(join(home, '.vscode', 'extensions')).some((d) => d.startsWith('github.copilot'))
      : false;
    vscode = vsCodeInstalled && copilotExt;
  } else if (process.platform === 'darwin') {
    const vsCodeInstalled = existsSync('/Applications/Visual Studio Code.app');
    const copilotExt = existsSync(join(home, '.vscode', 'extensions')) &&
      readdirSync(join(home, '.vscode', 'extensions')).some((d) => d.startsWith('github.copilot'));
    vscode = vsCodeInstalled && copilotExt;
  } else {
    const vsCodeInstalled = existsSync(join(home, '.config', 'Code'));
    const copilotExt = existsSync(join(home, '.vscode', 'extensions')) &&
      readdirSync(join(home, '.vscode', 'extensions')).some((d) => d.startsWith('github.copilot'));
    vscode = vsCodeInstalled && copilotExt;
  }

  // ── Build client list ─────────────────────────────────────────────
  const clients: DetectedClient[] = [
    { name: 'Google Antigravity', detected: antigravity },
    { name: 'Cursor IDE', detected: cursor },
    { name: 'Claude Desktop', detected: claude },
    { name: 'Windsurf (Codeium)', detected: windsurf },
    { name: 'VS Code + Copilot', detected: vscode },
  ];

  return {
    antigravity,
    cursor,
    claude,
    windsurf,
    vscode,
    clients,
    hasAny: clients.some((c) => c.detected),
  };
}

/**
 * Apply the MCP server configuration to the specified clients.
 */
export function setupMcp(options: SetupOptions = {}): string[] {
  const targetClient = options.client || 'all';
  const results: string[] = [];

  // Generalized, portable MCP command that runs on any machine / OS
  const mcpServerConfig = {
    command: 'npx',
    args: ['-y', 'mgcheck', 'mcp'],
  };

  // 1. Antigravity Configuration (~/.gemini/config/mcp_config.json)
  if (targetClient === 'all' || targetClient === 'antigravity') {
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

  // 2. Cursor Configuration (.cursor/mcp.json in workspace)
  if (targetClient === 'all' || targetClient === 'cursor') {
    try {
      const cursorDir = join(process.cwd(), '.cursor');
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
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Cursor IDE: ') + (err as Error).message);
    }
  }

  // 3. Claude Desktop Configuration
  if (targetClient === 'all' || targetClient === 'claude') {
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

      if (existsSync(claudeDir)) {
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
      } else if (targetClient === 'claude') {
        results.push(chalk.dim('  ℹ️  Claude Desktop not installed (skipped)'));
      }
    } catch (err) {
      results.push(chalk.yellow('  ⚠️  Claude Desktop: ') + (err as Error).message);
    }
  }

  // 4. Inject Agent Rule Files into current workspace
  const ruleResults = injectAgentRules(process.cwd());
  results.push(...ruleResults);

  // 5. Install Git Pre-Commit Safety Hook if in a git repository
  const hookResult = installGitHook(process.cwd());
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

const GUARDIAN_RULE_BANNER = '<!-- MIGRATION GUARDIAN SAFETY RULES -->';
const GUARDIAN_RULE_CONTENT = `${GUARDIAN_RULE_BANNER}
## Database Migration Safety (Enforced by Migration Guardian)

When creating, modifying, or executing database migrations (SQL, Prisma, Drizzle, TypeORM, Knex, etc.):
1. **NEVER execute raw DDL or database migrations directly** on databases without prior safety verification.
2. **Standard 3-Step AI Workflow**:
   - **Step 1 (Verify)**: Call \\\`check_migration\\\` (or \\\`analyze_migration\\\`) to test against the disposable shadow DB and AST safety rules.
   - **Step 2 (Prompt User)**: Once verified safe (0 blocking errors), ask the human user: *"Migration verified safe (0 errors). Would you like me to apply it to your database now?"*.
   - **Step 3 (Apply)**: When the user confirms "yes", call \\\`apply_migration\\\` with \\\`confirm_user_approved: true\\\` to execute the migration against their target database!
3. **Follow Zero-Downtime Migration Standards**:
   - \\\`MG001\\\`: Always use \\\`CREATE INDEX CONCURRENTLY\\\` instead of blocking indexes.
   - \\\`MG002\\\`: Never use \\\`ALTER COLUMN TYPE\\\` directly (use expand/contract pattern).
   - \\\`MG003\\\`: Always provide a \\\`DEFAULT\\\` value when adding \\\`NOT NULL\\\` columns.
   - \\\`MG004\\\`: Add constraints with \\\`NOT VALID\\\`, then validate them in a subsequent step.
   - \\\`MG005\\\` / \\\`MG006\\\`: Never drop columns or tables without explicit user confirmation.
   - \\\`MG009\\\`: Always set \\\`SET lock_timeout = '5s';\\\` before risky DDL.
   - \\\`MG010\\\`: Provide a rollback / down migration file whenever applicable.
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

  // 2. Cursor
  const cursorConfig = join(process.cwd(), '.cursor', 'mcp.json');
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

