-- DEV-1147 — MCP OAuth provider tables (FR-21). Down migration: reverse of
-- 0003_mcp_oauth.up.sql. Drop in reverse dependency order (tokens + codes
-- reference clients). Indexes drop with their tables, listed for clarity.

DROP INDEX IF EXISTS oauth_tokens_expires_at_idx;
DROP INDEX IF EXISTS oauth_tokens_account_id_idx;
DROP TABLE IF EXISTS oauth_tokens;

DROP INDEX IF EXISTS oauth_authorization_codes_expires_at_idx;
DROP TABLE IF EXISTS oauth_authorization_codes;

DROP TABLE IF EXISTS oauth_clients;
