-- DEV-1147 — MCP OAuth provider tables (FR-21).
--
-- Backs the account-based pairing for the Claude Desktop custom connector: the
-- authorization-server state for an OAuth 2.0 authorization-code + PKCE flow.
-- Runs after the account table (0001) — tokens reference account(id).
--
-- Boundary with DEV-1148 (DCR): the `oauth_clients` table is defined here (the
-- provider reads it to validate /authorize and /token), but DCR owns the
-- *registration* path that INSERTs into it. No registration logic lives in this
-- migration — schema only, matching 0001/0002.
--
-- Tokens + codes are stored HASHED (sha256 hex), mirroring sessions (0002): the
-- raw values only ever leave the server in an HTTP response, so a leaked row
-- cannot be replayed.

-- A registered connector client. Populated by DCR (DEV-1148). `redirect_uris`
-- is the exact allow-list a returned authorization code may be delivered to.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     TEXT PRIMARY KEY,
  -- Exact-match redirect URI allow-list (no wildcards, OAuth 2.1).
  redirect_uris TEXT[] NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Short-lived, single-use authorization codes. Bound to the approving account
-- and the PKCE challenge. The token endpoint deletes the row on redemption.
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  -- Hex SHA-256 of the opaque code (64 chars).
  code_hash      CHAR(64) PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  -- PKCE: base64url SHA-256 of the verifier the client will present.
  code_challenge TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_authorization_codes_expires_at_idx
  ON oauth_authorization_codes (expires_at);

-- Access + refresh tokens, each scoped to exactly one account (FR-6, PRD §4).
-- `kind` distinguishes the two; `expires_at` is NULL for long-lived refresh
-- tokens (revoked by deletion, not expiry).
CREATE TABLE IF NOT EXISTS oauth_tokens (
  -- Hex SHA-256 of the opaque bearer/refresh token (64 chars).
  token_hash CHAR(64) PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id  TEXT NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  scope      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

-- Resolve/revoke by account, and prune by expiry.
CREATE INDEX IF NOT EXISTS oauth_tokens_account_id_idx ON oauth_tokens (account_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_expires_at_idx ON oauth_tokens (expires_at);
