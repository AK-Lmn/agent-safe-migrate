import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DetectedMigration, MigrationFile } from '../core/types.js';

const GOLANG_MIGRATE_UP_REGEX = /^(.+)\.up\.sql$/i;
const GOLANG_MIGRATE_DOWN_REGEX = /^(.+)\.down\.sql$/i;

/**
 * Detect and parse a golang-migrate directory.
 */
export function detectGolangMigrate(dirPath: string): DetectedMigration {
  const entries = readdirSync(dirPath).sort();

  const upFiles: string[] = [];
  const downBaseNames = new Set<string>();

  for (const filename of entries) {
    const upMatch = filename.match(GOLANG_MIGRATE_UP_REGEX);
    if (upMatch) {
      upFiles.push(filename);
      continue;
    }

    const downMatch = filename.match(GOLANG_MIGRATE_DOWN_REGEX);
    if (downMatch) {
      downBaseNames.add(downMatch[1]);
    }
  }

  const files: MigrationFile[] = upFiles.map((filename, index) => {
    const filePath = join(dirPath, filename);
    return {
      path: filePath,
      sql: readFileSync(filePath, 'utf-8'),
      order: index,
    };
  });

  const hasDown = upFiles.some((f) => {
    const base = f.match(GOLANG_MIGRATE_UP_REGEX)?.[1];
    return base ? downBaseNames.has(base) : false;
  });

  return {
    format: 'golang-migrate',
    files,
    hasDownMigration: hasDown,
    basePath: dirPath,
  };
}

/**
 * Check if a directory is structured for golang-migrate (.up.sql / .down.sql).
 */
export function isGolangMigrateDirectory(dirPath: string): boolean {
  try {
    const entries = readdirSync(dirPath);
    return entries.some((f) => GOLANG_MIGRATE_UP_REGEX.test(f));
  } catch {
    return false;
  }
}
