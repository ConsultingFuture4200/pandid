# HUMAN-VERIFY — DEV-1148 DCR + 401 re-registration (🔴 HUMAN)

> Status: **automatable parts complete; 🔴 human verification pending.**
> DEV-1148 is a 🔴 `loop:human` task. The agent built the RFC 7591 Dynamic
> Client Registration endpoint, the registered-client store (behind a repository
> interface), and the RFC 6749 §5.2 `invalid_client` 401 re-registration
> primitive that the token endpoint calls. The final acceptance — **Claude
> Desktop completes a live DCR round-trip while adding the connector**, and a
> **deleted client triggers a real re-registration** — is something no agent can
> perform. The loop **STOPS** here. Do NOT self-certify this task as done.

This task is `risk:platform`: custom-connector DCR behavior is beta on consumer
plans and Anthropic has changed connector/OAuth rules repeatedly in 2026 (PRD §9
risk row). The transport stays isolated so the API-key fallback remains additive.

---

## Dependency note for the orchestrator (read first)

DEV-1148 is `blockedBy` **DEV-1147** (OAuth provider + token issuance). At the
time this was built, DEV-1147 was **not yet merged to `master`** — a concurrent
agent was building it in `lib/mcp-oauth/` (untracked). Per CLAUDE.md operating
principle #8, this task did not touch that work.

**Boundary that was held:** DEV-1148 owns *registration* and the
*client-validity primitive*; DEV-1147 owns the *authorize + token endpoints* and
*token issuance*. The single coupling point is the 401 contract:

- DEV-1148 exposes `DcrService.assertClientValid(clientId)` →
  returns the registered client, or throws `OAuthError.invalidClient` (HTTP 401,
  `error: "invalid_client"`).
- DEV-1147's **token endpoint must call `assertClientValid` and render the
  thrown 401 on the wire** (it must not swallow it). That 401 is the signal
  Claude Desktop reads to re-register.

**Integration step (do at the batch join barrier):** when DEV-1147 lands, wire
its token endpoint to import `assertClientValid` from `@/lib/oauth` and surface
the 401. Until that wiring exists, Part C below (the live re-registration loop)
cannot be exercised end-to-end — only the registration endpoint (Part A/B) can.

The two modules use different directories (`lib/oauth` here vs `lib/mcp-oauth`
for DEV-1147) and share no files, so the task-graph file-ownership rule holds.
If the orchestrator prefers a single OAuth directory, that consolidation is a
follow-up refactor — not part of this task's scope.

---

## What WAS delivered (DEV-1148-owned files only)

- `lib/oauth/types.ts` — RFC 7591 registration request/response schemas
  (Zod-at-all-boundaries), the `OAuthClientRecord` store shape, and `OAuthError`
  with the `invalid_client` (401) / `invalid_client_metadata` (400) /
  `invalid_redirect_uri` (400) contract. `OAuthError.invalidClient()` is the
  single constructor for the re-registration signal.
- `lib/oauth/client-repository.ts` — `OAuthClientRepository` interface
  (`createClient` / `findByClientId` / `deleteByClientId`). A `null` from
  `findByClientId` is what becomes the 401.
- `lib/oauth/in-memory-client-repository.ts` — test double / dev stand-in.
- `lib/oauth/dcr.ts` — `DcrService`:
  - `register(input)` — validate metadata, mint `client_id` (+ secret for
    confidential clients; **none** for public/PKCE clients), persist, return the
    RFC 7591 §3.2.1 response. Secret is stored **hashed only** (SHA-256), and
    returned in plaintext exactly once.
  - `assertClientValid(clientId)` — the 401 re-registration primitive the token
    endpoint calls.
  - `deleteClient(clientId)` — revoke a registration (the deletion arm of the
    re-registration contract).
- `lib/oauth/index.ts` — public surface + process-wide
  `getOAuthClientRepository()` / `getDcrService()`. Refuses the in-memory store
  in production (canonical state is never a forgetful map).
- `app/api/oauth/register/route.ts` — public-internet HTTPS `POST /oauth/register`
  (RFC 7591 §3.1). 201 + credentials on success; RFC-shaped `{error,
  error_description}` body on failure; `WWW-Authenticate` set on the 401 case;
  `cache-control: no-store` so credentials are never cached.
