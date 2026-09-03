import type { MigrationReport } from '../core/types.js';

/**
 * JSON reporter — machine-readable output for CI/CD pipelines.
 * Outputs the full MigrationReport as formatted JSON.
 */
export function renderJsonReport(report: MigrationReport): string {
  return JSON.stringify(report, null, 2);
}
