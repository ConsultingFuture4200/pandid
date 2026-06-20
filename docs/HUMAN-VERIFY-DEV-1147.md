# HUMAN-VERIFY — DEV-1147: MCP OAuth provider + token issuance (🔴)

> **This task is human-gated. The agent built the OAuth provider + token
> issuance/validation and its automated tests; it CANNOT self-certify done.**
> Completing the verification below requires a human with Claude Desktop driving
> the real OAuth click-through. Do not mark DEV-1147 done until every step passes.

## What the agent built (automatable, already green)

- `lib/mcp-oauth/` — the OAuth 2.0 authorization-code + PKCE provider:
  - `types.ts` — domain types + Zod boundary schemas (account-scoped tokens,
    PKCE S256, single `mcp` scope).
  - `tokens.ts` — opaque token/code generation, SHA-256 hashing, expiry, PKCE
    S256 compute + verify.
  - `service.ts` — `OAuthService`: `authorize` (mint single-use code bound to the
    logged-in account), `exchangeToken` (authorization_code + refresh_token,
    PKCE-verified), `resolveAccessToken` (validate bearer → account principal).
  - `repository.ts` / `in-memory-repository.ts` — persistence interface + test
    double. Postgres-backed impl is wired where the pool lives (DEV-1135 pattern).
  - `resolve-principal.ts` — `Authorization: Bearer` → account principal; the
    seam DEV-1145's `ContextResolver` and DEV-1149's active-diagram scoping
    consume (kept here so this task does not edit their files).
  - `metadata.ts` — RFC 8414 / RFC 9728 discovery documents.
- `app/api/mcp/oauth/authorize/route.ts` — GET authorization endpoint (requires
  web login, redirects to `/login?next=...` if not).
- `app/api/mcp/oauth/token/route.ts` — POST token endpoint (form-encoded,
  public client + PKCE).
- `app/.well-known/oauth-authorization-server/route.ts` and
  `app/.well-known/oauth-protected-resource/route.ts` — discovery metadata.
- `db/migrations/0003_mcp_oauth.{up,down}.sql` — `oauth_clients`,
  `oauth_authorization_codes`, `oauth_tokens` tables (account-scoped, hashed).

Automated coverage (`pnpm vitest run lib/mcp-oauth`, 34 tests, green):
code issuance, PKCE pass/fail, redirect_uri/client mismatch, single-use code,
expiry, refresh-token exchange, account scoping (two accounts → distinct
principals), refresh-token-not-usable-as-access-token, bearer-header parsing,
discovery metadata shape.

## Preconditions before the human walkthrough

1. **Public HTTPS deployment.** Claude Desktop custom connectors call the server
   **from Anthropic's cloud, not localhost** (CLAUDE.md fact #3). Deploy to a
   public HTTPS origin (e.g. the staging host). No localhost path exists.
2. **Postgres reachable + migrated.** `DATABASE_URL` set, then `pnpm migrate:up`
   (applies `0003_mcp_oauth`). The agent could not run this — `DATABASE_URL` was
   not set in the build environment. Confirm the three `oauth_*` tables exist.
3. **A registered client exists.** This task does NOT implement Dynamic Client
   Registration — that is **DEV-1148**. Until DEV-1148 lands, either:
   - complete DEV-1148 first (Desktop will auto-register via DCR), **or**
   - manually insert one row into `oauth_clients` for the test:
     `INSERT INTO oauth_clients (client_id, redirect_uris) VALUES
      ('<id>', ARRAY['https://claude.ai/api/mcp/auth_callback']);`
     (use the exact redirect URI Desktop presents — read it from the server logs
     on the first `/authorize` hit).
4. **Web login works** (DEV-1134) and you can log into the app in the same
   browser Desktop will hand the OAuth redirect to.

### ⚠️ Known integration gap to clear first (surfaced, not crossed)

The `/authorize` endpoint sends an unauthenticated human to
`/login?next=<authorize-url>` so they return to the authorization step after
signing in. **The current login page (DEV-1134) ignores `next` and always
redirects to `/dashboard`.** Editing that page belongs to DEV-1134/onboarding
(DEV-1154), not this task, so it was left untouched. Before the walkthrough,
ensure the human is **already logged in** in the browser (so `/authorize` skips
the login redirect), OR have DEV-1134/DEV-1154 honor `?next=`. This is the one
cross-task wire-up the OAuth flow depends on.

## Human walkthrough (Claude Desktop)

1. In Claude Desktop, open **Settings → Connectors** (NOT
   `claude_desktop_config.json` — Desktop silently strips remote URLs from the
   config file; CLAUDE.md hard boundary).
2. **Add custom connector.** Enter the MCP server URL:
   `https://<your-host>/api/mcp`.
3. Desktop fetches `/.well-known/oauth-protected-resource` →
   `/.well-known/oauth-authorization-server`, then opens the **OAuth sign-in**
   in your browser, landing on `/api/mcp/oauth/authorize?...`.
4. **Expected:** because you are logged into the web app, the authorize endpoint
   immediately 302-redirects back to Desktop's `redirect_uri` with a `code`
   (+ `state`). If you were not logged in, you hit `/login` first (see gap above).
5. Desktop's back-channel POSTs `/api/mcp/oauth/token` with the code + PKCE
   `code_verifier`. **Expected:** a `200` with `access_token`, `refresh_token`,
   `token_type: Bearer`, `expires_in: 3600`, `scope: mcp`.
6. The connector now shows **Connected**. Confirm in the server logs that an
   `oauth_tokens` row of `kind='access'` was created, scoped to YOUR `account_id`.

## Pass criteria (all must hold)

- [ ] Connector reaches **Connected** state in Desktop via Settings → Connectors.
- [ ] Token endpoint returned a Bearer access + refresh token (HTTP 200).
- [ ] The issued access token's `account_id` matches the logged-in account
      (account-scoped pairing — PRD §4, FR-6).
- [ ] A subsequent MCP request carrying `Authorization: Bearer <access_token>`
      resolves to that account (verifiable once DEV-1149 wires the resolver;
      `resolveOAuthPrincipal` is the function it calls).
- [ ] An MCP request with **no**/garbage/expired token is refused
      (deny-by-default — the MCP server already does this).

## Negative checks (recommended)

- [ ] Tampering with the `code` or replaying it after redemption → token endpoint
      returns `invalid_grant` (HTTP 400).
- [ ] A `code_verifier` that does not match the `code_challenge` → `invalid_grant`.
- [ ] A `redirect_uri` not on the client allow-list at `/authorize` →
      `invalid_request`, and **no redirect** to the unverified URI.

## Hand-off

When all pass criteria are met, a human (not an agent) moves DEV-1147 to Done in
Linear. DEV-1148 (DCR + 401 re-registration) and DEV-1149 (account → active
diagram scoping) build on this; DEV-1148 in particular replaces the manual
`oauth_clients` insert above with real Dynamic Client Registration.
