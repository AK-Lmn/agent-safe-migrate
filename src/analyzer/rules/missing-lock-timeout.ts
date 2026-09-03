import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { sqlMatches } from './types.js';

/**
 * MG009: Missing lock_timeout guard
 *
 * Risky DDL operations (CREATE INDEX, ALTER TABLE, etc.) should be preceded
 * by SET lock_timeout to prevent the migration from waiting indefinitely
 * for a lock. Without lock_timeout, a migration can trigger a "lock queue
 * death spiral" where the waiting lock request blocks all subsequent queries.
 */
export const missingLockTimeout: Rule = {
  id: 'MG009',
  name: 'missing-lock-timeout',
  severity: 'warning',
  description: 'No lock_timeout or statement_timeout set before risky operations',

  check(statements: ParsedStatement[], _context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    // Check if any statement sets lock_timeout or statement_timeout
    const hasLockTimeout = statements.some((s) =>
      sqlMatches(s.raw, /SET\s+(LOCAL\s+)?lock_timeout/i)
    );
    const hasStatementTimeout = statements.some((s) =>
      sqlMatches(s.raw, /SET\s+(LOCAL\s+)?statement_timeout/i)
    );

    if (hasLockTimeout || hasStatementTimeout) {
      return violations;
    }

    // Check if there are any risky operations that would benefit from a timeout
    const riskyPatterns = [
      /CREATE\s+INDEX\b/i,
      /ALTER\s+TABLE\b/i,
      /DROP\s+INDEX\b/i,
    ];

    const hasRiskyOp = statements.some((s) =>
      riskyPatterns.some((p) => sqlMatches(s.raw, p))
    );

    if (hasRiskyOp) {
      violations.push({
        ruleId: 'MG009',
        ruleName: 'missing-lock-timeout',
        severity: 'warning',
        message:
          'This migration contains DDL operations that acquire locks but does not set a ' +
          'lock_timeout. Without a lock_timeout, if another transaction holds a conflicting ' +
          'lock, your migration will wait indefinitely — and all subsequent queries will ' +
          'queue behind it, potentially causing a cascading outage (lock queue death spiral).',
        line: 1,
        sql: _context.fullSql.substring(0, 200) + '...',
        suggestion:
          'Add a lock timeout at the beginning of your migration:\n' +
          '  SET lock_timeout = \'5s\';\n\n' +
          'This causes the migration to fail fast if it cannot acquire the lock within 5 seconds, ' +
          'rather than waiting indefinitely and blocking other queries. You can retry the migration ' +
          'during a quieter period.',
      });
    }

    return violations;
  },
};
