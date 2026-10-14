import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { getStmtType, sqlMatches } from './types.js';

/**
 * MG011: TRUNCATE
 *
 * TRUNCATE instantly deletes every row in the table (and, with CASCADE,
 * in every table that references it). It takes an ACCESS EXCLUSIVE lock
 * and cannot be undone without a backup.
 */
export const truncateTable: Rule = {
  id: 'MG011',
  name: 'truncate-table',
  severity: 'error',
  description: 'TRUNCATE deletes every row in the table — requires --confirm-destructive',

  check(statements: ParsedStatement[], _context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const stmt of statements) {
      const isViolation = stmt.ast
        ? getStmtType(stmt.ast) === 'TruncateStmt'
        : sqlMatches(stmt.raw, /^\s*TRUNCATE\b/im);

      if (isViolation) {
        const cascade = sqlMatches(stmt.raw, /\bCASCADE\b/i);
        violations.push({
          ruleId: 'MG011',
          ruleName: 'truncate-table',
          severity: 'error',
          message:
            '⚠️  DESTRUCTIVE: TRUNCATE permanently deletes every row in the table' +
            (cascade ? ', and CASCADE also empties every table that references it' : '') +
            '. It takes an ACCESS EXCLUSIVE lock and cannot be undone without a backup.',
          line: stmt.line,
          sql: stmt.raw,
          suggestion:
            'TRUNCATE rarely belongs in a schema migration:\n' +
            '1. To remove specific rows, use DELETE ... WHERE ... in batches\n' +
            '2. If the data really is disposable, back it up first\n' +
            '3. Use --confirm-destructive to proceed',
        });
      }
    }

    return violations;
  },
};
