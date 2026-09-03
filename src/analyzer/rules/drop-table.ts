import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { getStmtType, getStmtNode, sqlMatches } from './types.js';

/**
 * MG006: DROP TABLE
 *
 * Dropping a table permanently deletes the table and ALL its data.
 * This is the most destructive migration operation possible.
 */
export const dropTable: Rule = {
  id: 'MG006',
  name: 'drop-table',
  severity: 'error',
  description: 'DROP TABLE is destructive and irreversible — requires --confirm-destructive',

  check(statements: ParsedStatement[], _context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const stmt of statements) {
      let isViolation = false;

      if (stmt.ast) {
        const type = getStmtType(stmt.ast);
        if (type === 'DropStmt') {
          const node = getStmtNode(stmt.ast);
          if (node && (node.removeType === 'OBJECT_TABLE' || node.removeType === 38)) {
            isViolation = true;
          }
        }
      } else {
        if (sqlMatches(stmt.raw, /DROP\s+TABLE\b/i)) {
          isViolation = true;
        }
      }

      if (isViolation) {
        violations.push({
          ruleId: 'MG006',
          ruleName: 'drop-table',
          severity: 'error',
          message:
            '⚠️  DESTRUCTIVE: DROP TABLE permanently deletes the table and ALL its data. ' +
            'This operation is irreversible. All foreign keys, indexes, triggers, and ' +
            'policies associated with this table will also be removed.',
          line: stmt.line,
          sql: stmt.raw,
          suggestion:
            'Before dropping a table in production:\n' +
            '1. Ensure no application code references this table\n' +
            '2. Consider renaming the table first (e.g., _deprecated_tablename)\n' +
            '3. Wait a safe period to confirm nothing breaks\n' +
            '4. Back up the data if it might be needed later\n' +
            '5. Use --confirm-destructive to proceed',
        });
      }
    }

    return violations;
  },
};
