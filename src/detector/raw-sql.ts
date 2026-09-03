import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { DetectedMigration, MigrationFile } from '../core/types.js';

/**
 * Handle raw .sql files — single file or directory of SQL files.
 */
export function detectRawSql(filePath: string): DetectedMigration {
  const sql = readFileSync(filePath, 'utf-8');
  const file: MigrationFile = {
    path: filePath,
    sql,
    order: 0,
  };

  return {
    format: 'raw-sql',
    files: [file],
    hasDownMigration: false,
    basePath: filePath,
  };
}

/**
 * Handle a directory of raw SQL files.
 * Files are sorted by name (alphabetical/numeric).
 */
export function detectRawSqlDirectory(files: string[]): DetectedMigration {
  const sqlFiles = files
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filePath, index) => ({
      path: filePath,
      sql: readFileSync(filePath, 'utf-8'),
      order: index,
    }));

  // Check for down migration patterns
  const hasDown = sqlFiles.some(
    (f) =>
      basename(f.path).toLowerCase().includes('down') ||
      basename(f.path).toLowerCase().includes('rollback')
  );

  return {
    format: 'raw-sql',
    files: sqlFiles,
    hasDownMigration: hasDown,
    basePath: sqlFiles[0]?.path || '',
  };
}
