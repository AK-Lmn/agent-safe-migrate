import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { runCheck } from '../../src/core/engine.js';
import { loadConfig } from '../../src/core/config.js';

describe('Engine Integration (analyze & pglite)', () => {
  it('analyzes unsafe index migration statically and flags MG001 and MG009', async () => {
    const fixturePath = resolve(__dirname, '../fixtures/migrations/unsafe-create-index.sql');
    const config = loadConfig({
      output: { format: 'json', verbose: false },
    });

    const report = await runCheck(fixturePath, config, 'analyze');

    expect(report.mode).toBe('analyze');
    expect(report.passed).toBe(false); // Fails due to MG001 (error severity)
    const ruleIds = report.violations.map((v) => v.ruleId);
    expect(ruleIds).toContain('MG001');
    expect(ruleIds).toContain('MG009');
  });

  it('runs safe migration against pglite shadow database with seed', async () => {
    const fixturePath = resolve(__dirname, '../fixtures/migrations/safe-add-column.sql');
    const seedPath = resolve(__dirname, '../fixtures/schemas/base-schema.sql');

    const config = loadConfig({
      shadowDb: {
        provider: 'pglite',
        dockerImage: 'postgres:16-alpine',
        seedFile: seedPath,
      },
      output: { format: 'json', verbose: false },
    });

    const report = await runCheck(fixturePath, config, 'run');

    expect(report.execution).not.toBeNull();
    expect(report.execution?.success).toBe(true);
  });

  it('detects destructive operation and requires confirmDestructive', async () => {
    const fixturePath = resolve(__dirname, '../fixtures/migrations/destructive-drop-table.sql');
    const seedPath = resolve(__dirname, '../fixtures/schemas/base-schema.sql');

    // Without confirmDestructive -> should fail
    const configUnconfirmed = loadConfig({
      shadowDb: {
        provider: 'pglite',
        dockerImage: 'postgres:16-alpine',
        seedFile: seedPath,
      },
      confirmDestructive: false,
      output: { format: 'json', verbose: false },
    });

    const reportUnconfirmed = await runCheck(fixturePath, configUnconfirmed, 'run');
    expect(reportUnconfirmed.hasDestructive).toBe(true);
    expect(reportUnconfirmed.passed).toBe(false);

    // With confirmDestructive -> should pass if rules overridden or confirmed
    const configConfirmed = loadConfig({
      shadowDb: {
        provider: 'pglite',
        dockerImage: 'postgres:16-alpine',
        seedFile: seedPath,
      },
      rules: {
        MG006: 'warning', // Demote to warning to test execution
      },
      confirmDestructive: true,
      output: { format: 'json', verbose: false },
    });

    const reportConfirmed = await runCheck(fixturePath, configConfirmed, 'run');
    expect(reportConfirmed.execution?.success).toBe(true);
    expect(reportConfirmed.passed).toBe(true);
  });
});
