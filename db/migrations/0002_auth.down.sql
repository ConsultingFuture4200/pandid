-- DEV-1134 — Web-login auth tables (FR-20). Down migration: reverse of 0002_auth.up.sql.
-- Drop in reverse dependency order. Indexes drop with their table, but listed for clarity.

DROP INDEX IF EXISTS sessions_expires_at_idx;
DROP INDEX IF EXISTS sessions_account_id_idx;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS auth_credentials;
