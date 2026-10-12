import { describe, it, expect, vi } from 'vitest';
import { promptAndApplyIfConfirmed, promptDestructiveConfirmation, findDatabaseUrl } from '../../src/core/applier.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Real Database Applier', () => {
  it('should not prompt or apply in CI mode', async () => {
    const applied = await promptAndApplyIfConfirmed('CREATE TABLE test (id INT);', {
      isCi: true,
    });
    expect(applied).toBe(false);
  });

  it('should not prompt if process is not in interactive TTY', async () => {
    const applied = await promptAndApplyIfConfirmed('CREATE TABLE test (id INT);', {
      isCi: false,
    });
    // In vitest headless environment, process.stdin.isTTY is falsy
    expect(applied).toBe(false);
  });

  it('should return false for destructive prompt in non-TTY/CI mode', async () => {
    const approved = await promptDestructiveConfirmation([
      { ruleId: 'MG006', ruleName: 'drop-table', sql: 'DROP TABLE users;' },
    ], true);
    expect(approved).toBe(false);
  });

  it('should discover DATABASE_URL from project root and nested Backend/.env', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'mgcheck-env-test-'));
    try {
      const backendDir = join(testDir, 'Backend');
      mkdirSync(backendDir, { recursive: true });
      writeFileSync(join(backendDir, '.env'), 'DATABASE_URL=postgresql://user:pass@localhost:5432/mydb\n', 'utf-8');

      const url = findDatabaseUrl(testDir);
      expect(url).toBe('postgresql://user:pass@localhost:5432/mydb');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

