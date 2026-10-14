import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';

/**
 * MG014: SQL the PostgreSQL parser could not read
 *
 * Usually a typo, which would fail at deploy time. It can also be valid
 * syntax newer than the bundled parser (PostgreSQL 13 grammar), so this is
 * a warning: the other rules still check the statement by text matching,
 * just less precisely. Set "MG014": "error" in the config to make it block.
 */
export const unparseableSql: Rule = {
  id: 'MG014',
  name: 'unparseable-sql',
  severity: 'warning',
  description: 'Statement could not be parsed — likely a syntax error; safety rules checked it less precisely',

  check(statements: ParsedStatement[], _context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const stmt of statements) {
      if (!stmt.parseError) continue;

      violations.push({
        ruleId: 'MG014',
        ruleName: 'unparseable-sql',
        severity: 'warning',
        message:
          `The PostgreSQL parser could not read this statement (${stmt.parseError}). ` +
          'If it is a typo, it will fail when it runs. If it is valid syntax newer than ' +
          'PostgreSQL 13, the safety rules could only check it by text matching.',
        line: stmt.line,
        sql: stmt.raw,
        suggestion:
          'Fix the syntax error, or verify the statement with `mgcheck run`, which executes it on a shadow database.\n' +
          'To make unreadable SQL block, set "MG014": "error" in .mgcheckrc.json.',
      });
    }

    return violations;
  },
};