- `db/migrations/0003_oauth_clients.up.sql` / `.down.sql` — the `oauth_clients`
  store (account-agnostic at registration time, per RFC 7591).
- `lib/oauth/dcr.test.ts` — 18 tests (registration happy paths, public vs
  confidential, secret-hash-only persistence, metadata/redirect/grant validation
  errors, and the full 401 invalid_client + delete-then-re-register contract).

Acceptance criteria (Linear DEV-1148):

- [x] DCR registration endpoint — `app/api/oauth/register/route.ts` + `DcrService.register`.
- [x] 401 invalid_client triggers re-register — `DcrService.assertClientValid`
      + `OAuthError.invalidClient` (401, `WWW-Authenticate` on the route). The
      **token-endpoint wiring** that surfaces it on the wire is DEV-1147's; see
      the dependency note.
- [x] `pnpm test` for the automatable parts — `lib/oauth/dcr.test.ts` (18 passed).
- [ ] **HUMAN-VERIFY updated** — this file. (Live Desktop round-trip below: human.)

## Automated gate (agent-runnable portion — green)

```
npx eslint lib/oauth app/api/oauth      # clean
npx tsc --noEmit                         # clean for this task's files (see note)
npx vitest run lib/oauth                 # 18 passed
```

> Note on `tsc`/`pnpm test`: at build time the working tree also held a
> concurrent agent's untracked `lib/mcp-oauth/` (DEV-1147) in a mid-write state,
> and the workflow harness carries vendored `*.test.ts` under `.claude/worktrees/`.
> Both are pre-existing environmental noise from concurrent work, not in any
> DEV-1148-owned path. Typecheck is green when scoped to this task's files
> (verified by stashing the sibling dir and re-running `tsc --noEmit`).

---

## Why this is human-gated (cannot be automated)

