// ─── Migration Detection ─────────────────────────────────────────────

export type MigrationFormat = 'raw-sql' | 'prisma' | 'drizzle';

export interface MigrationFile {
  /** Absolute or relative path to the file */
  path: string;
  /** Raw SQL content */
  sql: string;
  /** Ordering index (0-based) */
  order: number;
}

export interface DetectedMigration {
  /** Detected framework format */
  format: MigrationFormat;
  /** Ordered list of migration SQL files */
  files: MigrationFile[];
  /** Whether a down/rollback migration was found */
  hasDownMigration: boolean;
  /** Root path that was analyzed */
  basePath: string;
}

// ─── Rule Engine ─────────────────────────────────────────────────────

export type RuleSeverity = 'error' | 'warning';

export interface RuleViolation {
  /** Rule identifier, e.g. "MG001" */
  ruleId: string;
  /** Human-readable rule name */
  ruleName: string;
  /** Severity: error = blocking, warning = informational */
  severity: RuleSeverity;
  /** Plain-English explanation of why this is dangerous */
  message: string;
  /** Line number in the SQL file (1-based), if available */
  line?: number;
  /** Column number (1-based), if available */
  column?: number;
  /** The offending SQL statement */
  sql: string;
  /** Suggested safe rewrite pattern */
  suggestion?: string;
}

export interface Rule {
  /** Unique rule ID, e.g. "MG001" */
  id: string;
  /** Human-readable name, e.g. "create-index-not-concurrent" */
  name: string;
  /** Default severity */
  severity: RuleSeverity;
  /** Short description */
  description: string;
  /** Check parsed SQL statements for violations */
  check(statements: ParsedStatement[], context: RuleContext): RuleViolation[];
}

export interface RuleContext {
  /** Whether the migration has a down/rollback counterpart */
  hasDownMigration: boolean;
  /** Detected migration format */
  format: MigrationFormat;
  /** All raw SQL combined */
  fullSql: string;
}

export interface ParsedStatement {
  /** The raw SQL text of this statement */
  raw: string;
  /** Approximate line number in the original file */
  line: number;
  /** The parsed AST node from pgsql-parser */
  ast: any;
}

// ─── Shadow Database ─────────────────────────────────────────────────

export type ShadowProvider = 'docker' | 'pglite';

export interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface ShadowDatabase {
  /** Spin up the shadow database, return connection info */
  create(): Promise<ConnectionConfig>;
  /** Apply seed/base schema SQL */
  seed(sql: string): Promise<void>;
  /** Execute migration SQL and capture result */
  execute(sql: string): Promise<ExecutionResult>;
  /** Tear down and clean up all resources */
  teardown(): Promise<void>;
}

export interface ExecutionResult {
  /** Whether all statements executed without error */
  success: boolean;
  /** The exact Postgres error message, if any */
  error?: string;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Number of statements successfully executed */
  statementsExecuted: number;
}

// ─── Report ──────────────────────────────────────────────────────────

export type OutputFormat = 'terminal' | 'json' | 'markdown';

export interface AnalyzedStatementInfo {
  line: number;
  raw: string;
}

export interface MigrationReport {
  /** Info about the detected migration */
  migration: DetectedMigration;
  /** Shadow DB execution result (null if --analyze only) */
  execution: ExecutionResult | null;
  /** Rule violations found */
  violations: RuleViolation[];
  /** Parsed statements inspected */
  statements?: AnalyzedStatementInfo[];
  /** Overall pass/fail: true only if execution succeeded AND no error-severity violations */
  passed: boolean;
  /** True if any destructive operation was detected */
  hasDestructive: boolean;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Execution mode */
  mode: 'run' | 'analyze';
}

// ─── Configuration ───────────────────────────────────────────────────

export interface MgcheckConfig {
  shadowDb: {
    provider: ShadowProvider;
    dockerImage: string;
    dbUrl?: string;
    seedFile?: string;
  };
  rules: Record<string, RuleSeverity | 'off'>;
  output: {
    format: OutputFormat;
    verbose: boolean;
  };
  confirmDestructive: boolean;
  llm?: {
    provider: string;
    model: string;
    apiKey: string;
    maxFixAttempts: number;
  };
}
