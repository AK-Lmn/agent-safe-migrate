import { statSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { DetectedMigration } from '../core/types.js';
import { detectRawSql, detectRawSqlDirectory } from './raw-sql.js';
import { detectPrisma, isPrismaDirectory } from './prisma.js';
import { detectDrizzle, isDrizzleDirectory } from './drizzle.js';
import { detectSupabase, isSupabaseDirectory } from './supabase.js';
import { detectFlyway, isFlywayDirectory } from './flyway.js';
import { detectGoose, isGooseContent, isDbmateContent } from './goose.js';
import { detectGolangMigrate, isGolangMigrateDirectory } from './golang-migrate.js';

/**
 * Auto-detect the migration format from a given path.
 *
 * Detection logic:
 *   File (.sql)
 *     → Contains Goose/dbmate directives (`-- +goose` / `-- migrate:`) → Goose / dbmate
 *     → Otherwise → Raw SQL
 *   Directory:
 *     → Contains supabase/migrations or config.toml → Supabase
 *     → Contains migration.sql or subdirs with migration.sql → Prisma
 *     → Contains meta/_journal.json → Drizzle
 *     → Contains V*__*.sql or U*__*.sql → Flyway
 *     → Contains *.up.sql → golang-migrate
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

    const content = readFileSync(fullPath, 'utf-8');
    if (isGooseContent(content) || isDbmateContent(content)) {
      return detectGoose(fullPath);
    }

    return detectRawSql(fullPath);
  }

  // Directory
  if (stat.isDirectory()) {
    // 1. Check Supabase
    if (isSupabaseDirectory(fullPath)) {
      return detectSupabase(fullPath);
    }

    // 2. Check Prisma
    if (isPrismaDirectory(fullPath)) {
      return detectPrisma(fullPath);
    }

    // 3. Check Drizzle (has meta/_journal.json)
    if (isDrizzleDirectory(fullPath)) {
      return detectDrizzle(fullPath);
    }

    // 4. Check Flyway (V*__*, U*__*)
    if (isFlywayDirectory(fullPath)) {
      return detectFlyway(fullPath);
    }

    // 5. Check golang-migrate (*.up.sql)
    if (isGolangMigrateDirectory(fullPath)) {
      return detectGolangMigrate(fullPath);
    }

    // 6. Fallback to raw SQL files
    const entries = readdirSync(fullPath);
    const sqlFiles = entries
      .filter((f) => f.endsWith('.sql'))
      .map((f) => join(fullPath, f));

    if (sqlFiles.length > 0) {
      return detectRawSqlDirectory(sqlFiles);
    }

    throw new Error(
      `No migration files found in ${fullPath}. Expected .sql files, or a supported migration directory (Supabase, Prisma, Drizzle, Flyway, golang-migrate).`
    );
  }

  throw new Error(`Unsupported path type: ${fullPath}`);
}

export { detectRawSql, detectRawSqlDirectory } from './raw-sql.js';
export { detectPrisma, isPrismaDirectory } from './prisma.js';
export { detectDrizzle, isDrizzleDirectory } from './drizzle.js';
export { detectSupabase, isSupabaseDirectory } from './supabase.js';
export { detectFlyway, isFlywayDirectory } from './flyway.js';
export { detectGoose, isGooseContent, isDbmateContent } from './goose.js';
export { detectGolangMigrate, isGolangMigrateDirectory } from './golang-migrate.js';
