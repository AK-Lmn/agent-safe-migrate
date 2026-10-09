import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DetectedMigration, MigrationFile } from '../core/types.js';

/**
 * Extracts the "Up" portion from a Goose / dbmate migration SQL string.
 */
export function extractUpSql(rawSql: string): { upSql: string; hasDown: boolean } {
  // Check for Goose syntax: -- +goose Up ... -- +goose Down
  if (rawSql.includes('-- +goose Up') || rawSql.includes('-- +goose StatementBegin')) {
    const hasDown = rawSql.includes('-- +goose Down');
    const downIdx = rawSql.indexOf('-- +goose Down');
    const upIdx = rawSql.indexOf('-- +goose Up');

    let upSql = rawSql;
    if (upIdx !== -1) {
      const start = upIdx + '-- +goose Up'.length;
      upSql = downIdx > upIdx ? rawSql.slice(start, downIdx) : rawSql.slice(start);
    } else if (downIdx !== -1) {
      upSql = rawSql.slice(0, downIdx);
    }

    // Clean up statement boundary comments
    upSql = upSql
      .replace(/-- \+goose StatementBegin/g, '')
      .replace(/-- \+goose StatementEnd/g, '')
      .trim();

    return { upSql: upSql || rawSql, hasDown };
  }

  // Check for dbmate syntax: -- migrate:up ... -- migrate:down
  if (rawSql.includes('-- migrate:up') || rawSql.includes('-- migrate:down')) {
    const hasDown = rawSql.includes('-- migrate:down');
    const downIdx = rawSql.indexOf('-- migrate:down');
    const upIdx = rawSql.indexOf('-- migrate:up');

    let upSql = rawSql;
    if (upIdx !== -1) {
      const start = upIdx + '-- migrate:up'.length;
      upSql = downIdx > upIdx ? rawSql.slice(start, downIdx) : rawSql.slice(start);
    } else if (downIdx !== -1) {
      upSql = rawSql.slice(0, downIdx);
    }

    return { upSql: upSql.trim() || rawSql, hasDown };
  }

  return { upSql: rawSql, hasDown: false };
}

/**
 * Check if a file content or directory is Goose-formatted.
 */
export function isGooseContent(sql: string): boolean {
  return sql.includes('-- +goose Up') || sql.includes('-- +goose Down');
}

export function isDbmateContent(sql: string): boolean {
  return sql.includes('-- migrate:up') || sql.includes('-- migrate:down');
}

/**
 * Parse a Goose / dbmate migration file or directory.
 */
export function detectGoose(filePathOrDir: string): DetectedMigration {
  const content = readFileSync(filePathOrDir, 'utf-8');
  const isDbmate = isDbmateContent(content);
  const { upSql, hasDown } = extractUpSql(content);

  const file: MigrationFile = {
    path: filePathOrDir,
    sql: upSql,
    order: 0,
  };

  return {
    format: isDbmate ? 'dbmate' : 'goose',
    files: [file],
    hasDownMigration: hasDown,
    basePath: filePathOrDir,
  };
}
