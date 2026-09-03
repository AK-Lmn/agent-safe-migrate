-- Unsafe migration: CREATE INDEX without CONCURRENTLY
-- Should trigger MG001

CREATE INDEX idx_users_email ON users (email);

CREATE INDEX idx_users_name ON users (first_name, last_name);
