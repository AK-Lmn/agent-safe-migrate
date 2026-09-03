-- Unsafe migration: ALTER COLUMN TYPE
-- Should trigger MG002

ALTER TABLE users ALTER COLUMN age TYPE bigint;
