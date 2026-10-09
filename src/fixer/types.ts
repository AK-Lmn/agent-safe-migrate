import type { RuleViolation } from '../core/types.js';

export interface AppliedFix {
  ruleId: string;
  ruleName: string;
  description: string;
}

export interface FixResult {
  fixed: boolean;
  originalSql: string;
  fixedSql: string;
  diff: string;
  appliedFixes: AppliedFix[];
  hasDestructive: boolean;
  verified?: boolean;
  verificationError?: string;
}
