import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import type { SetupOptions } from './index.js';
import type { AuditEntry } from '../core/activity-log.js';
import { detectClients, setupMcp, uninstallMcp, findConnections, CLIENT_FLAGS } from './index.js';

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
    console.log(chalk.yellow('  No supported AI agents detected on this machine.'));
    console.log(chalk.dim('  Connect one manually with: ') + chalk.cyan('npx mgcheck setup --client <name>') + chalk.dim(' (see --help for names)\n'));
  }

  // Check if --yes was passed to bypass the prompt
  let shouldProceed = options.yes ?? false;

  if (!shouldProceed) {
    const promptText = detectedList.length > 0
      ? `  Connect Migration Guardian to ${detectedList.length === 1 ? detectedList[0] : `these ${detectedList.length} agents`}? ${chalk.dim('[Y/n]')} `
      : `  Continue with safety rules and the activity watcher only? ${chalk.dim('[Y/n]')} `;

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

  // Split real connections from leftovers in configs of apps that aren't installed
  const targeted = (options.client || 'all').toLowerCase();
  const connections = findConnections(options.workspaceDir || process.cwd());
  const isWanted = (c: (typeof connections)[number]) => detected[c.client] || CLIENT_FLAGS[c.client] === targeted;
  const active = connections.filter(isWanted);
  const leftovers = connections.filter((c) => !isWanted(c));

  if (active.length === 0) {
    console.log(chalk.yellow('  ⚠  No active connections. Use ') + chalk.cyan('mgcheck setup --client <name>') + chalk.yellow(' to connect an agent.'));
  }
  for (const name of new Set(active.map((c) => c.name))) {
    console.log(chalk.green(`  ✅ Connected to ${name}`));
  }
  if (leftovers.length > 0) {
    console.log(chalk.yellow('\n  ⚠  Leftover config for apps that are not installed:'));
    for (const c of leftovers) {
      console.log(chalk.yellow(`     • ${c.name}`) + chalk.dim(`  →  mgcheck uninstall --client ${CLIENT_FLAGS[c.client]}`));
    }
  }

  console.log(chalk.bold.green('\n  🎉 Migration Guardian is ready!'));
  console.log(chalk.white('  Your AI assistant will now automatically check migrations before executing.\n'));
  console.log(chalk.dim('  Behavior:'));
  console.log(chalk.dim('  • 🔴 HIGH risk queries   → Blocked. Shown here; type "override" to allow one anyway'));
  console.log(chalk.dim('  • 🟡 MEDIUM risk queries → Shown here; approve or reject with y/N'));
  console.log(chalk.dim('  • 🟢 LOW risk queries    → Shown here; approve or reject with y/N'));
  console.log(chalk.dim('  • Keep this terminal open: without it, AI agents cannot get approval\n'));

  const {
    watchPendingApprovals,
    readPendingApprovals,
    startWatcherHeartbeat,
    writeDecision,
    removePendingApproval,
    clearActivityLog,
    getAuditFile,
    getGlobalLogDir,
    watchEvents,
    formatAuditEntry,
  } = await import('../core/activity-log.js');

  // Approval requests from every project/editor flow through the global ~/.mgcheck queue
  const ipcDir = getGlobalLogDir();

  const auditPath = getAuditFile(options.workspaceDir || process.cwd());
  console.log(chalk.white(`  Audit Log: ${auditPath}`) + chalk.dim(' (each project logs to its own .mgcheck/audit.jsonl)'));
  console.log(chalk.white('  View log anytime: mgcheck log\n'));

  // ── Enter Watch Mode ──────────────────────────────────────────────
  console.log(chalk.bold.cyan('  👁️  Guardian Active — Watching for AI migration activity...'));
  console.log(chalk.dim('  Press Ctrl+C to stop.\n'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────'));
  console.log('');

  const rl = readline.createInterface({ input, output });

  // Tell MCP tools a human is here to answer approval requests
  const stopHeartbeat = startWatcherHeartbeat(ipcDir);
  process.on('exit', stopHeartbeat);

  // Clear old log entries so they don't replay on startup
  clearActivityLog();

  // Show every check that finishes without needing a decision here
  // (auto-blocked MCP calls, CLI and git-hook runs) as it happens
  const stopEvents = watchEvents((entry) => {
    const source = entry.project ? `${entry.tool} · ${entry.project}` : entry.tool;
    console.log(chalk.dim(`  via ${source}`));
    console.log(formatAuditEntry(entry));
    console.log('');
  }, ipcDir);

  // Requests are answered one at a time, so prompts never overlap
  let queue: Promise<void> = Promise.resolve();
  const stopWatching = watchPendingApprovals((entry) => {
    queue = queue
      .then(() => reviewRequest(entry))
      .catch((err) => console.error(chalk.red(`  ⚠  Could not show request ${entry.id}: ${(err as Error).message}`)));
  }, ipcDir);

  async function reviewRequest(entry: AuditEntry): Promise<void> {
    // The agent stops waiting after 2 minutes; skip requests that expired in the queue
    if (!readPendingApprovals(ipcDir).some((p) => p.id === entry.id)) {
      console.log(chalk.dim(`  (request ${entry.id} expired before it could be reviewed)\n`));
      return;
    }

    // ── Rich Human-Readable Audit Display ──────────────────────
    const riskColors: Record<string, (s: string) => string> = {
      high: chalk.red,
      medium: chalk.yellow,
      low: chalk.green,
    };
    const riskEmoji: Record<string, string> = {
      high: '🔴',
      medium: '🟡',
      low: '🟢',
    };
    const riskExplanation: Record<string, string> = {
      high: 'Contains blocking errors — stays blocked unless you type "override"',
      medium: 'Contains warnings — review carefully before approving',
      low: 'No violations found — looks safe',
    };
    const color = riskColors[entry.risk] || chalk.white;
    const emoji = riskEmoji[entry.risk] || '⚪';

    console.log('');
    console.log(chalk.bold.cyan('  ┌─────────────────────────────────────────────────────────┐'));
    console.log(chalk.bold.cyan('  │') + chalk.bold('  📋 MIGRATION INTERCEPTED                               ') + chalk.bold.cyan('│'));
    console.log(chalk.bold.cyan('  └─────────────────────────────────────────────────────────┘'));
    console.log('');

    // ── Header: Timestamp, Tool, ID ────────────────────────────
    const ts = new Date(entry.timestamp);
    const timeStr = ts.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = ts.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

    console.log(chalk.dim('  ┌── Details ──────────────────────────────────────────────'));
    console.log(chalk.dim('  │'));
    console.log(chalk.dim('  │  ') + chalk.white('Timestamp  : ') + chalk.cyan(`${dateStr}, ${timeStr}`));
    console.log(chalk.dim('  │  ') + chalk.white('Audit ID   : ') + chalk.dim(entry.id));
    if (entry.project) {
      console.log(chalk.dim('  │  ') + chalk.white('Project    : ') + chalk.cyan(entry.project));
    }
    console.log(chalk.dim('  │  ') + chalk.white('Risk Level : ') + color(`${emoji} ${entry.risk.toUpperCase()}`));
    console.log(chalk.dim('  │  ') + chalk.dim(`             ${riskExplanation[entry.risk] || ''}`));
    console.log(chalk.dim('  │'));

    // ── SQL Query (full, with line numbers) ─────────────────────
    console.log(chalk.dim('  ├── SQL Query ────────────────────────────────────────────'));
    console.log(chalk.dim('  │'));

    const queryLines = entry.query.split('\n');
    const maxLineNumWidth = String(queryLines.length).length;

    for (let i = 0; i < queryLines.length; i++) {
      const lineNum = String(i + 1).padStart(maxLineNumWidth, ' ');
      const lineContent = queryLines[i];

      // Highlight lines that have violations
      const violationsOnLine = entry.violations.filter((v) => v.line === i + 1);
      if (violationsOnLine.length > 0) {
        console.log(chalk.dim('  │  ') + chalk.red(`${lineNum} │ `) + chalk.red.bold(lineContent));
      } else {
        console.log(chalk.dim('  │  ') + chalk.dim(`${lineNum} │ `) + chalk.white(lineContent));
      }
    }
    console.log(chalk.dim('  │'));

    // ── Violations ──────────────────────────────────────────────
    if (entry.violations.length > 0) {
      console.log(chalk.dim('  ├── Violations ──────────────────────────────────────────'));
      console.log(chalk.dim('  │'));

      for (const v of entry.violations) {
        const sevIcon = v.severity === 'error' ? chalk.red.bold('✗ ERROR  ') : chalk.yellow.bold('⚠ WARNING');
        const lineInfo = v.line != null ? chalk.dim(` (line ${v.line})`) : '';
        console.log(chalk.dim('  │  ') + sevIcon + chalk.dim(` [${v.ruleId}]`) + lineInfo);
        console.log(chalk.dim('  │    ') + chalk.white(v.message));
        console.log(chalk.dim('  │'));
      }
    } else {
      console.log(chalk.dim('  ├── Violations ──────────────────────────────────────────'));
      console.log(chalk.dim('  │'));
      console.log(chalk.dim('  │  ') + chalk.green('  No violations detected'));
      console.log(chalk.dim('  │'));
    }

    // ── Summary Counts ──────────────────────────────────────────
    console.log(chalk.dim('  ├── Summary ─────────────────────────────────────────────'));
    console.log(chalk.dim('  │'));
    const errStr = entry.errorCount > 0
      ? chalk.red.bold(`${entry.errorCount} error${entry.errorCount !== 1 ? 's' : ''}`)
      : chalk.green('0 errors');
    const warnStr = entry.warningCount > 0
      ? chalk.yellow.bold(`${entry.warningCount} warning${entry.warningCount !== 1 ? 's' : ''}`)
      : chalk.green('0 warnings');
    console.log(chalk.dim('  │  ') + errStr + chalk.dim('  ·  ') + warnStr);
    console.log(chalk.dim('  │'));
    console.log(chalk.dim('  └────────────────────────────────────────────────────────'));
    console.log('');

    // ── Prompt for Decision ─────────────────────────────────────
    // 🔴 HIGH needs a typed word so a stray "y" or Enter can never let it through
    const isHigh = entry.risk === 'high';
    try {
      const answer = isHigh
        ? await rl.question(
            chalk.red.bold('  🔴 BLOCKED as HIGH risk. ') +
            chalk.white('Type ') + chalk.red.bold('override') +
            chalk.white(' to allow it anyway, or press Enter to keep it blocked: ')
          )
        : await rl.question(
            color(`  ➜ Allow this ${entry.risk.toUpperCase()} risk migration? `) +
            chalk.dim('[y/N] ')
          );
      const trimmed = answer.trim().toLowerCase();
      const approved = isHigh ? trimmed === 'override' : trimmed === 'y' || trimmed === 'yes';

      writeDecision(entry.id, approved, ipcDir);
      removePendingApproval(entry.id, ipcDir);

      if (isHigh) {
        console.log(approved
          ? chalk.magenta.bold('  ⚠️  Overridden — you allowed a HIGH risk migration. The AI agent may proceed.\n')
          : chalk.red('  🛑 Kept blocked — the AI agent was told to fix the violations.\n'));
      } else if (approved) {
        console.log(chalk.green('  ✅ Approved — AI agent may proceed.\n'));
      } else {
        console.log(chalk.red('  ❌ Rejected — AI agent received error.\n'));
      }

      console.log(chalk.dim('  ─────────────────────────────────────────────────────────'));
      console.log('');
    } catch {
      // readline was closed (e.g. Ctrl+C during prompt)
      writeDecision(entry.id, false, ipcDir);
      removePendingApproval(entry.id, ipcDir);
    }
  }

  // Keep the process alive with an active interval timer
  const keepAlive = setInterval(() => {}, 1000 * 60 * 60);

  // Handle graceful shutdown on Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(keepAlive);
    stopWatching();
    stopEvents();
    stopHeartbeat();
    rl.close();
    console.log(chalk.dim('\n  Migration Guardian stopped. Goodbye! 👋\n'));
    process.exit(0);
  });
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
    console.log(chalk.dim('  No active Migration Guardian configurations were found to remove.'));
  } else {
    for (const res of results) {
      console.log(res);
    }
  }

  // ── Verify nothing is left behind ─────────────────────────────────
  const remaining = (options.client || 'all').toLowerCase() === 'all'
    ? findConnections(options.workspaceDir || process.cwd())
    : [];
  if (remaining.length > 0) {
    console.log(chalk.yellow('\n  ⚠  Migration Guardian is still configured in:'));
    for (const r of remaining) {
      console.log(chalk.yellow(`     • ${r.name}`) + chalk.dim(` (${r.file})`));
    }
    console.log(chalk.dim('     Close the editor that owns the file and run `mgcheck uninstall` again, or remove the "migration-guardian" entry by hand.'));
  } else if (results.length > 0) {
    console.log(chalk.bold.green('\n  ✨ Migration Guardian has been cleanly uninstalled.'));
  }

  console.log(chalk.dim('\n  • Restart your editors/agents to stop any MCP server that is still running.'));
  console.log(chalk.dim('  • mgcheck runs via npx, so there is no package to remove (if you ran `npm i -g mgcheck`: `npm uninstall -g mgcheck`).'));
  if (!options.purge) {
    console.log(chalk.dim('  • Audit logs in .mgcheck/ were kept. Use `mgcheck uninstall --purge` to delete them too.'));
  }
  console.log('');
}
