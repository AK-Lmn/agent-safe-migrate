import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DetectedMigration, MigrationFile } from '../core/types.js';

interface DrizzleJournal {
  version: string;
  dialect: string;
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
}

/**
 * Detect and parse a Drizzle migration directory.
 *
 * Drizzle structure:
 *   drizzle/
 *     0001_init.sql
 *     0002_add_billing.sql
 *     meta/
 *       _journal.json
 *       0001_snapshot.json
 *       0002_snapshot.json
 */
export function detectDrizzle(dirPath: string): DetectedMigration {
  const journalPath = join(dirPath, 'meta', '_journal.json');
  const files: MigrationFile[] = [];

  if (existsSync(journalPath)) {
    // Use journal for ordering
    const journal: DrizzleJournal = JSON.parse(
      readFileSync(journalPath, 'utf-8')
    );

    for (const entry of journal.entries) {
      const sqlFile = join(dirPath, `${entry.tag}.sql`);
      if (existsSync(sqlFile)) {
        files.push({
          path: sqlFile,
          sql: readFileSync(sqlFile, 'utf-8'),
          order: entry.idx,
        });
      }
    }
  } else {
    // Fallback: read SQL files sorted by name
    const sqlFiles = readdirSync(dirPath)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (let i = 0; i < sqlFiles.length; i++) {
      const filePath = join(dirPath, sqlFiles[i]);
      files.push({
        path: filePath,
        sql: readFileSync(filePath, 'utf-8'),
        order: i,
      });
    }
  }

  return {
    format: 'drizzle',
    files,
    hasDownMigration: false, // Drizzle doesn't natively support down migrations
    basePath: dirPath,
  };
}

/**
 * Check if a directory looks like a Drizzle migration directory.
 */
export function isDrizzleDirectory(dirPath: string): boolean {
  return existsSync(join(dirPath, 'meta', '_journal.json'));
}
