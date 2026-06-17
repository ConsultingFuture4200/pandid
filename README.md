# Extraction P&ID Co-Editor

A hosted, multi-tenant web app with a live Excalidraw canvas for designing
hemp/hydrocarbon extraction-equipment P&ID-style diagrams. The app exposes its
own remote Streamable HTTP MCP server, which the user adds to Claude Desktop as a
custom connector. The human draws in the browser; Claude proposes changes via MCP
tools; the human accepts/rejects in the browser. A deterministic validator gates
every commit.

> Not a certified/stamped engineering tool. Resembles ISA-5.1; never claims PE or
> permit validity.

See `CLAUDE.md` for the governing engineering context, `docs/PRD_extraction-pid-coeditor_v0.1.0.md`
for the spec, and `docs/TASK_GRAPH_v0.2.0.md` + `docs/EXECUTION.md` for the build plan.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript (strict)
- Tailwind CSS
- Postgres (migrations in `db/migrations`)
- MCP Streamable HTTP transport (protocol 2025-11-25), OAuth + DCR
- Zod validation at all boundaries
- Vitest (unit/integration) + Playwright (E2E)

## Prerequisites

- Node.js 20+
- pnpm 9+
- Postgres (required from DEV-1132 onward; not needed for the scaffold)

## Getting started

```bash
pnpm install
pnpm dev          # serves http://localhost:3000
```

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Run the dev server on :3000 |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit/integration suite |
| `pnpm test:e2e` | Playwright E2E suite |

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
  golden/           golden SVG/screenshot fixtures for visual-diff tasks
e2e/                Playwright end-to-end specs
docs/               PRD, task graph, decision records, HUMAN-VERIFY notes
```
