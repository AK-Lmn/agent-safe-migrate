import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { getStmtType, getStmtNode, sqlMatches } from './types.js';

/**
 * MG005: DROP COLUMN
 *
 * Dropping a column is a destructive, irreversible operation that
 * permanently removes data. This always requires explicit confirmation.
 */
export const dropColumn: Rule = {
  id: 'MG005',
  name: 'drop-column',
  severity: 'error',
  description: 'DROP COLUMN is destructive and irreversible — requires --confirm-destructive',

  check(statements: ParsedStatement[], _context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const stmt of statements) {
      let isViolation = false;

      if (stmt.ast) {
        const type = getStmtType(stmt.ast);
        if (type === 'AlterTableStmt') {
          const node = getStmtNode(stmt.ast);
          if (node?.cmds) {
            for (const cmd of node.cmds) {
              const alterCmd = cmd.AlterTableCmd;
              // AT_DropColumn
              if (
                alterCmd &&
                (alterCmd.subtype === 'AT_DropColumn' || alterCmd.subtype === 12)
              ) {
                isViolation = true;
              }
            }
          }
        }
      } else {
        if (sqlMatches(stmt.raw, /ALTER\s+TABLE\b.*\bDROP\s+COLUMN\b/i)) {
          isViolation = true;
        }
      }

      if (isViolation) {
        violations.push({
          ruleId: 'MG005',
          ruleName: 'drop-column',
          severity: 'error',
          message:
            '⚠️  DESTRUCTIVE: DROP COLUMN permanently removes the column and all its data. ' +
            'This operation is irreversible. Any application code still referencing this column ' +
            'will break immediately.',
          line: stmt.line,
          sql: stmt.raw,
          suggestion:
            'Before dropping a column in production:\n' +
            '1. Remove all application code references to the column first\n' +
            '2. Deploy the code change\n' +
            '3. Only then drop the column in a separate migration\n' +
            '4. Use --confirm-destructive to proceed with this migration',
        });
      }
    }

    return violations;
  },
};
