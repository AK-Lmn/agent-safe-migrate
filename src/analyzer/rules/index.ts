import type { Rule } from './types.js';
import { createIndexNotConcurrent } from './create-index-not-concurrent.js';
import { alterColumnType } from './alter-column-type.js';
import { addColumnNotNullNoDefault } from './add-column-not-null-no-default.js';
import { addConstraintNotValid } from './add-constraint-not-valid.js';
import { dropColumn } from './drop-column.js';
import { dropTable } from './drop-table.js';
import { renameColumn } from './rename-column.js';
import { renameTable } from './rename-table.js';
import { missingLockTimeout } from './missing-lock-timeout.js';
import { missingDownMigration } from './missing-down-migration.js';
import { truncateTable } from './truncate-table.js';
import { dropSchema } from './drop-schema.js';
import { dropDatabase } from './drop-database.js';
import { unparseableSql } from './unparseable-sql.js';

/** All built-in rules, in order */
export const ALL_RULES: Rule[] = [
  createIndexNotConcurrent,   // MG001
  alterColumnType,            // MG002
  addColumnNotNullNoDefault,  // MG003
  addConstraintNotValid,      // MG004
  dropColumn,                 // MG005
  dropTable,                  // MG006
  renameColumn,               // MG007
  renameTable,                // MG008
  missingLockTimeout,         // MG009
  missingDownMigration,       // MG010
  truncateTable,              // MG011
  dropSchema,                 // MG012
  dropDatabase,               // MG013
  unparseableSql,             // MG014
];

/** IDs of rules that flag destructive operations */
export const DESTRUCTIVE_RULE_IDS = new Set(['MG005', 'MG006', 'MG011', 'MG012', 'MG013']);

/** Get a rule by its ID */
export function getRuleById(id: string): Rule | undefined {
  return ALL_RULES.find((r) => r.id === id);
}

/** Get all rule IDs */
export function getAllRuleIds(): string[] {
  return ALL_RULES.map((r) => r.id);
}

// Re-export all rules
export {
  createIndexNotConcurrent,
  alterColumnType,
  addColumnNotNullNoDefault,
  addConstraintNotValid,
  dropColumn,
  dropTable,
  renameColumn,
  renameTable,
  missingLockTimeout,
  missingDownMigration,
  truncateTable,
  dropSchema,
  dropDatabase,
  unparseableSql,
};
