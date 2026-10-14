import type { RuleViolation } from '../core/types.js';
import { DESTRUCTIVE_RULE_IDS } from '../analyzer/rules/index.js';
import type { AppliedFix, FixResult } from './types.js';

/**
 * Determine a safe default value for a column based on its declared PostgreSQL type.
 */
function getSafeDefaultValue(typeStr: string): string {
  const normalized = typeStr.trim().toLowerCase();

  if (normalized.includes('bool')) {
    return 'false';
  }
  if (
    normalized.includes('int') ||
    normalized.includes('serial') ||
    normalized.includes('numeric') ||
    normalized.includes('decimal') ||
    normalized.includes('real') ||
    normalized.includes('double') ||
    normalized.includes('float')
  ) {
    return '0';
  }
  if (
    normalized.includes('timestamp') ||
    normalized.includes('date') ||
    normalized.includes('time')
  ) {
    return 'CURRENT_TIMESTAMP';
  }
  if (normalized.includes('uuid')) {
    return 'gen_random_uuid()';
  }
  if (normalized.includes('json')) {
    return "'{}'";
  }

  // Fallback for varchar, text, string, char, etc.
  return "''";
}

/**
 * Generates a clean text diff between original and fixed SQL.
 */
export function generateDiff(original: string, fixed: string): string {
  const origLines = original.split('\n');
  const fixedLines = fixed.split('\n');
  const diffLines: string[] = [];

  // Simple unified diff view
  let i = 0;
  let j = 0;

  while (i < origLines.length || j < fixedLines.length) {
    const orig = origLines[i];
    const fix = fixedLines[j];

    if (orig === fix) {
      if (orig !== undefined) {
        diffLines.push(`  ${orig}`);
      }
      i++;
      j++;
    } else {
      if (orig !== undefined && fix !== undefined) {
        diffLines.push(`- ${orig}`);
        diffLines.push(`+ ${fix}`);
        i++;
        j++;
      } else if (orig !== undefined) {
        diffLines.push(`- ${orig}`);
        i++;
      } else if (fix !== undefined) {
        diffLines.push(`+ ${fix}`);
        j++;
      }
    }
  }

  return diffLines.join('\n');
}

/**
 * Automatically applies safe, zero-downtime rewrites to SQL statements
 * based on detected AST rule violations.
 */
