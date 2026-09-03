import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { detectMigration } from '../../src/detector/index.js';
import { detectRawSql } from '../../src/detector/raw-sql.js';

describe('Migration Detector', () => {
  it('detects a raw SQL migration file', () => {
    const fixturePath = resolve(__dirname, '../fixtures/migrations/safe-add-column.sql');
    const detected = detectMigration(fixturePath);

    expect(detected.format).toBe('raw-sql');
    expect(detected.files.length).toBe(1);
    expect(detected.files[0].sql).toContain('ALTER TABLE users ADD COLUMN');
    expect(detected.hasDownMigration).toBe(false);
  });

  it('detects raw SQL directly via detectRawSql', () => {
    const fixturePath = resolve(__dirname, '../fixtures/migrations/unsafe-create-index.sql');
    const detected = detectRawSql(fixturePath);

    expect(detected.format).toBe('raw-sql');
    expect(detected.files.length).toBe(1);
    expect(detected.files[0].sql).toContain('CREATE INDEX');
  });

  it('throws for non-existent path', () => {
    expect(() => detectMigration('./non-existent-migration-file.sql')).toThrow(
      /Path does not exist/
    );
  });

  it('throws for non-SQL file', () => {
    const pkgPath = resolve(__dirname, '../../package.json');
    expect(() => detectMigration(pkgPath)).toThrow(/Expected a .sql file/);
  });
});
