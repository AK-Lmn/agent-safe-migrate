import type { ExecutionResult } from '../core/types.js';

/**
 * SQL statement executor with proper error capture.
 * Wraps the shadow database execution with timing and statement counting.
 */
export function formatExecutionError(error: string): string {
  // Clean up Postgres error messages for readability
  const lines = error.split('\n');
  const relevantLines = lines.filter(
    (line) =>
      !line.startsWith('    at ') && // Remove stack traces
      line.trim().length > 0
  );
  return relevantLines.join('\n').trim();
}

/**
 * Check if an execution result indicates a known PGlite limitation
 * rather than a genuine SQL error.
 */
export function isPGliteLimitation(result: ExecutionResult): boolean {
  if (result.success) return false;
  const error = result.error || '';
  return (
    error.includes('CONCURRENTLY') ||
    error.includes('PGlite does not support')
  );
}

/**
 * Build a human-readable execution summary.
 */
export function buildExecutionSummary(result: ExecutionResult): string {
  if (result.success) {
    return (
      `✅ Executed successfully ` +
      `(${result.statementsExecuted} statement${result.statementsExecuted !== 1 ? 's' : ''}, ` +
      `${result.executionTimeMs}ms)`
    );
  }

  return `❌ Execution failed: ${formatExecutionError(result.error || 'Unknown error')}`;
}
