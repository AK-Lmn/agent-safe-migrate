import { describe, it, expect } from 'vitest';
import { fixMigrationSql, generateDiff } from '../../src/fixer/rules-fixer.js';
import { verifyFixedSql } from '../../src/fixer/verifier.js';
import type { RuleViolation } from '../../src/core/types.js';

describe('Auto-Fixer Engine', () => {
  describe('MG001: CREATE INDEX CONCURRENTLY', () => {
    it('should rewrite CREATE INDEX to CREATE INDEX CONCURRENTLY IF NOT EXISTS', () => {
      const sql = 'CREATE INDEX idx_users_email ON users (email);';
      const violations: RuleViolation[] = [
        {
          ruleId: 'MG001',
          ruleName: 'create-index-not-concurrent',
          severity: 'error',
          message: 'locks table',
          sql,
        },
      ];

      const res = fixMigrationSql(sql, violations);
      expect(res.fixed).toBe(true);
      expect(res.fixedSql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);');
      expect(res.appliedFixes[0].ruleId).toBe('MG001');
    });

    it('should rewrite CREATE UNIQUE INDEX properly', () => {
      const sql = 'CREATE UNIQUE INDEX idx_orders_ref ON orders (ref);';
      const violations: RuleViolation[] = [
        {
          ruleId: 'MG001',
          ruleName: 'create-index-not-concurrent',
          severity: 'error',
          message: 'locks table',
          sql,
        },
      ];

      const res = fixMigrationSql(sql, violations);
      expect(res.fixed).toBe(true);
      expect(res.fixedSql).toContain('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_ref ON orders (ref);');
    });
  });

  describe('MG003: ADD COLUMN NOT NULL without DEFAULT', () => {
    it('should add safe default for boolean columns', () => {
      const sql = 'ALTER TABLE users ADD COLUMN is_active boolean NOT NULL;';
      const violations: RuleViolation[] = [
        {
          ruleId: 'MG003',
          ruleName: 'add-column-not-null-no-default',
          severity: 'error',
          message: 'missing default',
          sql,
        },
      ];

      const res = fixMigrationSql(sql, violations);
      expect(res.fixed).toBe(true);
      expect(res.fixedSql).toContain('ADD COLUMN is_active boolean DEFAULT false NOT NULL');
    });

    it('should add safe default for integer columns', () => {
      const sql = 'ALTER TABLE users ADD COLUMN points int NOT NULL;';
      const violations: RuleViolation[] = [
        {
          ruleId: 'MG003',
          ruleName: 'add-column-not-null-no-default',
          severity: 'error',
          message: 'missing default',
          sql,
        },
      ];

      const res = fixMigrationSql(sql, violations);
      expect(res.fixed).toBe(true);
      expect(res.fixedSql).toContain('ADD COLUMN points int DEFAULT 0 NOT NULL');
    });

    it('should add safe default for text columns', () => {
      const sql = 'ALTER TABLE users ADD COLUMN nickname varchar(50) NOT NULL;';
      const violations: RuleViolation[] = [
        {
          ruleId: 'MG003',
          ruleName: 'add-column-not-null-no-default',
          severity: 'error',
          message: 'missing default',
          sql,
        },
      ];

      const res = fixMigrationSql(sql, violations);
      expect(res.fixed).toBe(true);
      expect(res.fixedSql).toContain("ADD COLUMN nickname varchar(50) DEFAULT '' NOT NULL");
    });
  });

  describe('MG004: ADD CONSTRAINT without NOT VALID', () => {
    it('should append NOT VALID and add companion VALIDATE CONSTRAINT statement', () => {
      const sql = 'ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);';
      const violations: RuleViolation[] = [
        {
          ruleId: 'MG004',
          ruleName: 'add-constraint-not-valid',
          severity: 'warning',
          message: 'missing not valid',
          sql,
        },
      ];

      const res = fixMigrationSql(sql, violations);
      expect(res.fixed).toBe(true);
      expect(res.fixedSql).toContain('ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;');
      expect(res.fixedSql).toContain('ALTER TABLE orders VALIDATE CONSTRAINT fk_user;');
    });
  });

  describe('MG009: Missing lock_timeout', () => {
    it('should prepend SET lock_timeout at the top', () => {
      const sql = 'ALTER TABLE users ADD COLUMN bio text;';
      const violations: RuleViolation[] = [
        {
          ruleId: 'MG009',
          ruleName: 'missing-lock-timeout',
          severity: 'warning',
          message: 'missing lock_timeout',
          sql,
        },
      ];

      const res = fixMigrationSql(sql, violations);
      expect(res.fixed).toBe(true);
      expect(res.fixedSql.startsWith("SET lock_timeout = '5s';")).toBe(true);
    });
  });

  describe('Destructive Operations Guardrail', () => {
    it('should flag hasDestructive: true for DROP TABLE without modifying it', () => {
      const sql = 'DROP TABLE old_logs;';
      const violations: RuleViolation[] = [
        {
          ruleId: 'MG006',
          ruleName: 'drop-table',
          severity: 'error',
          message: 'destructive',
          sql,
        },
      ];

      const res = fixMigrationSql(sql, violations);
      expect(res.hasDestructive).toBe(true);
      expect(res.fixed).toBe(false);
    });
  });

  describe('Diff Generator', () => {
    it('should generate lines with + and - markers', () => {
      const orig = 'SELECT 1;';
      const fixed = 'SELECT 2;';
      const diff = generateDiff(orig, fixed);

      expect(diff).toContain('- SELECT 1;');
      expect(diff).toContain('+ SELECT 2;');
    });
  });

  describe('Shadow DB Re-Verification', () => {
    it('should successfully verify safe SQL in in-process shadow DB', async () => {
      const baseSchema = 'CREATE TABLE accounts (id serial primary key, name text);';
      const safeSql = 'ALTER TABLE accounts ADD COLUMN active boolean DEFAULT false NOT NULL;';

      const res = await verifyFixedSql(safeSql, {
        baseSchemaSql: baseSchema,
        provider: 'pglite',
      });

      expect(res.verified).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it('should fail verification if SQL has syntax error', async () => {
      const invalidSql = 'ALTER TABLE accounts INVALID SYNTAX HERE;';

      const res = await verifyFixedSql(invalidSql, {
        provider: 'pglite',
      });

      expect(res.verified).toBe(false);
      expect(res.error).toBeDefined();
    });
  });
});
