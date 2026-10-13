import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getGlobalLogDir, findProjectRoot } from './activity-log.js';

export type ApprovalMode = 'auto' | 'manual';
export type SafeRiskLevel = 'low' | 'medium';
export type ApprovalSource = 'env' | 'project' | 'global' | 'default';

export interface ApprovalModeConfig {
  mode: ApprovalMode;
  autoApprove: SafeRiskLevel[];
  source: ApprovalSource;
}

const CONFIG_FILES = [
  '.mgcheckrc.json',
  '.mgcheckrc.yml',
  '.mgcheckrc',
  'mgcheck.config.json',
];

/**
 * Validates autoApprove levels.
 * "high" must NEVER be auto-approved under any configuration.
 */
export function validateAutoApproveLevels(levels: unknown): SafeRiskLevel[] {
  if (!Array.isArray(levels)) {
    throw new Error('autoApprove must be an array of risk levels.');
  }

  const validated: SafeRiskLevel[] = [];
  for (const item of levels) {
    const normalized = String(item).trim().toLowerCase();
    if (normalized === 'high') {
      throw new Error('Risk level "high" can never be auto-approved.');
    }
    if (normalized === 'low' || normalized === 'medium') {
      if (!validated.includes(normalized)) {
        validated.push(normalized);
      }
    } else {
      throw new Error(`Invalid risk level "${item}" in autoApprove.`);
    }
  }

  return validated;
}

/**
 * Normalizes and validates an approval mode string.
 * If invalid, logs a warning to stderr (never stdout) and returns null.
 */
function parseMode(raw: unknown, sourceDesc: string): ApprovalMode | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'manual') {
    return normalized;
  }
  process.stderr.write(
    `[mgcheck] Warning: Invalid approval mode "${raw}" in ${sourceDesc}. Falling back to "manual".\n`
  );
  return null;
}

/**
 * Determines default autoApprove levels for a given mode.
 * - auto mode: ['low', 'medium']
 * - manual mode: ['low'] (low risk runs without prompt, medium & high require human confirmation)
 */
export function getDefaultAutoApprove(mode: ApprovalMode): SafeRiskLevel[] {
  return mode === 'auto' ? ['low', 'medium'] : ['low'];
}

/**
 * Reads the active approval mode and auto-approve risk levels.
 * Priority: env var > project config > global settings.json > default ("manual").
 * Re-read on every call (no caching).
 */
export function getApprovalMode(projectDir?: string): ApprovalModeConfig {
  // 1. Environment variables
  if (process.env.MGCHECK_MODE) {
    const parsed = parseMode(process.env.MGCHECK_MODE, 'MGCHECK_MODE');
    if (parsed) {
      let levels = getDefaultAutoApprove(parsed);
      if (process.env.MGCHECK_AUTO_APPROVE) {
        const rawLevels = process.env.MGCHECK_AUTO_APPROVE.split(',').map((s) => s.trim());
        levels = validateAutoApproveLevels(rawLevels);
      }
      return {
        mode: parsed,
        autoApprove: levels,
        source: 'env',
      };
    }
  }

  // 2. Project config
  const projectRoot = projectDir || findProjectRoot() || process.cwd();
  for (const file of CONFIG_FILES) {
    const fullPath = join(projectRoot, file);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object') {
          const rawMode = parsed.approvalMode;
          const mode = rawMode ? parseMode(rawMode, fullPath) : null;
          let autoApprove: SafeRiskLevel[] | undefined;
          if (parsed.autoApprove) {
            autoApprove = validateAutoApproveLevels(parsed.autoApprove);
          }

          if (mode) {
            return {
              mode,
              autoApprove: autoApprove ?? getDefaultAutoApprove(mode),
              source: 'project',
            };
          } else if (autoApprove) {
            return {
              mode: 'manual',
              autoApprove,
              source: 'project',
            };
          }
        }
      } catch (err) {
        if ((err as Error).message.includes('can never be auto-approved')) {
          throw err;
        }
        // Non-JSON or read error, continue
      }
    }
  }

  // 3. Global settings (~/.mgcheck/settings.json)
  const globalSettingsPath = join(getGlobalLogDir(), 'settings.json');
  if (existsSync(globalSettingsPath)) {
    try {
      const content = readFileSync(globalSettingsPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        const rawMode = parsed.approvalMode;
        const mode = rawMode ? parseMode(rawMode, globalSettingsPath) : null;
        let autoApprove: SafeRiskLevel[] | undefined;
        if (parsed.autoApprove) {
          autoApprove = validateAutoApproveLevels(parsed.autoApprove);
        }

        if (mode) {
          return {
            mode,
            autoApprove: autoApprove ?? getDefaultAutoApprove(mode),
            source: 'global',
          };
        } else if (autoApprove) {
          return {
            mode: 'manual',
            autoApprove,
            source: 'global',
          };
        }
      }
    } catch (err) {
      if ((err as Error).message.includes('can never be auto-approved')) {
        throw err;
      }
    }
  }

  // 4. Default: manual
  return {
    mode: 'manual',
    autoApprove: getDefaultAutoApprove('manual'),
    source: 'default',
  };
}

/**
 * Persist approval mode and auto-approved levels to global or project settings.
 */
export function setApprovalMode(options: {
  mode?: ApprovalMode;
  autoApprove?: SafeRiskLevel[];
  project?: boolean;
  projectDir?: string;
}): { mode: ApprovalMode; autoApprove: SafeRiskLevel[]; filePath: string } {
  if (options.mode && options.mode !== 'auto' && options.mode !== 'manual') {
    throw new Error(`Invalid mode "${options.mode}". Expected "auto" or "manual".`);
  }

  if (options.autoApprove) {
    validateAutoApproveLevels(options.autoApprove);
  }

  const current = getApprovalMode(options.projectDir);
  const targetMode = options.mode ?? current.mode;
  const targetLevels = options.autoApprove ?? (options.mode ? getDefaultAutoApprove(targetMode) : current.autoApprove);

  // Validate that "high" is never accepted
  validateAutoApproveLevels(targetLevels);

  let targetFile: string;

  if (options.project) {
    const projectRoot = options.projectDir || findProjectRoot() || process.cwd();
    targetFile = join(projectRoot, '.mgcheckrc.json');
  } else {
    const globalDir = getGlobalLogDir();
    if (!existsSync(globalDir)) {
      mkdirSync(globalDir, { recursive: true });
    }
    targetFile = join(globalDir, 'settings.json');
  }

  let existingData: Record<string, any> = {};
  if (existsSync(targetFile)) {
    try {
      existingData = JSON.parse(readFileSync(targetFile, 'utf-8'));
    } catch {
      existingData = {};
    }
  }

  existingData.approvalMode = targetMode;
  existingData.autoApprove = targetLevels;

  writeFileSync(targetFile, JSON.stringify(existingData, null, 2) + '\n', 'utf-8');

  return {
    mode: targetMode,
    autoApprove: targetLevels,
    filePath: targetFile,
  };
}
