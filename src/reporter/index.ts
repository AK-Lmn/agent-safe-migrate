import type { MigrationReport, OutputFormat } from '../core/types.js';
import { renderTerminalReport } from './terminal.js';
import { renderJsonReport } from './json.js';
import { renderMarkdownReport } from './markdown.js';

/**
 * Render a migration report in the specified format.
 */
export function renderReport(report: MigrationReport, format: OutputFormat): string {
  switch (format) {
    case 'terminal':
      return renderTerminalReport(report);
    case 'json':
      return renderJsonReport(report);
    case 'markdown':
      return renderMarkdownReport(report);
    default:
      return renderTerminalReport(report);
  }
}

/**
 * Get the exit code for a migration report.
 *
 * 0 = passed
 * 1 = failed (execution error or blocking violation)
 * 2 = warnings only
 */
export function getExitCode(report: MigrationReport): number {
  if (report.passed) {
    const hasWarnings = report.violations.some((v) => v.severity === 'warning');
    return hasWarnings ? 2 : 0;
  }
  return 1;
}

export { renderTerminalReport } from './terminal.js';
export { renderJsonReport } from './json.js';
export { renderMarkdownReport } from './markdown.js';
