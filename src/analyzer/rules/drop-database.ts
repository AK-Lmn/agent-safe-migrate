import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { getStmtType, sqlMatches } from './types.js';

/**
 * MG013: DROP DATABASE
 *
 * Deletes an entire database. It never belongs in a schema migration.
 */
export const dropDatabase: Rule = {
  id: 'MG013',
  name: 'drop-database',
  severity: 'error',
  description: 'DROP DATABASE deletes an entire database — requires --confirm-destructive',

  check(statements: ParsedStatement[], _context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const stmt of statements) {
      const isViolation = stmt.ast
        ? getStmtType(stmt.ast) === 'DropdbStmt'
        : sqlMatches(stmt.raw, /DROP\s+DATABASE\b/i);

      if (isViolation) {
        violations.push({
          ruleId: 'MG013',
          ruleName: 'drop-database',
          severity: 'error',
          message:
            '⚠️  DESTRUCTIVE: DROP DATABASE permanently deletes an entire database, ' +
            'including every schema, table and row in it. This is irreversible.',
          line: stmt.line,
          sql: stmt.raw,
          suggestion:
            'Database-level operations do not belong in a schema migration.\n' +
            'Run them by hand, after a backup, if you really mean it.\n' +
            'Use --confirm-destructive to proceed',
        });
      }
    }

    return violations;
  },
};
