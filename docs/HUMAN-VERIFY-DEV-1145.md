# HUMAN-VERIFY — DEV-1145 MCP server skeleton (Streamable HTTP)

> Status: **implementation complete; 🔴 human verification + review gate pending.**
> DEV-1145 is a 🔴 `loop:human` task. The agent built the Streamable HTTP MCP
> endpoint, the JSON-RPC dispatch, the tool registry, the `initialize` handshake,
> and the health check. The final acceptance — **a human adds the connector in
> Claude Desktop and confirms it connects** — is something no agent can perform.
> The loop **STOPS** here. Do NOT self-certify this task as done.

This task is also a **`gate:review`** point (EXECUTION.md): the auth chain
(DEV-1147 OAuth, DEV-1148 DCR) must not start until this skeleton is reviewed.

---

## What WAS delivered (DEV-1145-owned files only)

- `lib/claude-transport/mcp/protocol.ts` — JSON-RPC 2.0 envelope + MCP wire
  shapes: protocol version `2025-11-25`, error codes, `initialize`/`tools/list`
  result types, request schema (Zod-at-all-boundaries). SSE deliberately absent.
- `lib/claude-transport/mcp/tool-registry.ts` — `McpToolRegistry` + `McpTool`
  interface. The wiring point DEV-1146 (read tools) and DEV-1150 (propose tools)
  register into without editing this file. Unique-name guard. **Propose-only by
  construction** — no commit/mutation path (one-committer invariant).
- `lib/claude-transport/mcp/server.ts` — `McpServer`: framework-agnostic
  JSON-RPC dispatch for `initialize`, `ping`, `tools/list`, `tools/call`, and
  notifications. Ships a **deny-by-default `ContextResolver`** (no auth in the
  skeleton ⇒ `tools/call` is refused until DEV-1147/1148/1149 land). The auth
  chain swaps in a real resolver without touching dispatch.
- `lib/claude-transport/mcp/index.ts` — public surface + process-wide
  `getMcpServer()` / `getMcpToolRegistry()` singletons.
- `app/api/mcp/route.ts` — the public-internet HTTPS Streamable HTTP endpoint:
  - `GET /api/mcp` → health check (`{status, service, transport, protocolVersion}`), no auth.
  - `POST /api/mcp` → JSON-RPC handling; 202 for notifications; JSON-RPC error
    envelopes for bad JSON / bad request shape.
- `lib/claude-transport/mcp/*.test.ts` — 58 tests (protocol framing, registry,
  server dispatch, deny-by-default scoping, handshake, one-committer surface).

Acceptance criteria (Linear DEV-1145):

- [x] Streamable HTTP endpoint at `/api/mcp`, health check — `route.ts`.
- [x] Tool registry wired — `tool-registry.ts` + `getMcpToolRegistry()`; server
      lists/dispatches through it.
- [x] HUMAN-VERIFY.md with exact Desktop connector-add steps — **this file.**
- [ ] **Review gate before auth chain (DEV-1147+)** — human/lead sign-off.
- [ ] **Live connect from Claude Desktop** — human action, steps below.

## Automated gate (agent-runnable portion — green)

```
pnpm lint        # clean
pnpm typecheck   # clean
npx vitest run lib/claude-transport   # 58 passed
```

