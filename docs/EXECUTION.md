# EXECUTION.md — Ralph-loop operating contract

> How this project is built. Pairs with `docs/TASK_GRAPH_v0.2.0.md` (reasoning) and the
> Linear board (live state). **Linear is the source of truth for task status.**
> Project: `Extraction P&ID Co-Editor` · staqs workspace · `Development` team · issues `DEV-1129`–`DEV-1159`.

## The loop in one paragraph

Work proceeds **batch by batch**. A batch is the parallelism unit: every issue in a batch whose
`blockedBy` set is satisfied is fanned out to a subagent concurrently, then we **join** before the
next batch starts. Each task loops on `pnpm test && pnpm lint && pnpm typecheck` (🟢), plus a golden
visual-diff compare (🟡), until green. At review gates and 🔴 human hand-offs the loop **stops**.

## Loop-closability tags (binding)

| Tag | Meaning | Done when |
|-----|---------|-----------|
| 🟢 `loop:auto` | Fully autonomous | `pnpm test && pnpm lint && pnpm typecheck` green |
| 🟡 `loop:snapshot` | Needs rendered artifact | above **+** rendered SVG/screenshot matches golden within tolerance |
| 🔴 `loop:human` | Needs a human action no agent can do | agent builds to the acceptance scaffold, writes `docs/HUMAN-VERIFY-<id>.md`, **loop STOPS** — never self-certified |

**🔴 issues:** DEV-1145, DEV-1147, DEV-1148, DEV-1154, DEV-1155, DEV-1159. A loop that doesn't stop
here spins forever or fakes success. This is the single most important rule.

## Gates (loop pauses for sign-off before dependents start)

- **`gate:review`** — post a diff summary, wait for approval: after DEV-1133 (validator),
  DEV-1144 (proposal lifecycle), DEV-1145 (MCP skeleton), DEV-1152 (sync guard).
- **`gate:phase-exit`** — hard stop, all batch exit criteria green: DEV-1141 (Phase 1 / SC-1),
  DEV-1155 (Phase 2 / SC-2,3), DEV-1159 (v1 / §3 end-to-end).

## Batch order (real Linear IDs)

```
PHASE 1 — Editor Foundation
  B1  DEV-1129 scaffold🟢 · DEV-1130 types🟢 · DEV-1131 symbols🟡
  B2  DEV-1132 schema🟢 · DEV-1133 validator🟢⚠️review · DEV-1134 auth🟢
  B3  DEV-1135 persistence🟢 · DEV-1136 metadata🟢 · DEV-1137 canvas🟡
  B4  DEV-1138 bind-create🟡 · DEV-1139 rebind🟡 · DEV-1140 commit-pipeline🟢
  B5  DEV-1141 E2E manual🟡 ← PHASE 1 EXIT (SC-1)

PHASE 2 — MCP + Propose-and-Confirm
  B6  DEV-1142 SVG render🟡 · DEV-1143 transport seam🟢 · DEV-1144 proposal model🟢⚠️review
  B7  DEV-1145 MCP skeleton🔴⚠️review · DEV-1146 read tools🟢
  B8  DEV-1147 OAuth🔴 · DEV-1148 DCR🔴 · DEV-1149 scoping🟢 · DEV-1150 propose tools🟢
  B9  DEV-1151 ws broadcast🟡 · DEV-1152 edit guard🟡⚠️review · DEV-1153 proposal UI🟡
  B10 DEV-1154 onboarding🔴 · DEV-1155 E2E Claude loop🔴 ← PHASE 2 EXIT (SC-2,3)

PHASE 3 — Export & Hardening
  B11 DEV-1156 line-list🟢 · DEV-1157 export🟢 · DEV-1158 tenant isolation🟢
  B12 DEV-1159 full workflow🔴 ← v1 EXIT GATE
```

**Intra-batch note for B1:** the graph marks B1 as no-deps-parallel, but `pnpm typecheck` for types (1130)
and symbols (1131) needs the TS project from scaffold (1129). Land DEV-1129 first, then fan out 1130/1131.

**Critical path:** 1129→1132→1135→1137→1138→1139→1140→1141→1144→1145→1147→1148→1150→1153→1155→1159.
The MCP auth chain (1145→1147→1148) is the longest, riskiest, human-gated stretch.

## Orchestration — multi-agent Workflow

Batch fan-out runs through the Workflow tool. Script: `.claude/workflows/pid-batch.js`.

- Invoke one batch at a time: `Workflow({ scriptPath: ".claude/workflows/pid-batch.js", args: { batch: N } })`.
- Per task the script runs **implement → verify** in a pipeline, each non-🔴 task in its own git worktree
  (`isolation: "worktree"`) so parallel tasks never collide on files.
- 🔴 tasks are routed to a build-to-scaffold + write-`HUMAN-VERIFY` path; the script logs a STOP and does
  not mark them done.
- The human/orchestrator advances batches **between** Workflow invocations — that's the join barrier and
  the place to clear review gates.

### Integration / join barrier — MANDATORY between batches (learned in Batch 1)

Each task runs in its **own worktree branched from `master`**, so a task's output is NOT visible to its
siblings or to the next batch until it's merged. After every Workflow batch returns:

1. **Merge** each task branch `dustin/dev-<id>` into `master` (`git merge --no-ff`), in dependency order.
2. **Install + run the root green loop**: `pnpm install && pnpm test && pnpm lint && pnpm typecheck`.
   This is where cross-task integration bugs surface (e.g. Batch 1: types imported `zod` that the scaffold
   never declared — green in isolation, broken at integration). Fix them here before advancing.
3. Only then move the issues to Done and start the next batch (its worktrees branch from the new `master`).

**Corollary for any batch with a foundational task** (a scaffold/`first` task others compile against):
land that task to `master` *before* the dependents fan out, or they build against a base that lacks it.

### Symbol-set approval gate (PRD §6 — not in the loop tags)

DEV-1131 implements the symbol set, but **PRD §6 requires client approval of the set before dependent
features build.** DEV-1133 (validator: required-attrs-per-type) and DEV-1137 (canvas palette) lock against
it. Treat DEV-1131 → {1133, 1137} as a human approval gate even though 1131 is tagged 🟡.

## Per-task definition of done

1. Acceptance criteria in the Linear issue pass.
2. `pnpm test && pnpm lint && pnpm typecheck` green.
3. No file owned by another task modified (task-graph boundary rule).
4. 🟡: rendered output matches golden within tolerance.
5. 🔴: `docs/HUMAN-VERIFY-<id>.md` written; loop halted; NOT self-marked done.
6. Architecture invariants (CLAUDE.md) upheld: server is sole source of truth; one committer; proposals
   staged never applied; validator behind interface; versions immutable.
7. Commit on branch `dustin/dev-<id>` (matches Linear `gitBranchName`); move the issue to In Progress on
   start and to the appropriate state on completion.

## Prerequisites the loop assumes (set up before B2)

- **Visual-diff harness** for 🟡 tasks. Phase 1 needs a minimal screenshot/SVG compare from B1; build the
  full server-side SVG harness at DEV-1142 before later 🟡 work.
- **Postgres** reachable for migration/integration tests (DEV-1132 onward).
- **pnpm** toolchain (delivered by DEV-1129).
