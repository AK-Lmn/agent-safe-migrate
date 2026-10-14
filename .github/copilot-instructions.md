<!-- MIGRATION GUARDIAN SAFETY RULES -->
## Database Migration Safety (Enforced by Migration Guardian)

When creating, modifying, or executing database migrations (SQL, Prisma, Drizzle, TypeORM, Knex, etc.):
1. **NEVER execute raw DDL or database migrations directly** on local, staging, or production databases without prior safety checks.
2. **ALWAYS use Migration Guardian (`mgcheck`)**:
   - If MCP tools are available, invoke \`check_migration\` (or \`analyze_migration\` for static analysis).
   - Alternatively, run \`npx mgcheck analyze <path>\` or \`npx mgcheck run <path> --provider pglite\` in terminal.
3. **Follow Zero-Downtime Migration Standards**:
   - \`MG001\`: Always use \`CREATE INDEX CONCURRENTLY\` instead of blocking indexes.
   - \`MG002\`: Never use \`ALTER COLUMN TYPE\` directly (use expand/contract pattern).
   - \`MG003\`: Always provide a \`DEFAULT\` value when adding \`NOT NULL\` columns.
   - \`MG004\`: Add constraints with \`NOT VALID\`, then validate them in a subsequent step.
   - \`MG005\` / \`MG006\` / \`MG011\`–\`MG013\`: Never drop columns, tables, schemas or databases, or TRUNCATE tables, without explicit user confirmation.
   - \`MG009\`: Always set \`SET lock_timeout = '5s';\` before risky DDL.
   - \`MG010\`: Provide a rollback / down migration file whenever applicable.
