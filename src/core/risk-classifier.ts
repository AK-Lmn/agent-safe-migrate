import type { RuleViolation } from './types.js';

export type RiskLevel = 'high' | 'medium' | 'low';

export interface RiskClassification {
  level: RiskLevel;
  label: string;
  emoji: string;
  errorCount: number;
  warningCount: number;
}

/**
 * Classify the risk level of a migration based on its violations.
 *
 * 🔴 HIGH   — Any error-severity violation (MG001–MG006). Auto-blocked.
 * 🟡 MEDIUM — Only warning-severity violations (MG007–MG010). Requires user approval.
 * 🟢 LOW    — No violations at all. Still requires user approval.
 */
export function classifyRisk(violations: RuleViolation[]): RiskClassification {
  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;

  if (errorCount > 0) {
    return { level: 'high', label: 'HIGH RISK', emoji: '🔴', errorCount, warningCount };
  }

  if (warningCount > 0) {
    return { level: 'medium', label: 'MEDIUM RISK', emoji: '🟡', errorCount, warningCount };
  }

  return { level: 'low', label: 'LOW RISK', emoji: '🟢', errorCount: 0, warningCount: 0 };
}
