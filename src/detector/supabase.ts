import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import type { DetectedMigration, MigrationFile } from '../core/types.js';

/**
 * Detect and parse a Supabase migration directory.
 *
 * Supabase structure:
 *   supabase/migrations/
 *     20240301120000_create_users.sql
 *     20240302130000_add_profiles.sql
 */
export function detectSupabase(dirPath: string): DetectedMigration {
  // If pointed at project root containing supabase/migrations
  const targetDir = existsSync(join(dirPath, 'supabase', 'migrations'))
    ? join(dirPath, 'supabase', 'migrations')
    : existsSync(join(dirPath, 'migrations')) && (dirPath.endsWith('supabase') || existsSync(join(dirPath, 'config.toml')))
    ? join(dirPath, 'migrations')
    : dirPath;

  const entries = readdirSync(targetDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const files: MigrationFile[] = entries.map((filename, index) => {
    const filePath = join(targetDir, filename);
    return {
      path: filePath,
      sql: readFileSync(filePath, 'utf-8'),
      order: index,
    };
  });

  const hasDown = entries.some(
    (f) => f.toLowerCase().includes('down') || f.toLowerCase().includes('rollback')
  );

  return {
    format: 'supabase',
    files,
    hasDownMigration: hasDown,
    basePath: targetDir,
  };
}

/**
 * Check if a path or directory corresponds to Supabase migrations.
 */
export function isSupabaseDirectory(dirPath: string): boolean {
  try {
    // 1. Pointed at project root that has supabase/migrations/
    if (existsSync(join(dirPath, 'supabase', 'migrations'))) {
      return true;
    }

    // 2. Pointed at `supabase/` folder with `migrations/` or `config.toml`
    if (
      (dirPath.endsWith('supabase') || dirPath.endsWith('supabase/') || dirPath.endsWith('supabase\\')) &&
      (existsSync(join(dirPath, 'migrations')) || existsSync(join(dirPath, 'config.toml')))
    ) {
      return true;
    }

    // 3. Pointed directly at `supabase/migrations/`
    const normalized = resolve(dirPath).replace(/\\/g, '/');
    if (normalized.includes('/supabase/migrations')) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
