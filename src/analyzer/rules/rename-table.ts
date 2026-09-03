import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { getStmtType, getStmtNode, sqlMatches } from './types.js';

/**
 * MG008: RENAME TABLE
 *
 * Renaming a table is a breaking change for zero-downtime deployments.
 * All application code, views, foreign keys, and queries referencing
 * the old table name will fail immediately.
 */
export const renameTable: Rule = {
  id: 'MG008',
  name: 'rename-table',
  severity: 'warning',
  description: 'RENAME TABLE is a breaking change for zero-downtime deployments',

  check(statements: ParsedStatement[], _context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const stmt of statements) {
      let isViolation = false;

      if (stmt.ast) {
        const type = getStmtType(stmt.ast);
        if (type === 'RenameStmt') {
          const node = getStmtNode(stmt.ast);
          // OBJECT_TABLE rename
          if (
            node &&
            (node.renameType === 'OBJECT_TABLE' || node.renameType === 38)
          ) {
            isViolation = true;
          }
        }
      } else {
        if (sqlMatches(stmt.raw, /ALTER\s+TABLE\b.*\bRENAME\s+TO\b/i)) {
          isViolation = true;
        }
      }

      if (isViolation) {
        violations.push({
          ruleId: 'MG008',
          ruleName: 'rename-table',
          severity: 'warning',
          message:
            'Renaming a table is a breaking change for zero-downtime deployments. All ' +
            'application code, views, foreign keys, and queries referencing the old table name ' +
            'will fail immediately after the rename.',
          line: stmt.line,
          sql: stmt.raw,
          suggestion:
            'For zero-downtime rename:\n' +
            '1. Create a new table with the desired name\n' +
            '2. Create a VIEW with the old name pointing to the new table\n' +
            '3. Migrate application code to use the new table name\n' +
            '4. Drop the view and old table in a subsequent migration',
        });
      }
    }

    return violations;
  },
};
