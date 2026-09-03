import type { ShadowDatabase, ConnectionConfig, ExecutionResult } from '../core/types.js';

/**
 * PGlite-based shadow database — runs PostgreSQL entirely in-process
 * via WebAssembly. No Docker required.
 *
 * Advantages:
 * - Zero external dependencies
 * - Starts in ~200ms
 * - Perfect for CI environments without Docker
 *
 * Limitations:
 * - Cannot run CREATE INDEX CONCURRENTLY (single connection)
 * - Some extensions may not be available
 * - Not suitable for testing concurrency-dependent behavior
 */
export class PGliteShadow implements ShadowDatabase {
  private db: any = null;

  async create(): Promise<ConnectionConfig> {
    // Dynamic import for optional dependency
    const { PGlite } = await import('@electric-sql/pglite');
    this.db = new PGlite();

    // PGlite runs in-process, no real network connection
    return {
      host: 'pglite-in-process',
      port: 0,
      database: 'pglite',
      user: 'pglite',
      password: '',
    };
  }

  async seed(sql: string): Promise<void> {
    if (!this.db) {
      throw new Error('PGlite database not created yet. Call create() first.');
    }
    await this.db.exec(sql);
  }

  async execute(sql: string): Promise<ExecutionResult> {
    if (!this.db) {
      throw new Error('PGlite database not created yet. Call create() first.');
    }

    const startTime = Date.now();

    try {
      // PGlite's exec handles multi-statement SQL
      const results = await this.db.exec(sql);
      const statementsExecuted = Array.isArray(results) ? results.length : 1;

      return {
        success: true,
        executionTimeMs: Date.now() - startTime,
        statementsExecuted,
      };
    } catch (err) {
      const errorMessage = (err as Error).message;

      // Known PGlite limitation: CONCURRENTLY not supported
      if (errorMessage.includes('CONCURRENTLY')) {
        return {
          success: false,
          error:
            errorMessage +
            '\n\nNote: PGlite does not support CONCURRENTLY operations. ' +
            'Use --provider docker for full Postgres fidelity.',
          executionTimeMs: Date.now() - startTime,
          statementsExecuted: 0,
        };
      }

      return {
        success: false,
        error: errorMessage,
        executionTimeMs: Date.now() - startTime,
        statementsExecuted: 0,
      };
    }
  }

  async teardown(): Promise<void> {
    if (this.db) {
      try {
        await this.db.close();
      } catch {
        // Ignore close errors
      }
      this.db = null;
    }
  }
}
