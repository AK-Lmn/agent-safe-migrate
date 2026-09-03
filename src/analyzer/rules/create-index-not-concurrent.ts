import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';
import { getStmtType, getStmtNode, sqlMatches } from './types.js';

/**
 * MG001: CREATE INDEX without CONCURRENTLY
 *
 * CREATE INDEX acquires a SHARE lock, blocking writes for the entire
 * index build. On large tables this can block INSERT/UPDATE/DELETE
 * for minutes or hours. CONCURRENTLY builds the index without holding
 * a long-duration lock.
 */
export const createIndexNotConcurrent: Rule = {
  id: 'MG001',
  name: 'create-index-not-concurrent',
  severity: 'error',
  description: 'CREATE INDEX without CONCURRENTLY locks the table for writes during index build',

  check(statements: ParsedStatement[], _context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const stmt of statements) {
      let isViolation = false;

      if (stmt.ast) {
        const type = getStmtType(stmt.ast);
        if (type === 'IndexStmt') {
          const node = getStmtNode(stmt.ast);
          if (node && !node.concurrent) {
            isViolation = true;
          }
        }
      } else {
        // Regex fallback
        const pattern = /CREATE\s+INDEX\b(?!\s+CONCURRENTLY)/i;
        const uniquePattern = /CREATE\s+UNIQUE\s+INDEX\b(?!\s+CONCURRENTLY)/i;
        if (
          (sqlMatches(stmt.raw, pattern) || sqlMatches(stmt.raw, uniquePattern)) &&
          !sqlMatches(stmt.raw, /CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i)
        ) {
          isViolation = true;
        }
      }

      if (isViolation) {
        violations.push({
          ruleId: 'MG001',
          ruleName: 'create-index-not-concurrent',
          severity: 'error',
          message:
            'CREATE INDEX without CONCURRENTLY acquires a SHARE lock on the table, ' +
            'blocking all INSERT, UPDATE, and DELETE operations for the entire duration ' +
            'of the index build. On a table with millions of rows, this can block writes ' +
            'for minutes or hours.',
          line: stmt.line,
          sql: stmt.raw,
          suggestion:
            'Use CREATE INDEX CONCURRENTLY instead.\n' +
            'Note: CONCURRENTLY cannot run inside a transaction block, so each index must ' +
            'be created in its own migration or with explicit transaction control.',
        });
      }
    }

    return violations;
  },
};
