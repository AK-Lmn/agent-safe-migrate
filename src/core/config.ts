import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MgcheckConfig, RuleSeverity } from './types.js';

/** Default configuration values */
const DEFAULT_CONFIG: MgcheckConfig = {
  shadowDb: {
    provider: 'docker',
    dockerImage: 'postgres:16-alpine',
  },
  rules: {},
  output: {
    format: 'terminal',
    verbose: false,
  },
  confirmDestructive: false,
};

/** Config file names to search for, in priority order */
const CONFIG_FILES = [
  '.mgcheckrc.json',
  '.mgcheckrc.yml',
  '.mgcheckrc',
  'mgcheck.config.json',
];

/**
 * Load configuration from file, env vars, and CLI overrides.
 * Priority: CLI flags > env vars > config file > defaults
 */
export function loadConfig(overrides: Partial<MgcheckConfig> = {}, configPath?: string): MgcheckConfig {
  // 1. Start with defaults
  let config: MgcheckConfig = structuredClone(DEFAULT_CONFIG);

  // 2. Load from config file
  const fileConfig = loadConfigFile(configPath);
  if (fileConfig) {
    config = mergeConfig(config, fileConfig);
  }

  // 3. Apply environment variables
  config = applyEnvVars(config);

  // 4. Apply CLI overrides (highest priority)
  config = mergeConfig(config, overrides);

  return config;
}

/** Search for and load a config file */
function loadConfigFile(explicitPath?: string): Partial<MgcheckConfig> | null {
  if (explicitPath) {
    const fullPath = resolve(explicitPath);
    if (!existsSync(fullPath)) {
      throw new Error(`Config file not found: ${fullPath}`);
    }
    return parseConfigFile(fullPath);
  }

  // Auto-detect config file in current directory
  for (const name of CONFIG_FILES) {
    const fullPath = resolve(process.cwd(), name);
    if (existsSync(fullPath)) {
      return parseConfigFile(fullPath);
    }
  }

  return null;
}

/** Parse a JSON config file */
function parseConfigFile(filePath: string): Partial<MgcheckConfig> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Partial<MgcheckConfig>;
  } catch (err) {
    throw new Error(`Failed to parse config file ${filePath}: ${(err as Error).message}`);
  }
}

/** Apply environment variables to config */
function applyEnvVars(config: MgcheckConfig): MgcheckConfig {
  const result = structuredClone(config);

  if (process.env.MGCHECK_DB_URL) {
    result.shadowDb.dbUrl = process.env.MGCHECK_DB_URL;
  }

  if (process.env.MGCHECK_DOCKER_IMAGE) {
    result.shadowDb.dockerImage = process.env.MGCHECK_DOCKER_IMAGE;
  }

  if (process.env.MGCHECK_PROVIDER) {
    const provider = process.env.MGCHECK_PROVIDER;
    if (provider === 'docker' || provider === 'pglite') {
      result.shadowDb.provider = provider;
    }
  }

  // v1: LLM config
  if (process.env.MGCHECK_LLM_PROVIDER || process.env.MGCHECK_LLM_API_KEY) {
    result.llm = {
      provider: process.env.MGCHECK_LLM_PROVIDER || 'openai',
      model: process.env.MGCHECK_LLM_MODEL || 'gpt-4o',
      apiKey: process.env.MGCHECK_LLM_API_KEY || '',
      maxFixAttempts: 1,
    };
  }

  return result;
}

/** Deep merge two config objects, b takes precedence */
function mergeConfig(a: MgcheckConfig, b: Partial<MgcheckConfig>): MgcheckConfig {
  const result = structuredClone(a);

  if (b.shadowDb) {
    Object.assign(result.shadowDb, b.shadowDb);
  }

  if (b.rules) {
    Object.assign(result.rules, b.rules);
  }

  if (b.output) {
    Object.assign(result.output, b.output);
  }

  if (b.confirmDestructive !== undefined) {
    result.confirmDestructive = b.confirmDestructive;
  }

  if (b.llm) {
    result.llm = { ...result.llm, ...b.llm };
  }

  return result;
}

/**
 * Get the effective severity for a rule, considering config overrides.
 * Returns null if the rule is disabled ('off').
 */
export function getRuleSeverity(
  ruleId: string,
  defaultSeverity: RuleSeverity,
  config: MgcheckConfig
): RuleSeverity | null {
  const override = config.rules[ruleId];
  if (override === 'off') return null;
  if (override === 'error' || override === 'warning') return override;
  return defaultSeverity;
}
