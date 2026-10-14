import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { getStmtType, getStmtNode, sqlMatches } from './types.js';

/**
 * MG012: DROP SCHEMA
 *
 * Dropping a schema removes everything inside it. With CASCADE that means
 * every table, view, function and row in the schema, in one statement.
 */
export const dropSchema: Rule = {
  id: 'MG012',
  name: 'drop-schema',
  severity: 'error',
  description: 'DROP SCHEMA deletes the schema and everything in it — requires --confirm-destructive',

  check(statements: ParsedStatement[], _context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const stmt of statements) {
      let isViolation = false;

      if (stmt.ast) {
        if (getStmtType(stmt.ast) === 'DropStmt') {
          isViolation = getStmtNode(stmt.ast)?.removeType === 'OBJECT_SCHEMA';
        }
      } else {
        isViolation = sqlMatches(stmt.raw, /DROP\s+SCHEMA\b/i);
      }

      if (isViolation) {
        const cascade = sqlMatches(stmt.raw, /\bCASCADE\b/i);
        violations.push({
          ruleId: 'MG012',
          ruleName: 'drop-schema',
          severity: 'error',
          message:
            '⚠️  DESTRUCTIVE: DROP SCHEMA permanently deletes the schema' +
            (cascade ? ' and, because of CASCADE, every table, view, function and row inside it' : '') +
            '. This is irreversible.',
          line: stmt.line,
          sql: stmt.raw,
          suggestion:
            'Before dropping a schema:\n' +
            '1. List what it contains and make sure nothing still uses it\n' +
            '2. Back up the data\n' +
            '3. Prefer dropping individual objects so each one gets reviewed\n' +
            '4. Use --confirm-destructive to proceed',
        });
      }
    }

    return violations;
  },
};
