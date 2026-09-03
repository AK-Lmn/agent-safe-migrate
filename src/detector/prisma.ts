import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { DetectedMigration, MigrationFile } from '../core/types.js';

/**
 * Detect and parse a Prisma migration directory.
 * 
 * Prisma structure:
 *   prisma/migrations/
 *     20240301120000_add_user_status/
 *       migration.sql
 *     20240302130000_add_billing/
 *       migration.sql
 */
export function detectPrisma(dirPath: string): DetectedMigration {
  const migrationSqlPath = join(dirPath, 'migration.sql');

  // Case 1: Pointed directly at a specific migration directory
  if (existsSync(migrationSqlPath)) {
    const sql = readFileSync(migrationSqlPath, 'utf-8');
    const hasDown = existsSync(join(dirPath, 'down.sql'));

    return {
      format: 'prisma',
      files: [{ path: migrationSqlPath, sql, order: 0 }],
      hasDownMigration: hasDown,
      basePath: dirPath,
    };
  }

  // Case 2: Pointed at the migrations root (prisma/migrations/)
  const files: MigrationFile[] = [];
  const entries = readdirSync(dirPath)
    .filter((entry) => {
      const entryPath = join(dirPath, entry);
      return statSync(entryPath).isDirectory();
    })
    .sort(); // Timestamp-prefixed dirs sort chronologically

  let hasDown = false;

  for (let i = 0; i < entries.length; i++) {
    const entryDir = join(dirPath, entries[i]);
    const sqlFile = join(entryDir, 'migration.sql');

    if (existsSync(sqlFile)) {
      files.push({
        path: sqlFile,
        sql: readFileSync(sqlFile, 'utf-8'),
        order: i,
      });

      if (existsSync(join(entryDir, 'down.sql'))) {
        hasDown = true;
      }
    }
  }

  return {
    format: 'prisma',
    files,
    hasDownMigration: hasDown,
    basePath: dirPath,
  };
}

/**
 * Check if a directory looks like a Prisma migration directory.
 */
export function isPrismaDirectory(dirPath: string): boolean {
  // Direct migration directory: contains migration.sql
  if (existsSync(join(dirPath, 'migration.sql'))) {
    return true;
  }

  // Migrations root: subdirectories contain migration.sql
  try {
    const entries = readdirSync(dirPath);
    return entries.some((entry) => {
      const entryPath = join(dirPath, entry);
      return (
        statSync(entryPath).isDirectory() &&
        existsSync(join(entryPath, 'migration.sql'))
      );
    });
  } catch {
    return false;
  }
}
