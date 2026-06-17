# HUMAN-VERIFY / BLOCKER — DEV-1131 Symbol library + required attrs

> Status: **implementation complete, official green-loop BLOCKED on a missing prerequisite.**
> DEV-1131 is a 🟡 `loop:snapshot` task, not 🔴. This note exists because the
> autonomous loop gate (`pnpm test && pnpm lint && pnpm typecheck`) cannot run in
> this worktree — the project scaffold (DEV-1129) has not landed here.

## What is blocked and why

The task says "loop until `pnpm test && pnpm lint && pnpm typecheck` are green."
None of those commands exist in this worktree:

- No `package.json`, `tsconfig.json`, `eslint`/`vitest` config — these are the
  deliverables of **DEV-1129 (Repo scaffold + tooling)**.
- The shared visual-diff harness referenced by EXECUTION.md ("Phase 1 needs a
  minimal screenshot/SVG compare from B1") is likewise scaffold/DEV-1142-owned.

`docs/EXECUTION.md` states this exact ordering explicitly:

> Intra-batch note for B1: ... `pnpm typecheck` for types (1130) and symbols
> (1131) needs the TS project from scaffold (1129). **Land DEV-1129 first**, then
> fan out 1130/1131.

CLAUDE.md hard rule: "No file owned by another task should be modified." Authoring
`package.json` / `tsconfig.json` / lint+test config / the shared harness inside
DEV-1131 would implement DEV-1129's deliverables and cross the task boundary.
Therefore the loop **STOPS** here rather than fabricating the scaffold or
self-certifying a green run that never executed.

## What WAS delivered (DEV-1131-owned files only)

- `lib/symbols/types.ts` — symbol/attribute/primitive/port types (strict TS, no `any`).
- `lib/symbols/definitions.ts` — the standard v1 set (PRD §6), 11 symbols incl. 2 valves.
- `lib/symbols/render-svg.ts` — deterministic, dependency-free SVG renderer for goldens.
- `lib/symbols/index.ts` — public API: `listEquipmentTypes`, `getSymbol`,
  `getRequiredAttributes`, `isSymbolId`, `SYMBOL_DEFINITIONS`, `SYMBOL_IDS`.
- `lib/symbols/symbols.test.ts` — vitest suite (runs under the DEV-1129 toolchain).
- `test/golden/<symbol>.svg` — one golden SVG fixture per symbol (11 files),
  generated from the renderer, not hand-authored.

Acceptance criteria (Linear DEV-1131):
- [x] Each symbol defined in `lib/symbols` with required-attribute set.
- [x] Golden SVG fixture per symbol in `test/golden`.
- [x] `list_equipment_types` can enumerate them (`listEquipmentTypes()`).
- [x] Anti-requirements honored: no domain/process rules; no canvas wiring.

## Out-of-band verification already performed (not a substitute for the gate)

Because the project toolchain is absent, the following was run manually to prove
the code is correct; re-run the real gate once DEV-1129 lands:

1. **Strict typecheck** of the four source files under `strict`,
   `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — `tsc` exit 0, no `any`.
2. **All test assertions executed** against an esbuild bundle of the library and
   the on-disk goldens — 11/11 symbols pass, including the golden visual-diff
   compare and the dashed-signal-line check.

## Steps to close the gate (after DEV-1129 has landed)

1. Merge/rebase so the DEV-1129 scaffold (`package.json`, `tsconfig.json`,
   vitest + eslint config) is present.
2. From the repo root: `pnpm install` then `pnpm test && pnpm lint && pnpm typecheck`.
3. Confirm the `lib/symbols/symbols.test.ts` golden suite passes within tolerance.
   If the shared `test/golden` harness normalizes differently than the local
   `normalizeSvg` helper, re-point the test at the shared harness (no fixture
   changes expected — the goldens are renderer-generated and deterministic).
4. **Client sign-off (PRD §6 / Linear):** "Client approves the set before
   dependent features lock." DEV-1131 blocks DEV-1133 (validator) and DEV-1137
   (canvas) — do not start them until the client approves this symbol set.

## Note for the orchestrator

This is a dependency-ordering gap in how the worktree was cut (pre-scaffold
commit), not a defect in DEV-1131. The correct fix is to land DEV-1129 first per
EXECUTION.md's B1 note, then this task's loop closes autonomously.
