import type { ParsedStatement } from '../core/types.js';

/**
 * Parse raw SQL into individual statements with AST representation.
 * Uses pgsql-parser (WASM port of the real PostgreSQL C parser) for
 * production-grade AST parsing.
 *
 * Falls back to a regex-based splitter if AST parsing fails (e.g.
 * for non-standard SQL extensions) to still provide best-effort
 * rule checking.
 */
export async function parseSql(rawSql: string): Promise<ParsedStatement[]> {
  const statements: ParsedStatement[] = [];

  try {
    // Dynamic import to handle ESM/WASM loading
    const { parse } = await import('pgsql-parser');
    const result = await parse(rawSql);
    const stmtList = Array.isArray(result) ? result : (result?.stmts || []);

    if (stmtList.length > 0) {
      for (let i = 0; i < stmtList.length; i++) {
        const stmtObj = stmtList[i];
        const loc = stmtObj.stmt_location || 0;
        const len = stmtObj.stmt_len && stmtObj.stmt_len > 0
          ? stmtObj.stmt_len
          : rawSql.length - loc;
        const raw = rawSql.substring(loc, loc + len).trim();
        const line = rawSql.substring(0, loc).split('\n').length;

        statements.push({
          raw,
          line,
          ast: stmtObj,
        });
      }
      return statements;
    }
  } catch {
    // Fallback: regex-based splitting with no AST
    // This allows rule checks that don't need deep AST access
    const rawStatements = splitStatements(rawSql);
    for (let i = 0; i < rawStatements.length; i++) {
      const raw = rawStatements[i].trim();
      if (!raw) continue;

      statements.push({
        raw,
        line: findLineNumber(rawSql, rawStatements[i]),
        ast: null,
      });
    }
    return statements;
  }

  // If stmtList was empty, try fallback splitting
  const fallbackStatements = splitStatements(rawSql);
  for (const rawStmt of fallbackStatements) {
    const raw = rawStmt.trim();
    if (!raw) continue;
    statements.push({
      raw,
      line: findLineNumber(rawSql, rawStmt),
      ast: null,
    });
  }

  return statements;
}

/**
 * Split SQL text into individual statements.
 * Respects string literals, dollar-quoted strings, and comments.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inDollarQuote = false;
  let dollarTag = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1] || '';

    // Handle line comments
    if (!inSingleQuote && !inDoubleQuote && !inDollarQuote && !inBlockComment) {
      if (char === '-' && next === '-') {
        inLineComment = true;
        current += char;
        continue;
      }
    }

    if (inLineComment) {
      current += char;
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    // Handle block comments
    if (!inSingleQuote && !inDoubleQuote && !inDollarQuote) {
      if (char === '/' && next === '*') {
        inBlockComment = true;
        current += char;
        continue;
      }
    }

    if (inBlockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    // Handle dollar-quoted strings ($$...$$)
    if (!inSingleQuote && !inDoubleQuote && char === '$') {
      if (inDollarQuote) {
        // Check if this is the closing tag
        const remaining = sql.substring(i);
        if (remaining.startsWith(dollarTag)) {
          current += dollarTag;
          i += dollarTag.length - 1;
          inDollarQuote = false;
          continue;
        }
      } else {
        // Check if this starts a dollar quote
        const match = sql.substring(i).match(/^(\$[^$]*\$)/);
        if (match) {
          dollarTag = match[1];
          current += dollarTag;
          i += dollarTag.length - 1;
          inDollarQuote = true;
          continue;
        }
      }
    }

    if (inDollarQuote) {
      current += char;
      continue;
    }

    // Handle single quotes
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (inSingleQuote) {
      current += char;
      continue;
    }

    // Handle double quotes (identifiers)
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (inDoubleQuote) {
      current += char;
      continue;
    }

    // Statement terminator
    if (char === ';') {
      current += char;
      if (current.trim()) {
        statements.push(current);
      }
      current = '';
      continue;
    }

    current += char;
  }

  // Don't forget the last statement (may not end with ;)
  if (current.trim()) {
    statements.push(current);
  }

  return statements;
}

/**
 * Find the 1-based line number of a substring in the full SQL text.
 */
function findLineNumber(fullSql: string, substring: string): number {
  const trimmed = substring.trim();
  const index = fullSql.indexOf(trimmed);
  if (index === -1) return 1;

  const before = fullSql.substring(0, index);
  return before.split('\n').length;
}
