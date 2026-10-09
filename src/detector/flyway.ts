import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { DetectedMigration, MigrationFile } from '../core/types.js';

// Flyway regex: V1__desc.sql, V1.1__desc.sql, U1__undo.sql, R__repeatable.sql
const FLYWAY_VERSIONED_REGEX = /^V([\d._]+)__(.+)\.sql$/i;
const FLYWAY_UNDO_REGEX = /^U([\d._]+)__(.+)\.sql$/i;
const FLYWAY_REPEATABLE_REGEX = /^R__(.+)\.sql$/i;

/**
 * Detect and parse a Flyway migration directory or list of files.
 */
export function detectFlyway(dirPath: string): DetectedMigration {
  const entries = readdirSync(dirPath)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const versionedFiles: Array<{ filename: string; version: string; path: string }> = [];
  const undoFiles = new Set<string>();

  for (const filename of entries) {
    const vMatch = filename.match(FLYWAY_VERSIONED_REGEX);
    if (vMatch) {
      versionedFiles.push({
        filename,
        version: vMatch[1],
        path: join(dirPath, filename),
      });
      continue;
    }

    const uMatch = filename.match(FLYWAY_UNDO_REGEX);
    if (uMatch) {
      undoFiles.add(uMatch[1]);
      continue;
    }

    const rMatch = filename.match(FLYWAY_REPEATABLE_REGEX);
    if (rMatch) {
      versionedFiles.push({
        filename,
        version: '999999', // Repeatable runs last
        path: join(dirPath, filename),
      });
    }
  }

  // Check if at least one versioned file has a matching undo file
  const hasDown = versionedFiles.some((vf) => undoFiles.has(vf.version));

  const files: MigrationFile[] = versionedFiles.map((vf, index) => ({
    path: vf.path,
    sql: readFileSync(vf.path, 'utf-8'),
    order: index,
  }));

  return {
    format: 'flyway',
    files,
    hasDownMigration: hasDown,
    basePath: dirPath,
  };
}

/**
 * Check if a directory contains Flyway-patterned migration files.
 */
export function isFlywayDirectory(dirPath: string): boolean {
  try {
    const entries = readdirSync(dirPath);
    return entries.some(
      (f) =>
        FLYWAY_VERSIONED_REGEX.test(f) ||
        FLYWAY_UNDO_REGEX.test(f) ||
        FLYWAY_REPEATABLE_REGEX.test(f)
    );
  } catch {
    return false;
  }
}