> Note on `pnpm test`: the full run currently also traverses an untracked
> harness artifact at `.claude/worktrees/wf_8407ea17-36f-2/` that carries its own
> `node_modules` (180 of zod's internal `*.test.ts` files). Those 52 failures are
> pre-existing environmental noise from the workflow harness, unrelated to this
> task, and are not in any DEV-1145-owned path. Scope the run to
> `lib/claude-transport` (above) to see this task's suite green.

---

## Why this is human-gated (cannot be automated)

A custom connector is added through **Claude Desktop's UI**, and Desktop calls
the MCP server **from Anthropic's cloud, not from localhost** (CLAUDE.md critical
fact #3). No test the agent can run proves a human completed the Desktop
connector-add and saw it connect. Two further hard constraints:

1. The endpoint must be **public-internet HTTPS**. There is no localhost path.
2. Desktop reaches remote MCP **only via Settings → Connectors**, never via
   `claude_desktop_config.json` (it silently strips remote URLs there) — see
   CLAUDE.md "What this is NOT" and PRD FR-22.

---

## Pre-req before the human steps

The skeleton has **no auth yet** (OAuth is DEV-1147, DCR is DEV-1148). What a
human can verify against the skeleton *today* depends on how far the chain has
landed:

- **Skeleton only (DEV-1145 in isolation):** verify the transport + health +
  handshake + tool-listing over raw HTTP (Part A). A real Claude Desktop
  connector-add will reach the `initialize`/`tools/list` handshake but `tools/call`
  is refused (deny-by-default) until the auth chain lands — that refusal is
  correct, expected behavior for the skeleton.
- **After DEV-1147/1148/1149 land:** the full Desktop connector-add + OAuth +
  live tool call (Part B) becomes verifiable.

The endpoint must be deployed to a **public HTTPS URL** for any Desktop test.
Call it `https://<your-app-domain>` below; the MCP endpoint is
`https://<your-app-domain>/api/mcp`.

---

## Part A — verify the transport now (raw HTTP, no Desktop, no auth)

Run these against the deployed public URL (or `http://localhost:3000` if you only
need to confirm the handlers locally — Desktop itself cannot use localhost).

1. **Health check:**
   ```
   curl -s https://<your-app-domain>/api/mcp
   ```
   Expect: `{"status":"ok","service":"mcp","transport":"streamable-http","protocolVersion":"2025-11-25"}`

2. **Initialize handshake:**
   ```
   curl -s -X POST https://<your-app-domain>/api/mcp \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}'
   ```
   Expect a result with `protocolVersion: "2025-11-25"`,
   `capabilities: {tools:{listChanged:false}}`, and
   `serverInfo: {name:"extraction-pid-coeditor", version:"<pkg version>"}`.

3. **List tools:**
   ```
   curl -s -X POST https://<your-app-domain>/api/mcp \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
   ```
   Expect `{"tools":[]}` for the bare skeleton, or the registered v1 tools
   (`get_active_diagram`, `add_equipment`, …) once DEV-1146/1150 have landed.

4. **A tool call is refused without auth (deny-by-default is correct):**
   ```
   curl -s -X POST https://<your-app-domain>/api/mcp \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_active_diagram"}}'
   ```
   Expect a JSON-RPC error containing "Not authorized" until the auth chain lands.

**Part A passes if:** steps 1–3 return the shapes above and step 4 is refused.

---

## Part B — add the connector in Claude Desktop (after the auth chain lands)

> Do this only once OAuth (DEV-1147) + DCR (DEV-1148) + active-diagram scoping
> (DEV-1149) are deployed to the public URL. Until then, Part B will stop at the
> sign-in step.

1. In the web app (browser): log in, open or create a diagram so the account has
   an **active diagram** (the connector is account-scoped — PRD §3 step 2).
2. Open **Claude Desktop → Settings → Connectors** (NOT
   `claude_desktop_config.json` — Desktop silently rejects remote URLs there).
3. Click **Add custom connector** (label may read "Add connector" /
   "Add custom connector" depending on the Desktop build).
4. Enter the **remote MCP URL**: `https://<your-app-domain>/api/mcp`.
   - It must be **HTTPS and public-internet reachable** — Desktop calls it from
     Anthropic's cloud, not from your machine.
5. Desktop performs the **OAuth flow** (Dynamic Client Registration + sign-in).
   Approve / sign in with the same account that owns the active diagram.
6. Confirm the connector shows **Connected** and that Desktop lists the tools
   (it issues `initialize` then `tools/list` — you should see the v1 tools).
7. In a Desktop chat, ask Claude to read the diagram (e.g. *"What's on my active
   diagram?"*). Claude calls `get_active_diagram`; you should get structured
   state + an SVG snapshot back (FR-9).
8. (Full Phase-2 loop — verified later under DEV-1155, not required to close this
   gate) Ask Claude to *"add a CRC column and connect it"*; confirm a **pending
   proposal** appears on the browser canvas and that **you** accept it there.
   The human is the sole committer (CLAUDE.md) — Claude never commits.

**Part B passes if:** the connector reaches **Connected**, Desktop lists the
tools, and a read tool returns diagram state. (The accept-a-live-proposal step is
formally graded at the DEV-1155 / Phase-2 exit gate.)

---

## Reviewer checklist (gate:review — before DEV-1147 starts)

- [ ] Transport is **Streamable HTTP only**; no SSE anywhere.
- [ ] Endpoint is reachable as **public HTTPS** (localhost is not an option).
- [ ] All Claude-transport code stays under `lib/claude-transport/` — no MCP
      assumption leaked into app/canvas code (CLAUDE.md critical fact #4), so the
      §9 API-key fallback stays additive.
- [ ] Server exposes **no commit/accept/apply** method (one committer).
- [ ] `tools/call` is **deny-by-default** until the auth chain lands; the
      `ContextResolver` seam is the only place auth gets injected.
- [ ] Tool registry is the single wiring point for DEV-1146 / DEV-1150 (no other
      task needs to edit server/route to add a tool).

## Note for the orchestrator

Do not mark DEV-1145 Done from the agent run. Close it only after (a) the
reviewer checklist is signed off and (b) a human completes the Part A transport
check (and Part B once the auth chain is deployed). Then unblock DEV-1147.
