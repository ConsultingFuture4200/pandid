-- DEV-1134 — Web-login auth tables (FR-20).
--
-- Owned by the auth task. The `account` table itself is owned by the schema
-- task (DEV-1132, migration 0001); this migration only adds the auth-specific
-- tables and references account(id) by foreign key. It must run after the
-- account table exists.
--
-- Credentials live in their own table (not on the account row) so the account
-- identity contract stays auth-mechanism-agnostic — the MCP OAuth path
-- (DEV-1147/1148) adds its own credential storage without touching this table.

-- One password credential per account.
CREATE TABLE IF NOT EXISTS auth_credentials (
  account_id    UUID PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  -- Login email, normalized lowercase. Unique across all accounts.
  email         TEXT NOT NULL UNIQUE,
  -- Self-describing scrypt hash: scrypt$N$r$p$saltHex$hashHex. Never plaintext.
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side sessions. The raw token lives only in the browser cookie; the
-- server stores its SHA-256 hash so a leaked row cannot be replayed.
CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  -- Hex SHA-256 of the opaque session token (64 chars). Unique per session.
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Look up sessions by account (revoke-all, listing) and prune by expiry.
CREATE INDEX IF NOT EXISTS sessions_account_id_idx ON sessions (account_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
