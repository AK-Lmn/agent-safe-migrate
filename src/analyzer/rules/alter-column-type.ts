import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { getStmtType, getStmtNode, sqlMatches } from './types.js';

/**
 * MG002: ALTER TABLE ... ALTER COLUMN ... TYPE
 *
 * Changing a column's data type almost always requires a full table rewrite,
 * acquiring an ACCESS EXCLUSIVE lock that blocks ALL access (reads + writes)
 * for the duration. On large tables this can cause minutes of complete
 * downtime.
 */
export const alterColumnType: Rule = {
  id: 'MG002',
  name: 'alter-column-type',
  severity: 'error',
  description: 'ALTER COLUMN TYPE causes a full table rewrite with ACCESS EXCLUSIVE lock',

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
              // AT_AlterColumnType = 25 in Postgres internals
              // subtype field maps to the AT_* enum
              if (
                alterCmd &&
                (alterCmd.subtype === 'AT_AlterColumnType' ||
                  alterCmd.subtype === 25)
              ) {
                isViolation = true;
              }
            }
          }
        }
      } else {
        // Regex fallback
        if (sqlMatches(stmt.raw, /ALTER\s+TABLE\b.*\bALTER\s+COLUMN\b.*\bTYPE\b/i)) {
          isViolation = true;
        }
        // Also catch: ALTER TABLE ... ALTER ... SET DATA TYPE
        if (sqlMatches(stmt.raw, /ALTER\s+TABLE\b.*\bSET\s+DATA\s+TYPE\b/i)) {
          isViolation = true;
        }
      }

      if (isViolation) {
        violations.push({
          ruleId: 'MG002',
          ruleName: 'alter-column-type',
          severity: 'error',
          message:
            'ALTER COLUMN TYPE triggers a full table rewrite, acquiring an ACCESS EXCLUSIVE lock ' +
            'that blocks ALL operations (including SELECT) for the entire duration. On a table ' +
            'with millions of rows, this can cause minutes of complete downtime.',
          line: stmt.line,
          sql: stmt.raw,
          suggestion:
            'Use the expand/contract pattern instead:\n' +
            '1. Add a new column with the desired type\n' +
            '2. Backfill data from the old column to the new one (in batches)\n' +
            '3. Update application code to use the new column\n' +
            '4. Drop the old column in a subsequent migration',
        });
      }
    }

    return violations;
  },
};
