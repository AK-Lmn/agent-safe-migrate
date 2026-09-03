import type { DetectedMigration, MgcheckConfig, RuleViolation, RuleContext, AnalyzedStatementInfo } from '../core/types.js';
import { getRuleSeverity } from '../core/config.js';
import { parseSql } from './parser.js';
import { ALL_RULES, DESTRUCTIVE_RULE_IDS } from './rules/index.js';

export interface AnalysisResult {
  violations: RuleViolation[];
  hasDestructive: boolean;
  statements: AnalyzedStatementInfo[];
}

/**
 * Run all enabled rules against the migration SQL.
 *
 * 1. Concatenates all migration files into one SQL body
 * 2. Parses into AST statements
 * 3. Runs each enabled rule
 * 4. Applies config severity overrides
 * 5. Returns violations + destructive flag
 */
export async function analyze(
  migration: DetectedMigration,
  config: MgcheckConfig
): Promise<AnalysisResult> {
  // Combine all migration files into one SQL body
  const fullSql = migration.files.map((f) => f.sql).join('\n');

  // Parse into statements
  const statements = await parseSql(fullSql);

  // Build rule context
  const context: RuleContext = {
    hasDownMigration: migration.hasDownMigration,
    format: migration.format,
    fullSql,
  };

  // Run all rules
  const violations: RuleViolation[] = [];
  let hasDestructive = false;

  for (const rule of ALL_RULES) {
    // Check if rule is disabled or has severity override
    const effectiveSeverity = getRuleSeverity(rule.id, rule.severity, config);

    if (effectiveSeverity === null) {
      continue; // Rule is disabled
    }

    const ruleViolations = rule.check(statements, context);

    for (const violation of ruleViolations) {
      // Apply severity override
      violation.severity = effectiveSeverity;

      violations.push(violation);

      // Check if this is a destructive operation
      if (DESTRUCTIVE_RULE_IDS.has(violation.ruleId)) {
        hasDestructive = true;
      }
    }
  }

  return {
    violations,
    hasDestructive,
    statements: statements.map((s) => ({ line: s.line, raw: s.raw })),
  };
}

export { parseSql } from './parser.js';
export { ALL_RULES, DESTRUCTIVE_RULE_IDS } from './rules/index.js';
