<!-- MIGRATION GUARDIAN SAFETY RULES -->
## Database Migration Safety (Enforced by Migration Guardian)

When creating, modifying, or executing database migrations (SQL, Prisma, Drizzle, TypeORM, Knex, etc.):
1. **NEVER execute raw DDL or database migrations directly** on databases without prior safety verification.
2. **Standard 3-Step AI Workflow**:
   - **Step 1 (Verify)**: Call `check_migration` (or `analyze_migration`) to test against the disposable shadow DB and AST safety rules.
   - **Step 2 (Prompt User)**: Once verified safe (0 blocking errors), ask the human user: *"Migration verified safe (0 errors). Would you like me to apply it to your database now?"*.
   - **Step 3 (Apply)**: When the user confirms "yes", call `apply_migration` with `confirm_user_approved: true` to execute the migration against their target database!
3. **Follow Zero-Downtime Migration Standards**:
   - `MG001`: Always use `CREATE INDEX CONCURRENTLY` instead of blocking indexes.
   - `MG002`: Never use `ALTER COLUMN TYPE` directly (use expand/contract pattern).
   - `MG003`: Always provide a `DEFAULT` value when adding `NOT NULL` columns.
   - `MG004`: Add constraints with `NOT VALID`, then validate them in a subsequent step.
   - `MG005` / `MG006`: Never drop columns or tables without explicit user confirmation.
   - `MG009`: Always set `SET lock_timeout = '5s';` before risky DDL.
   - `MG010`: Provide a rollback / down migration file whenever applicable.
