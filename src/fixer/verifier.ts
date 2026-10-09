import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MgcheckConfig, RuleViolation, DetectedMigration } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { analyze } from '../analyzer/index.js';
import { createShadowDatabase } from '../shadow/index.js';

export interface VerifyResult {
  verified: boolean;
  error?: string;
  remainingViolations: RuleViolation[];
}

/**
 * Re-verifies a fixed SQL migration against a fresh shadow PostgreSQL database
 * and all 10 AST safety rules.
 *
 * Requirements to pass:
 * 1. The SQL must execute successfully in the shadow database (valid Postgres syntax & semantics)
 * 2. 0 blocking errors (severity: 'error') must remain from the safety rules
 */
export async function verifyFixedSql(
  fixedSql: string,
  options: {
    seedFile?: string;
    baseSchemaSql?: string;
    provider?: 'pglite' | 'docker';
    config?: MgcheckConfig;
  } = {}
): Promise<VerifyResult> {
  const provider = options.provider || 'pglite';
  const config = options.config || loadConfig({
    shadowDb: {
      provider,
      dockerImage: 'postgres:16-alpine',
      seedFile: options.seedFile,
    },
    confirmDestructive: false,
  });

  // 1. Static AST re-analysis
  const ephemeralMigration: DetectedMigration = {
    format: 'raw-sql',
    files: [
      {
        path: 'fixed-migration.sql',
        sql: fixedSql,
        order: 0,
      },
    ],
    hasDownMigration: true,
    basePath: process.cwd(),
  };

  const analysis = await analyze(ephemeralMigration, config);
  const blockingViolations = analysis.violations.filter((v) => v.severity === 'error');

  // If static rules still flag blocking errors, fail fast
  if (blockingViolations.length > 0) {
    const errorMsg = blockingViolations.map((v) => `[${v.ruleId}] ${v.message}`).join('; ');
    return {
      verified: false,
      error: `Fix did not resolve all safety issues: ${errorMsg}`,
      remainingViolations: analysis.violations,
    };
  }

  // 2. Fresh shadow database execution
  const shadow = createShadowDatabase(config);

  try {
    await shadow.create();

    // Apply seed schema if provided
    if (options.baseSchemaSql) {
      await shadow.seed(options.baseSchemaSql);
    } else if (config.shadowDb.seedFile) {
      const seedPath = resolve(config.shadowDb.seedFile);
      if (existsSync(seedPath)) {
        const seedSql = readFileSync(seedPath, 'utf-8');
        await shadow.seed(seedSql);
      }
    }

    // Execute the fixed SQL
    const execResult = await shadow.execute(fixedSql);
    if (!execResult.success) {
      return {
        verified: false,
        error: `Shadow database execution failed: ${execResult.error}`,
        remainingViolations: analysis.violations,
      };
    }

    return {
      verified: true,
      remainingViolations: analysis.violations,
    };
  } catch (err) {
    return {
      verified: false,
      error: `Shadow database verification error: ${(err as Error).message}`,
      remainingViolations: analysis.violations,
    };
  } finally {
    await shadow.teardown().catch(() => {});
  }
}
