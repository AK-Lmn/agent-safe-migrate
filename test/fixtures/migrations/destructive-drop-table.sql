-- Destructive migration: DROP TABLE
-- Should trigger MG006

DROP TABLE IF EXISTS old_sessions;
DROP TABLE legacy_audit_log;