export function fixMigrationSql(originalSql: string, violations: RuleViolation[]): FixResult {
  let currentSql = originalSql;
  const appliedFixes: AppliedFix[] = [];
  let hasDestructive = false;

  const violationRuleIds = new Set(violations.map((v) => v.ruleId));

  // Check destructive operations (MG005, MG006, MG011–MG013)
  if ([...violationRuleIds].some((id) => DESTRUCTIVE_RULE_IDS.has(id))) {
    hasDestructive = true;
  }

  // 1. Fix MG009: Missing lock_timeout
  if (violationRuleIds.has('MG009')) {
    if (!/SET\s+lock_timeout\s*=/i.test(currentSql)) {
      currentSql = `SET lock_timeout = '5s';\n\n` + currentSql.trimStart();
      appliedFixes.push({
        ruleId: 'MG009',
        ruleName: 'missing-lock-timeout',
        description: "Prepended 'SET lock_timeout = '5s';' to prevent lock-queue death spiral outages.",
      });
    }
  }

  // 2. Fix MG001: CREATE INDEX without CONCURRENTLY
  if (violationRuleIds.has('MG001')) {
    // Match CREATE [UNIQUE] INDEX [IF NOT EXISTS] <name> ON ...
    const regex = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_"]+)\s+ON/gi;
    let modified = false;

    currentSql = currentSql.replace(regex, (_match, isUnique, indexName) => {
      modified = true;
      const uniqueStr = isUnique ? `${isUnique.trim()} ` : '';
      return `CREATE ${uniqueStr}INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON`;
    });

    if (modified) {
      appliedFixes.push({
        ruleId: 'MG001',
        ruleName: 'create-index-not-concurrent',
        description: "Rewrote to 'CREATE INDEX CONCURRENTLY IF NOT EXISTS' so index builds in the background without locking table writes.",
      });
    }
  }

  // 3. Fix MG003: ADD COLUMN NOT NULL without DEFAULT
  if (violationRuleIds.has('MG003')) {
    // Match: ALTER TABLE <table> ADD COLUMN <col> <type> NOT NULL
    const addColRegex = /ADD\s+COLUMN\s+([a-zA-Z0-9_"]+)\s+([a-zA-Z0-9_()]+)\s+NOT\s+NULL(?!\s+DEFAULT)/gi;
    let modified = false;

    currentSql = currentSql.replace(addColRegex, (_match, colName, colType) => {
      modified = true;
      const defaultVal = getSafeDefaultValue(colType);
      return `ADD COLUMN ${colName} ${colType} DEFAULT ${defaultVal} NOT NULL`;
    });

    if (modified) {
      appliedFixes.push({
        ruleId: 'MG003',
        ruleName: 'add-column-not-null-no-default',
        description: "Added safe DEFAULT value so column addition executes instantly via metadata without table rewrite or row failure.",
      });
    }
  }

  // 4. Fix MG004: ADD CONSTRAINT without NOT VALID
  if (violationRuleIds.has('MG004')) {
    // Match: ALTER TABLE <table> ADD CONSTRAINT <name> <definition>;
    const constraintRegex = /ALTER\s+TABLE\s+([a-zA-Z0-9_"]+)\s+ADD\s+CONSTRAINT\s+([a-zA-Z0-9_"]+)\s+([^;]+?)(?:\s+NOT\s+VALID)?\s*;/gi;
    let modified = false;
    const validationsToAdd: string[] = [];

    currentSql = currentSql.replace(constraintRegex, (_match, tableName, constraintName, constraintDef) => {
      // Check if already has NOT VALID
      if (/NOT\s+VALID/i.test(constraintDef)) {
        return _match;
      }
      modified = true;
      validationsToAdd.push(`ALTER TABLE ${tableName} VALIDATE CONSTRAINT ${constraintName};`);
      return `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${constraintDef.trim()} NOT VALID;`;
    });

    if (modified) {
      if (validationsToAdd.length > 0) {
        currentSql = currentSql.trimEnd() + '\n\n' + validationsToAdd.join('\n');
      }
      appliedFixes.push({
        ruleId: 'MG004',
        ruleName: 'add-constraint-not-valid',
        description: "Appended 'NOT VALID' to create constraint in 2ms without write locks, followed by non-blocking 'VALIDATE CONSTRAINT'.",
      });
    }
  }

  // 5. Fix MG002: ALTER COLUMN TYPE (Expand / Contract pattern)
  if (violationRuleIds.has('MG002')) {
    // Match ALTER TABLE <table> ALTER COLUMN <col> TYPE <newtype>;
    const alterTypeRegex = /ALTER\s+TABLE\s+([a-zA-Z0-9_"]+)\s+ALTER\s+COLUMN\s+([a-zA-Z0-9_"]+)\s+TYPE\s+([^;]+?)\s*;/gi;
    let modified = false;

    currentSql = currentSql.replace(alterTypeRegex, (_match, tableName, colName, newType) => {
      modified = true;
      const cleanType = newType.trim();
      return [
        `-- Zero-downtime Expand/Contract pattern for ${tableName}.${colName}:`,
        `ALTER TABLE ${tableName} ADD COLUMN ${colName}_new ${cleanType};`,
        `UPDATE ${tableName} SET ${colName}_new = ${colName}::${cleanType} WHERE ${colName}_new IS NULL;`,
        `-- Note: Deploy application code reading ${colName}_new, then drop legacy column in next release.`,
      ].join('\n');
    });

    if (modified) {
      appliedFixes.push({
        ruleId: 'MG002',
        ruleName: 'alter-column-type',
        description: "Replaced table-locking full table rewrite with online Expand/Contract dual-column backfill pattern.",
      });
    }
  }

  const fixed = appliedFixes.length > 0;
  const diff = fixed ? generateDiff(originalSql, currentSql) : '';

  return {
    fixed,
    originalSql,
    fixedSql: currentSql,
    diff,
    appliedFixes,
    hasDestructive,
  };
}
