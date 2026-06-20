-- DEV-1147 — MCP OAuth provider tables (FR-21). Down migration: reverse of
-- 0004_mcp_oauth.up.sql. Drop in reverse dependency order (tokens + codes
-- reference clients). Indexes drop with their tables, listed for clarity.
--
-- `oauth_clients` is NOT dropped here: it is owned by DCR (0003_oauth_clients)
-- and dropped by that migration's down step. The runner rolls back newest-first
-- (0004 before 0003), so these FK-dependents are gone before the parent table.

DROP INDEX IF EXISTS oauth_tokens_expires_at_idx;
DROP INDEX IF EXISTS oauth_tokens_account_id_idx;
DROP TABLE IF EXISTS oauth_tokens;

DROP INDEX IF EXISTS oauth_authorization_codes_expires_at_idx;
DROP TABLE IF EXISTS oauth_authorization_codes;
