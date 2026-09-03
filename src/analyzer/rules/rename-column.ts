import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { getStmtType, getStmtNode, sqlMatches } from './types.js';

/**
 * MG007: RENAME COLUMN
 *
 * Renaming a column is a breaking change for zero-downtime deployments.
 * Old code still referencing the original column name will fail
 * immediately after the rename.
 */
export const renameColumn: Rule = {
  id: 'MG007',
  name: 'rename-column',
  severity: 'warning',
  description: 'RENAME COLUMN is a breaking change for zero-downtime deployments',

  check(statements: ParsedStatement[], _context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const stmt of statements) {
      let isViolation = false;

      if (stmt.ast) {
        const type = getStmtType(stmt.ast);
        if (type === 'RenameStmt') {
          const node = getStmtNode(stmt.ast);
          // OBJECT_COLUMN rename
          if (
            node &&
            (node.renameType === 'OBJECT_COLUMN' || node.renameType === 3)
          ) {
            isViolation = true;
          }
        }
      } else {
        if (sqlMatches(stmt.raw, /ALTER\s+TABLE\b.*\bRENAME\s+COLUMN\b/i)) {
          isViolation = true;
        }
      }

      if (isViolation) {
        violations.push({
          ruleId: 'MG007',
          ruleName: 'rename-column',
          severity: 'warning',
          message:
            'Renaming a column is a breaking change for zero-downtime deployments. Any running ' +
            'application code, ORM queries, or reports referencing the old column name will fail ' +
            'immediately after the rename is applied.',
          line: stmt.line,
          sql: stmt.raw,
          suggestion:
            'For zero-downtime rename, use the expand/contract pattern:\n' +
            '1. Add a new column with the desired name\n' +
            '2. Write to both old and new columns in application code\n' +
            '3. Backfill existing data to the new column\n' +
            '4. Switch reads to the new column\n' +
            '5. Stop writing to the old column\n' +
            '6. Drop the old column in a subsequent migration',
        });
      }
    }

    return violations;
  },
};
