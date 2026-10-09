import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { detectMigration } from '../../src/detector/index.js';
import { detectRawSql } from '../../src/detector/raw-sql.js';
import { extractUpSql, isGooseContent, isDbmateContent } from '../../src/detector/goose.js';

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

  it('detects Goose SQL files with Up and Down sections', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mg-goose-'));
    const gooseFile = join(tempDir, '20240101_init.sql');
    writeFileSync(
      gooseFile,
      `-- +goose Up\nALTER TABLE users ADD COLUMN bio TEXT;\n\n-- +goose Down\nALTER TABLE users DROP COLUMN bio;`
    );

    const detected = detectMigration(gooseFile);
    expect(detected.format).toBe('goose');
    expect(detected.hasDownMigration).toBe(true);
    expect(detected.files[0].sql).toBe('ALTER TABLE users ADD COLUMN bio TEXT;');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects dbmate SQL files with Up and Down sections', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mg-dbmate-'));
    const dbmateFile = join(tempDir, '20240101_init.sql');
    writeFileSync(
      dbmateFile,
      `-- migrate:up\nALTER TABLE users ADD COLUMN role TEXT;\n\n-- migrate:down\nALTER TABLE users DROP COLUMN role;`
    );

    const detected = detectMigration(dbmateFile);
    expect(detected.format).toBe('dbmate');
    expect(detected.hasDownMigration).toBe(true);
    expect(detected.files[0].sql).toBe('ALTER TABLE users ADD COLUMN role TEXT;');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects Supabase migration folders', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mg-supabase-'));
    const migrationsDir = join(tempDir, 'supabase', 'migrations');
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(
      join(migrationsDir, '20240301000000_create_profiles.sql'),
      'CREATE TABLE profiles (id serial primary key);'
    );

    const detected = detectMigration(tempDir);
    expect(detected.format).toBe('supabase');
    expect(detected.files.length).toBe(1);
    expect(detected.files[0].sql).toContain('CREATE TABLE profiles');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects Flyway migration folders and pairs undo migrations', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mg-flyway-'));
    writeFileSync(
      join(tempDir, 'V1__init.sql'),
      'CREATE TABLE accounts (id int);'
    );
    writeFileSync(
      join(tempDir, 'U1__init.sql'),
      'DROP TABLE accounts;'
    );

    const detected = detectMigration(tempDir);
    expect(detected.format).toBe('flyway');
    expect(detected.hasDownMigration).toBe(true);
    expect(detected.files.length).toBe(1);
    expect(detected.files[0].sql).toContain('CREATE TABLE accounts');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects golang-migrate directories and pairs up/down files', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mg-golang-'));
    writeFileSync(
      join(tempDir, '000001_init.up.sql'),
      'CREATE TABLE posts (id int);'
    );
    writeFileSync(
      join(tempDir, '000001_init.down.sql'),
      'DROP TABLE posts;'
    );

    const detected = detectMigration(tempDir);
    expect(detected.format).toBe('golang-migrate');
    expect(detected.hasDownMigration).toBe(true);
    expect(detected.files.length).toBe(1);
    expect(detected.files[0].sql).toContain('CREATE TABLE posts');

    rmSync(tempDir, { recursive: true, force: true });
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
