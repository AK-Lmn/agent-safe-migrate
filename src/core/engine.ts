import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MgcheckConfig, MigrationReport, DetectedMigration, ExecutionResult } from './types.js';
import { detectMigration } from '../detector/index.js';
import { analyze } from '../analyzer/index.js';
import { createShadowDatabase } from '../shadow/index.js';

/**
 * Main engine orchestrator.
 *
 * Pipeline:
 * 1. Detect migration format
 * 2. Run static analysis (rule engine)
 * 3. (If mode=run) Spin up shadow DB → seed → execute → teardown
 * 4. Build final report
 */
export async function runCheck(
  inputPath: string,
  config: MgcheckConfig,
  mode: 'run' | 'analyze' = 'run',
  onProgress?: (message: string) => void
): Promise<MigrationReport> {
  const log = onProgress || (() => {});

  // 1. Detect migration format
  log('Detecting migration format...');
  const migration = detectMigration(inputPath);
  log(`Detected: ${migration.format} (${migration.files.length} file(s))`);

  // 2. Run static analysis
  log('Running rule analysis...');
  const analysis = await analyze(migration, config);
  log(`Parsed ${analysis.statements.length} SQL statement(s):`);
  for (const s of analysis.statements) {
    const singleLine = s.raw.replace(/\s+/g, ' ').trim();
    const truncated = singleLine.length > 70 ? singleLine.substring(0, 67) + '...' : singleLine;
    log(`  • [Line ${s.line}] ${truncated}`);
  }
  log(`Rule analysis completed: ${analysis.violations.length} violation(s) found`);

  // 3. Shadow DB execution (only in 'run' mode)
  let execution: ExecutionResult | null = null;

  if (mode === 'run') {
    const shadow = createShadowDatabase(config);

    try {
      log(`Starting shadow database (${config.shadowDb.provider})...`);
      await shadow.create();
      log('Shadow database ready');

      // Seed with base schema if configured
      if (config.shadowDb.seedFile) {
        const seedPath = resolve(config.shadowDb.seedFile);
        if (!existsSync(seedPath)) {
          throw new Error(`Seed file not found: ${seedPath}`);
        }
        const seedSql = readFileSync(seedPath, 'utf-8');
        log('Applying seed schema...');
        await shadow.seed(seedSql);
        log('Seed schema applied');
      }

      // Execute the target migration
      const fullSql = migration.files.map((f) => f.sql).join('\n');
      log(`Executing migration against shadow database (${analysis.statements.length} statement(s))...`);
      execution = await shadow.execute(fullSql);
      log(execution.success ? 'Migration executed successfully' : `Migration execution failed: ${execution.error}`);
    } finally {
      log('Tearing down shadow database...');
      await shadow.teardown();
      log('Shadow database cleaned up');
    }
  }

  // 4. Build report
  const hasBlockingViolations = analysis.violations.some((v) => v.severity === 'error');
  const executionFailed = execution !== null && !execution.success;

  // Check destructive violations against --confirm-destructive
  const hasUnconfirmedDestructive =
    analysis.hasDestructive && !config.confirmDestructive;

  const passed =
    !executionFailed &&
    !hasBlockingViolations &&
    !hasUnconfirmedDestructive;

  const report: MigrationReport = {
    migration,
    execution,
    violations: analysis.violations,
    statements: analysis.statements,
    passed,
    hasDestructive: analysis.hasDestructive,
    timestamp: new Date().toISOString(),
    mode,
  };

  return report;
}
