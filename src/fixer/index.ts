import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RuleViolation, MgcheckConfig } from '../core/types.js';
import { fixMigrationSql, generateDiff } from './rules-fixer.js';
import { verifyFixedSql } from './verifier.js';
import { promptUserForFix, formatColoredDiff } from './prompter.js';
import type { FixResult, AppliedFix } from './types.js';

export {
  fixMigrationSql,
  generateDiff,
  verifyFixedSql,
  promptUserForFix,
  formatColoredDiff,
};
export type { FixResult, AppliedFix };

/**
 * High-level orchestrator:
 * 1. Reads migration file
 * 2. Runs safe zero-downtime rules fixer
 * 3. Spins up fresh shadow DB to verify the fix executes with 0 errors
 * 4. Interactively prompts the user via [y/N] (defaulting to N)
 */
export async function runAutoFix(
  filePath: string,
  violations: RuleViolation[],
  options: {
    seedFile?: string;
    provider?: 'pglite' | 'docker';
    isCi?: boolean;
    autoAccept?: boolean;
    config?: MgcheckConfig;
  } = {}
): Promise<FixResult> {
  const fullPath = resolve(filePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Migration file not found: ${fullPath}`);
  }

  const rawSql = readFileSync(fullPath, 'utf-8');
  const fixResult = fixMigrationSql(rawSql, violations);

  if (!fixResult.fixed) {
    return fixResult;
  }

  // Shadow DB Re-verification
  const verification = await verifyFixedSql(fixResult.fixedSql, {
    seedFile: options.seedFile,
    provider: options.provider || 'pglite',
    config: options.config,
  });

  fixResult.verified = verification.verified;
  fixResult.verificationError = verification.error;

  // If verified, prompt the user to apply the fix
  if (fixResult.verified) {
    await promptUserForFix(fullPath, fixResult, {
      isCi: options.isCi,
      autoAccept: options.autoAccept,
    });
  }

  return fixResult;
}
