import type { Rule, RuleViolation, ParsedStatement, RuleContext, RuleSeverity } from '../../core/types.js';

export type { Rule, RuleViolation, ParsedStatement, RuleContext };

/**
 * Helper: Check if an AST node matches a specific statement type.
 * pgsql-parser wraps statements as { RawStmt: { stmt: { <Type>: {...} } } }
 */
export function getStmtType(ast: any): string | null {
  if (!ast) return null;

  const stmt = ast.RawStmt?.stmt || ast.stmt || ast;
  const keys = Object.keys(stmt);
  return keys.length > 0 ? keys[0] : null;
}

/**
 * Helper: Extract the inner statement node from a pgsql-parser AST node.
 */
export function getStmtNode(ast: any): any {
  if (!ast) return null;
  const stmt = ast.RawStmt?.stmt || ast.stmt || ast;
  const type = getStmtType(ast);
  return type ? stmt[type] : null;
}

/**
 * Helper: Check if raw SQL matches a pattern (case-insensitive).
 * Used as fallback when AST is not available.
 */
export function sqlMatches(raw: string, pattern: RegExp): boolean {
  return pattern.test(raw);
}
