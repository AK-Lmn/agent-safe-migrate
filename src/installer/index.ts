import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import os from 'node:os';
import chalk from 'chalk';

export interface SetupOptions {
  client?: 'antigravity' | 'claude' | 'cursor' | 'all';
  yes?: boolean;
}

export interface DetectResult {
  antigravity: boolean;
  cursor: boolean;
  claude: boolean;
  hasAny: boolean;
}

/**
 * Detect which AI editors/clients are installed on the user's system or workspace.
 */
export function detectClients(): DetectResult {
  // 1. Antigravity check
  const geminiDir = join(os.homedir(), '.gemini');
  const antigravity = existsSync(geminiDir);

  // 2. Cursor check (local .cursor or system Cursor install)
  const localCursor = existsSync(join(process.cwd(), '.cursor'));
  let systemCursor = false;
  if (process.platform === 'win32') {
    systemCursor = existsSync(join(process.env.APPDATA || '', 'Cursor')) ||
                   existsSync(join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor'));
  } else if (process.platform === 'darwin') {
    systemCursor = existsSync('/Applications/Cursor.app') ||
                   existsSync(join(os.homedir(), 'Applications', 'Cursor.app'));
  } else {
    systemCursor = existsSync(join(os.homedir(), '.config', 'Cursor'));
  }
  const cursor = localCursor || systemCursor;

  // 3. Claude Desktop check
  let claudeDir = '';
  if (process.platform === 'win32') {
    claudeDir = join(process.env.APPDATA || '', 'Claude');
  } else if (process.platform === 'darwin') {
    claudeDir = join(os.homedir(), 'Library', 'Application Support', 'Claude');
  } else {
    claudeDir = join(os.homedir(), '.config', 'Claude');
  }
  const claude = existsSync(claudeDir);

  return {
    antigravity,
    cursor,
    claude,
    hasAny: antigravity || cursor || claude,
  };
}

/**
 * Apply the MCP server configuration to the specified clients.
 */
export function setupMcp(options: SetupOptions = {}): string[] {
  const targetClient = options.client || 'all';
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const serverPath = resolve(currentDir, './mcp/server.js');
  const fallbackPath = resolve(currentDir, '../dist/mcp/server.js');
  const finalServerPath = existsSync(serverPath) ? serverPath : fallbackPath;
  const results: string[] = [];

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

      config.mcpServers['migration-guardian'] = {
        command: 'node',
        args: [finalServerPath],
      };

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

      config.mcpServers['migration-guardian'] = {
        command: 'node',
        args: [finalServerPath],
      };

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

        config.mcpServers['migration-guardian'] = {
          command: 'node',
          args: [finalServerPath],
        };

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

  return results;
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
  const detectedList: string[] = [];

  if (detected.antigravity) detectedList.push('Google Antigravity');
  if (detected.cursor) detectedList.push('Cursor IDE');
  if (detected.claude) detectedList.push('Claude Desktop');

  if (detectedList.length > 0) {
    console.log(chalk.bold('  Detected AI Clients on your system:'));
    for (const client of detectedList) {
      console.log(`  ${chalk.cyan('•')} ${chalk.white(client)}`);
    }
    console.log('');
  } else {
    console.log(chalk.dim('  Configuring MCP integration for your AI editors (Antigravity, Cursor, Claude)...\n'));
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
  console.log(chalk.dim('  Tools available to your AI:'));
  console.log(chalk.dim('  • check_migration  — shadow database execution + 10 AST safety rules'));
  console.log(chalk.dim('  • analyze_migration — fast static SQL linting\n'));
  console.log(chalk.dim('  Manual CLI Commands:'));
  console.log(chalk.dim('  • mgcheck run <path>      — analyze + shadow DB execution'));
  console.log(chalk.dim('  • mgcheck analyze <path>  — static analysis only\n'));

  // ── Enter Watch Mode ──────────────────────────────────────────────
  console.log(chalk.bold.cyan('  👁️  Watch Mode — Listening for AI migration activity...'));
  console.log(chalk.dim('  Press Ctrl+C to stop.\n'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────'));
  console.log('');

  const { watchActivityLog, formatActivityEntry, clearActivityLog } = await import('../core/activity-log.js');

  // Clear old log entries so they don't replay on startup (ensures directory exists)
  clearActivityLog();

  const stopWatching = watchActivityLog((entry) => {
    console.log(formatActivityEntry(entry));
    console.log('');
  });

  // Keep the process alive with an active interval timer
  const keepAlive = setInterval(() => {}, 1000 * 60 * 60);

  // Handle graceful shutdown on Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(keepAlive);
    stopWatching();
    console.log(chalk.dim('\n  Migration Guardian stopped. Goodbye! 👋\n'));
    process.exit(0);
  });
}

