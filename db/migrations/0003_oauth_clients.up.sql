-- DEV-1148 — OAuth Dynamic Client Registration store (FR-21, PRD §5.6).
--
-- Owned by the DCR task. The `account` table is owned by the schema task
-- (DEV-1132, migration 0001); web-login credentials by DEV-1134 (migration
-- 0002). This migration adds only the registered-OAuth-client store, used by
-- the DCR registration endpoint and read by the token endpoint (DEV-1147).
--
-- A registered client is account-agnostic at registration time: DCR issues a
-- client_id before the user signs in (RFC 7591). The connector→account binding
-- is established later by the OAuth code flow (DEV-1147) + scoping (DEV-1149),
-- so this table intentionally has no account_id foreign key.

-- One row per registered OAuth client (RFC 7591). client_id is the public
-- identifier issued at registration; the secret is stored only as a SHA-256
-- hash (NULL for public clients using PKCE). A missing client_id at the token
-- endpoint yields 401 invalid_client → the client re-registers here.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id                          UUID PRIMARY KEY,
  -- Public OAuth client identifier. Unique across all registrations.
  client_id                   TEXT NOT NULL UNIQUE,
  -- Hex SHA-256 of the issued client secret (64 chars), or NULL for a public
  -- client (token_endpoint_auth_method = 'none'). Never the raw secret.
  client_secret_hash          CHAR(64),
  -- Allowed redirect URIs (RFC 7591). At least one; absolute URIs.
  redirect_uris               TEXT[] NOT NULL,
  client_name                 TEXT,
  grant_types                 TEXT[] NOT NULL,
  response_types              TEXT[] NOT NULL,
  token_endpoint_auth_method  TEXT NOT NULL,
  scope                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
