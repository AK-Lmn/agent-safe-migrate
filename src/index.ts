/**
 * Migration Guardian (mgcheck) — Library Entry Point
 *
 * Exports the core engine and all components for programmatic use.
 */

// Core
export { runCheck } from './core/engine.js';
export { loadConfig, getRuleSeverity } from './core/config.js';
export { applyToRealDatabase, promptAndApplyIfConfirmed, promptDestructiveConfirmation } from './core/applier.js';
export type {
  MigrationReport,
  DetectedMigration,
  MigrationFile,
  MigrationFormat,
  ExecutionResult,
  RuleViolation,
  Rule,
  RuleSeverity,
  RuleContext,
  ParsedStatement,
  ShadowDatabase,
  ShadowProvider,
  ConnectionConfig,
  MgcheckConfig,
  OutputFormat,
  AnalyzedStatementInfo,
} from './core/types.js';

// Detector
export { detectMigration } from './detector/index.js';

// Analyzer
export { analyze } from './analyzer/index.js';
export { ALL_RULES, DESTRUCTIVE_RULE_IDS } from './analyzer/rules/index.js';

// Shadow DB
export { createShadowDatabase } from './shadow/index.js';

// Reporter
export { renderReport, getExitCode } from './reporter/index.js';

// Installer & AI Integrations
export {
  detectClients,
  setupMcp,
  uninstallMcp,
  verifyConnections,
  installGitHook,
  uninstallGitHook,
  injectAgentRules,
  ensureGitIgnore,
} from './installer/index.js';
export type { SetupOptions, DetectedClient, DetectResult } from './installer/index.js';

// Activity & Audit Log
export {
  writeAuditEntry,
  readAuditLog,
  getLogDir,
  getAuditFile,
  getGlobalAuditFile,
  findProjectRoot,
  setLogDir,
} from './core/activity-log.js';
export type { AuditEntry, ActivityEntry } from './core/activity-log.js';

// Auto-Fixer
export {
  fixMigrationSql,
  generateDiff,
  verifyFixedSql,
  promptUserForFix,
  formatColoredDiff,
  runAutoFix,
} from './fixer/index.js';
export type { FixResult, AppliedFix } from './fixer/index.js';

// Approval Modes
export {
  getApprovalMode,
  setApprovalMode,
  validateAutoApproveLevels,
  getDefaultAutoApprove,
} from './core/approval-mode.js';
export type {
  ApprovalMode,
  SafeRiskLevel,
  ApprovalSource,
  ApprovalModeConfig,
} from './core/approval-mode.js';

