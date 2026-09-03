import { statSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { DetectedMigration } from '../core/types.js';
import { detectRawSql, detectRawSqlDirectory } from './raw-sql.js';
import { detectPrisma, isPrismaDirectory } from './prisma.js';
import { detectDrizzle, isDrizzleDirectory } from './drizzle.js';

/**
 * Auto-detect the migration format from a given path.
 *
 * Detection logic:
 *   File (.sql) → Raw SQL
 *   Directory:
 *     → Contains migration.sql or subdirs with migration.sql → Prisma
 *     → Contains meta/_journal.json → Drizzle
 *     → Contains *.sql files → Raw SQL directory
 *     → Otherwise: error
 */
export function detectMigration(inputPath: string): DetectedMigration {
  const fullPath = resolve(inputPath);

  if (!existsSync(fullPath)) {
    throw new Error(`Path does not exist: ${fullPath}`);
  }

  const stat = statSync(fullPath);

  // Single file
  if (stat.isFile()) {
    if (!fullPath.endsWith('.sql')) {
      throw new Error(
        `Unsupported file type: ${fullPath}. Expected a .sql file.`
      );
    }
    return detectRawSql(fullPath);
  }

  // Directory
  if (stat.isDirectory()) {
    // Check Prisma first (more specific pattern)
    if (isPrismaDirectory(fullPath)) {
      return detectPrisma(fullPath);
    }

    // Check Drizzle (has meta/_journal.json)
    if (isDrizzleDirectory(fullPath)) {
      return detectDrizzle(fullPath);
    }

    // Check for raw SQL files
    const entries = readdirSync(fullPath);
    const sqlFiles = entries
      .filter((f) => f.endsWith('.sql'))
      .map((f) => join(fullPath, f));

    if (sqlFiles.length > 0) {
      return detectRawSqlDirectory(sqlFiles);
    }

    throw new Error(
      `No migration files found in ${fullPath}. Expected .sql files, a Prisma migration directory, or a Drizzle migration directory.`
    );
  }

  throw new Error(`Unsupported path type: ${fullPath}`);
}

export { detectRawSql, detectRawSqlDirectory } from './raw-sql.js';
export { detectPrisma, isPrismaDirectory } from './prisma.js';
export { detectDrizzle, isDrizzleDirectory } from './drizzle.js';
