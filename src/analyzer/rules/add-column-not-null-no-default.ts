import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { getStmtType, getStmtNode, sqlMatches } from './types.js';

/**
 * MG003: ADD COLUMN ... NOT NULL without DEFAULT
 *
 * Adding a NOT NULL column without a DEFAULT requires PostgreSQL to rewrite
 * the entire table (pre-PG11). Even on PG11+ where DEFAULT is metadata-only,
 * omitting the DEFAULT means every existing row fails the NOT NULL check
 * unless the table is empty.
 */
export const addColumnNotNullNoDefault: Rule = {
  id: 'MG003',
  name: 'add-column-not-null-no-default',
  severity: 'error',
  description: 'ADD COLUMN NOT NULL without DEFAULT causes table rewrite or failure on non-empty tables',

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
              // AT_AddColumn
              if (
                alterCmd &&
                (alterCmd.subtype === 'AT_AddColumn' || alterCmd.subtype === 0)
              ) {
                const colDef = alterCmd.def?.ColumnDef || alterCmd.def;
                if (colDef) {
                  const hasNotNull = colDef.constraints?.some(
                    (c: any) =>
                      c.Constraint?.contype === 'CONSTR_NOTNULL' ||
                      c.Constraint?.contype === 1
                  );
                  const hasDefault = colDef.constraints?.some(
                    (c: any) =>
                      c.Constraint?.contype === 'CONSTR_DEFAULT' ||
                      c.Constraint?.contype === 2
                  );

                  if (hasNotNull && !hasDefault) {
                    isViolation = true;
                  }
                }
              }
            }
          }
        }
      } else {
        // Regex fallback: match ADD COLUMN with NOT NULL but no DEFAULT
        if (
          sqlMatches(stmt.raw, /ADD\s+COLUMN\b.*\bNOT\s+NULL\b/i) &&
          !sqlMatches(stmt.raw, /\bDEFAULT\b/i)
        ) {
          isViolation = true;
        }
      }

      if (isViolation) {
        violations.push({
          ruleId: 'MG003',
          ruleName: 'add-column-not-null-no-default',
          severity: 'error',
          message:
            'Adding a NOT NULL column without a DEFAULT value will fail on any non-empty table ' +
            '(existing rows cannot satisfy the NOT NULL constraint). On PostgreSQL < 11, even ' +
            'with a DEFAULT, this triggers a full table rewrite. On PG 11+, constant DEFAULT ' +
            'values are metadata-only and safe.',
          line: stmt.line,
          sql: stmt.raw,
          suggestion:
            'Safe approach (works on all PG versions):\n' +
            '1. ADD COLUMN name type (nullable, no constraint)\n' +
            '2. UPDATE table SET name = default_value WHERE name IS NULL (backfill in batches)\n' +
            '3. ALTER COLUMN name SET NOT NULL\n\n' +
            'Or on PG 11+:\n' +
            '  ADD COLUMN name type NOT NULL DEFAULT \'value\'',
        });
      }
    }

    return violations;
  },
};
