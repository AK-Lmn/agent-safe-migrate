-- Safe migration: Add a nullable column with a default
-- This should pass all checks

ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';
