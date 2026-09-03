import type { Rule, ParsedStatement, RuleViolation, RuleContext } from './types.js';

/**
 * MG010: Missing down/rollback migration
 *
 * Best practice is to include a rollback migration alongside every
 * "up" migration. This allows quick recovery if a migration causes
 * problems in production.
 */
export const missingDownMigration: Rule = {
  id: 'MG010',
  name: 'missing-down-migration',
  severity: 'warning',
  description: 'No rollback/down migration detected',

  check(_statements: ParsedStatement[], context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    // Only check for frameworks that support down migrations
    // Drizzle doesn't natively support them, so skip
    if (context.format === 'drizzle') {
      return violations;
    }

    if (!context.hasDownMigration) {
      violations.push({
        ruleId: 'MG010',
        ruleName: 'missing-down-migration',
        severity: 'warning',
        message:
          'No rollback/down migration was detected. Without a rollback migration, reverting ' +
          'this change in production requires manual intervention. This is especially risky ' +
          'for schema changes that are difficult to reverse (e.g., column type changes).',
        line: 1,
        sql: '(no down migration file found)',
        suggestion:
          'Create a corresponding rollback migration:\n' +
          '• For Prisma: Add a down.sql file in the same migration directory\n' +
          '• For raw SQL: Create a corresponding *_down.sql or *_rollback.sql file\n\n' +
          'The rollback should reverse the changes made by this migration. For example:\n' +
          '  Up:   ALTER TABLE users ADD COLUMN status TEXT;\n' +
          '  Down: ALTER TABLE users DROP COLUMN status;',
      });
    }

    return violations;
  },
};
