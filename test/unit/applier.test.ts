import { describe, it, expect, vi } from 'vitest';
import { promptAndApplyIfConfirmed, promptDestructiveConfirmation } from '../../src/core/applier.js';

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
});
