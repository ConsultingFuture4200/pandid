# CLAUDE.md — Extraction P&ID Co-Editor

> Governing context for Claude Code agents building this project.
> **Read this fully before any task.** Spec: `docs/PRD_extraction-pid-coeditor_v0.1.0.md`. Task graph: `docs/TASK_GRAPH_v0.1.0.md`.

## What this is

A hosted, multi-tenant web app with a live Excalidraw canvas for designing hemp/hydrocarbon **extraction-equipment** P&ID-style diagrams. The app **also exposes its own remote Streamable HTTP MCP server**, which the user adds to their **Claude Desktop** as a custom connector. The human draws in the browser; Claude (in their Desktop) **proposes** changes via MCP tools; the human **accepts/rejects** in the browser. A deterministic validator gates every commit.

This is **"Path C"**: web app owns the canvas + exposes MCP; Claude Desktop drives it; inference is subscription-covered (no API key).

## What this is NOT (hard boundaries — do not cross)

- **NOT** a certified/stamped engineering tool. Resembles ISA-5.1, never claims PE/permit validity.
- **NOT** autonomous-Claude. Claude **never commits** to the canvas. Propose-and-confirm only — the human is the sole committer. Any code path where an MCP tool mutates canonical diagram state without human acceptance is a bug.
- **NOT** process-aware in v1. The validator checks **connectivity/structure only** (ports bind, no orphans, unique tags, required attributes present). Process-topology rules ("CRC column must be downstream of extraction") are **v2**, behind the validator interface — do not implement them now.
- **NOT** real-time multi-human. One human + Claude advisor per diagram.
- **NOT** configured via `claude_desktop_config.json`. Desktop reaches remote MCP **only** through Settings → Connectors. Never write onboarding docs that put a remote URL in the config file — Desktop silently strips it.

## Stack constraints

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js 16.x (App Router) | Turbopack default; `ssr:false` for Excalidraw mount |
| Language | TypeScript (strict) | No `any` in committed code |
| UI | React 19, Tailwind | — |
| Canvas | `@excalidraw/excalidraw` | Programmatic: `convertToExcalidrawElements` → `updateScene`; read via `onChange` |
| DB | Postgres | Migrations versioned in `db/migrations` |
| Realtime | WebSocket | Server-authoritative; whole-scene broadcast + in-progress-edit guard |
| MCP | Streamable HTTP transport (protocol 2025-11-25), OAuth + DCR | SSE is deprecated — do not use it |
| Validation | Zod at all boundaries | — |
| Test | Vitest (unit/integration) + Playwright (E2E) + visual-diff harness for canvas | — |
| Package mgr | pnpm | — |

## Critical implementation facts (learned, do not re-derive)

1. **`convertToExcalidrawElements` drops `customData`.** Equipment metadata (tag, type, attributes) MUST live in a parallel store keyed by element `id` (table `element_metadata`). Never rely on `customData` to persist metadata.
2. **Excalidraw must mount client-side only** (`dynamic(..., { ssr:false })`). It will crash under SSR.
3. **Desktop custom connectors call your server from Anthropic's cloud**, not localhost. The MCP endpoint must be public-internet HTTPS. No localhost-only path exists.
4. **The MCP transport is the platform risk.** Custom connectors are beta on consumer plans and Anthropic has changed automation rules repeatedly in 2026. Per spec §9, isolate all Claude-transport code behind an interface (`lib/claude-transport/`) so an API-key chat-panel fallback is additive, not a rewrite. Do not scatter MCP-specific assumptions through the app.

## Architecture invariants (every task upholds these)

- **Server is the single source of truth** for diagram state. Browser canvas and MCP tools are both clients of canonical Postgres state. They must never diverge.
- **One committer.** All mutations — manual or accepted-proposal — pass through the same commit pipeline and the same validator. No second path.
- **Proposals are staged, never applied.** MCP propose-tools create `Proposal` rows; only human acceptance (re-validated) commits.
- **Validator behind an interface.** `lib/validator/` exposes a stable interface; v1 implements connectivity rules; v2 adds domain rules without touching callers.
- **Versions are immutable.** Each save = new `diagram_version` row. Never mutate a prior version.

## Code standards

- **Files:** kebab-case. **Types:** PascalCase. **Functions/vars:** camelCase.
- **Errors:** typed Result/throw at boundaries; never swallow. User-facing errors say what happened + how to fix (per spec writing guidance).
- **No two tasks edit the same file** (task-graph rule). If you find yourself editing another task's file, stop — the boundary is wrong.
- **Tests-first** for: validator (task 4), arrow-binding (10a/b), proposal lifecycle (18), sync guard (12b). These are the high-blast-radius primitives.
- **Imports:** `@/*` alias. ES modules.

## Execution model (Ralph loop + fan-out)

Read `docs/TASK_GRAPH_v0.1.0.md` for the full graph. Key rules:

- **Batches = parallelism unit.** Fan out subagents within a batch; join before the next batch.
- **Loop-closability tags are binding:**
  - 🟢 **LOOP** — autonomous; loop until `pnpm test && pnpm lint && pnpm typecheck` green.
  - 🟡 **LOOP+SNAP** — needs visual-diff harness vs golden SVG/screenshot. Build the harness before 🟡 tasks.
  - 🔴 **HUMAN** — requires a human in Claude Desktop (OAuth, connector add, accept a live proposal). **The loop MUST STOP, write `HUMAN-VERIFY.md` with exact steps, and hand off. Never self-certify a 🔴 task.**
- **🔴 tasks:** 14, 15a/b/c, 22, 25 (the Phase-2 auth chain + onboarding + Claude-loop E2E). A loop that doesn't stop here will spin forever or fake success.
- **Review gates** (pause for human/lead approval before dependents): after task 4 (validator), 12b (sync guard), 14 (MCP skeleton), 18 (proposal lifecycle).
- **Phase gates** (hard stop, all exit criteria green): task 24 (Phase 1 / SC-1), task 25 (Phase 2 / SC-2,3), Batch 12 (v1 / §3 end-to-end).

## Definition of done (per task)

- [ ] Acceptance criteria in the task all pass.
- [ ] `pnpm test && pnpm lint && pnpm typecheck` green.
- [ ] No file owned by another task was modified.
- [ ] 🟡: rendered output matches golden within tolerance.
- [ ] 🔴: `HUMAN-VERIFY.md` written; loop halted; NOT self-marked done.
- [ ] Architecture invariants (above) upheld.

## Directory layout

```
app/                Next.js App Router routes + server actions
  (canvas)/         the editor UI
  api/mcp/          MCP Streamable HTTP endpoint
components/         React components (canvas, palette, proposal-review)
lib/
  validator/        validation interface + connectivity rules (domain = v2)
  claude-transport/ isolated MCP transport (fallback seam)
  symbols/          extraction-equipment symbol definitions + required attrs
  diagram/          canonical state, commit pipeline, versioning
  metadata/         parallel element-id-keyed metadata store
  proposals/        proposal lifecycle (stage/accept/reject)
db/migrations/      Postgres migrations
test/
  golden/           golden SVG/screenshot fixtures for 🟡 tasks
docs/               PRD, task graph, decision records, HUMAN-VERIFY notes
```

## When unsure

Trace the question to the PRD section. If the PRD is silent, **stop and ask** — do not guess and do not invent process-domain rules (those are deliberately deferred). The PRD has no open questions by design; if you find one, it's a real gap, surface it.