DCR is a protocol round-trip **performed by Claude Desktop from Anthropic's
cloud** during connector add (CLAUDE.md critical fact #3). No test the agent can
run proves that Desktop:

1. discovered the registration endpoint and POSTed valid client metadata,
2. stored the issued `client_id`, completed OAuth, and called a tool, and
3. **re-registered automatically** after the server returned 401 invalid_client
   for a deleted client.

Two hard constraints (same as DEV-1145/1147):

- The endpoints must be **public-internet HTTPS**. There is no localhost path —
  Desktop calls from Anthropic's cloud.
- Desktop reaches remote MCP **only via Settings → Connectors**, never via
  `claude_desktop_config.json` (it silently strips remote URLs) — CLAUDE.md
  "What this is NOT" / PRD FR-22.

The endpoints must be deployed to a public HTTPS URL. Call it
`https://<your-app-domain>` below; the registration endpoint is
`https://<your-app-domain>/oauth/register` and the MCP endpoint is
`https://<your-app-domain>/api/mcp`.

---

## Part A — verify registration over raw HTTP (no Desktop)

Run against the deployed public URL (or `http://localhost:3000` to confirm the
handler locally — Desktop itself cannot use localhost).

1. **Register a confidential client:**
   ```
   curl -i -s -X POST https://<your-app-domain>/oauth/register \
     -H 'content-type: application/json' \
     -d '{"redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"client_name":"Manual Test"}'
   ```
   Expect: **HTTP 201**, `cache-control: no-store`, and a JSON body with
   `client_id`, `client_secret`, `client_id_issued_at`,
   `redirect_uris`, `grant_types:["authorization_code"]`,
   `response_types:["code"]`, `token_endpoint_auth_method:"client_secret_basic"`.
   Record the `client_id` for Part C.

2. **Register a public (PKCE) client — no secret:**
   ```
   curl -i -s -X POST https://<your-app-domain>/oauth/register \
     -H 'content-type: application/json' \
     -d '{"redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"token_endpoint_auth_method":"none"}'
   ```
   Expect: **HTTP 201** with **no** `client_secret` field.

3. **Reject bad metadata:**
   ```
   curl -i -s -X POST https://<your-app-domain>/oauth/register \
     -H 'content-type: application/json' -d '{"client_name":"no uris"}'
   ```
   Expect: **HTTP 400**, body `{"error":"invalid_redirect_uri","error_description":"..."}`.

**Part A passes if:** step 1 returns 201 + a secret, step 2 returns 201 with no
secret, step 3 returns 400 invalid_redirect_uri.

---

## Part B — add the connector in Claude Desktop (after DEV-1147 token endpoint lands)

> Requires DEV-1147 (OAuth authorize/token) + DEV-1149 (active-diagram scoping)
> deployed to the public URL, with the token endpoint wired to
> `assertClientValid` (see dependency note).

1. In the web app: log in, open/create a diagram so the account has an **active
   diagram** (the connector is account-scoped — PRD §3 step 2).
2. **Claude Desktop → Settings → Connectors** (NOT the config file).
3. **Add custom connector** → enter `https://<your-app-domain>/api/mcp`.
4. Desktop performs **Dynamic Client Registration** against `/oauth/register`,
   then the OAuth sign-in. Approve with the account that owns the active diagram.
5. Confirm the connector reaches **Connected** and Desktop lists the tools.

**Part B passes if:** the connector reaches Connected — which means Desktop's DCR
round-trip succeeded and the issued `client_id` was accepted through the OAuth
flow.

---

## Part C — verify 401 re-registration (the core of this task)

> This is the acceptance that is unique to DEV-1148. It proves a deleted client
> produces the 401 signal and that Desktop re-registers. Requires Part B working.

1. With the connector **Connected** (Part B), find the `client_id` Desktop
   registered. Either read it from the `oauth_clients` table (most recent row),
   or use the `client_id` you recorded in Part A if you are exercising the
   contract by hand.

2. **Delete (revoke) that client** server-side. Either:
   - via the DB: `DELETE FROM oauth_clients WHERE client_id = '<client_id>';`, or
   - via a `DcrService.deleteClient(clientId)` call from an admin path if one is
     wired.

3. **Confirm the token endpoint now returns 401 invalid_client** for the deleted
   client. With DEV-1147's token endpoint deployed, a token/refresh attempt for
   that `client_id` must return **HTTP 401** with body
   `{"error":"invalid_client", ...}` and a `WWW-Authenticate` header. (If you are
   exercising only DEV-1148, assert this by calling `assertClientValid` from a
   test/REPL: it throws `OAuthError` with `code:"invalid_client"`,
   `httpStatus:401`.)

4. **Trigger Desktop to use the connector again** (ask Claude to read the
   diagram). On receiving the 401 invalid_client, Desktop should **automatically
   re-register** (a new `/oauth/register` call → a new `oauth_clients` row → a
   new OAuth sign-in), then complete the tool call. Watch for:
   - a **new** `oauth_clients` row appearing (a fresh `client_id`), and
   - the connector returning to **Connected** / the tool call succeeding.

**Part C passes if:** after deleting the registered client, the token endpoint
returns 401 invalid_client, **and** Desktop re-registers (new client row) and
recovers without the human re-adding the connector from scratch.

> If Desktop instead surfaces a hard error and requires a manual re-add, capture
> the exact Desktop build + behavior — connector DCR/re-registration is a beta
> surface (PRD §9). The server-side 401 contract is still correct; the fallback
> is the API-key chat panel (isolated transport seam).

---

## Reviewer checklist

- [ ] Registration endpoint is **public HTTPS**; `cache-control: no-store` on
      every credential-bearing response.
- [ ] Client secret is **stored hashed only**; raw secret returned exactly once.
- [ ] `assertClientValid` throws **401 invalid_client** for unknown/deleted
      clients; the token endpoint (DEV-1147) **surfaces** it (does not swallow).
- [ ] All DCR code stays under `lib/oauth/` + `app/api/oauth/` — no MCP/OAuth
      assumption leaked into canvas/app code (CLAUDE.md fact #4); §9 fallback
      stays additive.
- [ ] DCR never mints access tokens (that is DEV-1147); the boundary holds.
- [ ] No file owned by DEV-1147 (`lib/mcp-oauth/`) was modified.

## Note for the orchestrator

Do not mark DEV-1148 Done from the agent run. Close it only after (a) Part A
passes, (b) the DEV-1147 token endpoint is wired to `assertClientValid` and
deployed, and (c) a human completes Parts B + C in Claude Desktop and observes a
real 401-driven re-registration. Then unblock DEV-1149 / DEV-1155.
