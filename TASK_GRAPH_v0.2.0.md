# Task Graph — Extraction P&ID Co-Editor

> **Source spec:** PRD_extraction-pid-coeditor_v0.1.0.md
> **Version:** v0.2.0
> **Changed from v0.1.0:** complexity-audit splits materialized (10→10a/b, 12→12a/b, 15→15a/b/c); 26→31 tasks; every task mapped to its live Linear issue ID. **Linear is the source of truth; this file is the reasoning + execution contract.**
> **Purpose:** Stateless-agent-executable task graph for Claude Code fan-out + Ralph-loop execution.
> **Convention:** `P(success) = p^d`. Tasks sized < 50 decisions / < 500 lines. Each self-contained.

## Loop-closability legend

Every task is tagged with how "done" is determined — this is what keeps a Ralph loop from spinning forever:

- **🟢 LOOP** (`loop:auto`) — agent + automated tests fully determine success. Safe for autonomous Ralph loop.
- **🟡 LOOP+SNAP** (`loop:snapshot`) — agent writes code; success needs a rendered artifact (SVG/screenshot) checked against a golden file. Loop-closable with a visual-diff harness.
- **🔴 HUMAN** (`loop:human`) — success requires a human action no agent can perform (Claude Desktop OAuth click-through, connector add, live accept). Agent builds + writes a HUMAN-VERIFY.md scaffold; a human closes the gate. **A Ralph loop must STOP and hand off here.**

Linear labels mirror these plus `gate:review`, `gate:phase-exit`, `risk:platform`.

## Complexity dimensions
DD = decision density · CD = context dependency · BR = blast radius (downstream dependents).

---

## Task list (post-audit, 31 tasks, mapped to Linear)

| Linear | # | Title | Spec | Size | DD/CD/BR | Loop | Other labels |
|--------|---|-------|------|------|----------|------|--------------|
| DEV-1129 | 1 | Repo scaffold + tooling | §4 | Small | L/L/H | 🟢 | — |
| DEV-1130 | 3 | Domain types + Zod schemas | §7,§5 | Small | M/M/H | 🟢 | — |
| DEV-1131 | 5 | Symbol library — standard set + required attrs | §6 | Medium | M/M/H | 🟡 | — |
| DEV-1132 | 2 | Postgres schema + migrations | §7 | Medium | M/M/H | 🟢 | — |
| DEV-1133 | 4 | Validator — connectivity rules behind interface | §5.3 | Medium | H/M/H | 🟢 | gate:review |
| DEV-1134 | 6 | Account auth (web login) | FR-20 | Small | M/L/M | 🟢 | — |
| DEV-1135 | 7 | Diagram persistence — CRUD + immutable versioning | §5.5 | Medium | M/M/H | 🟢 | — |
| DEV-1136 | 8 | Metadata store — element-id-keyed (customData workaround) | §7 | Small | M/H/M | 🟢 | — |
| DEV-1137 | 9 | Excalidraw canvas mount + palette UI | §5.1 | Medium | M/H/M | 🟡 | — |
| DEV-1138 | 10a | Manual connect — bind on create | §5.1 | Medium | H/H/M | 🟡 | — |
| DEV-1139 | 10b | Connect — rebind on move/delete | §5.1 | Medium | H/H/M | 🟡 | — |
| DEV-1140 | 11 | Commit pipeline — manual edit → validate → persist | §5.1,5.3 | Medium | M/M/H | 🟢 | — |
| DEV-1141 | 24 | E2E manual workflow + Phase 1 exit gate | SC-1 | Small | L/M/L | 🟡 | gate:phase-exit |
| DEV-1142 | 13 | Server-side SVG render of diagram state | FR-9 | Small | M/M/M | 🟡 | — |
| DEV-1143 | 26 | Transport-fallback seam (isolate Claude transport) | §9 | Small | M/H/M | 🟢 | risk:platform |
| DEV-1144 | 18 | Proposal model + lifecycle | §5.2,8 | Medium | H/M/H | 🟢 | gate:review |
| DEV-1145 | 14 | MCP server skeleton — Streamable HTTP | §4,FR-5 | Medium | M/H/H | 🔴 | gate:review, risk:platform |
| DEV-1146 | 16 | MCP read tools | FR-6,9 | Small | L/M/M | 🟢 | — |
| DEV-1147 | 15a | MCP OAuth provider + token issuance | FR-21 | Medium | H/H/H | 🔴 | risk:platform |
| DEV-1148 | 15b | DCR + 401 re-registration | FR-21 | Medium | H/H/H | 🔴 | risk:platform |
| DEV-1149 | 15c | Account → active-diagram scoping | §4 | Medium | H/M/H | 🟢 | — |
| DEV-1150 | 17 | MCP propose tools (stage validated proposals) | §5.2 | Medium | H/H/H | 🟢 | — |
| DEV-1151 | 12a | WebSocket sync — broadcast + apply | §4 | Medium | H/H/H | 🟡 | — |
| DEV-1152 | 12b | Sync — in-progress-edit guard | §4 | Medium | H/H/H | 🟡 | gate:review |
| DEV-1153 | 19 | Pending-proposal canvas UI (Accept/Reject) | §5.2 | Medium | M/H/M | 🟡 | — |
| DEV-1154 | 22 | In-app connector onboarding | §5.6 | Trivial | L/M/L | 🔴 | risk:platform |
| DEV-1155 | 25 | E2E Claude loop + Phase 2 exit gate | SC-2,3 | Medium | M/H/M | 🔴 | gate:phase-exit |
| DEV-1156 | 20 | Line-list export (CSV + JSON) | FR-15 | Small | L/M/L | 🟢 | — |
| DEV-1157 | 21 | Diagram export (.excalidraw + SVG) | FR-16 | Small | L/L/L | 🟢 | — |
| DEV-1158 | 23 | Multi-tenant isolation review + tests | §4,SC | Small | M/H/H | 🟢 | — |
| DEV-1159 | 27 | Full canonical workflow + v1 exit gate | SC-1…6 | Medium | M/H/H | 🔴 | gate:phase-exit |

Counts: 🟢 16 · 🟡 8 · 🔴 7. Review gates: 4. Phase-exit gates: 3. Platform-risk: 5.

---

## Dependency graph (batched, with Linear IDs)

```
PHASE 1 — EDITOR FOUNDATION  (milestone: Phase 1 — Editor Foundation)
Batch 1 (parallel, no deps):
  DEV-1129 [1] scaffold · DEV-1130 [3] types · DEV-1131 [5] symbols
Batch 2 (deps B1):
  DEV-1132 [2] schema      ⟵ blockedBy 1129,1130
  DEV-1133 [4] validator   ⟵ blockedBy 1130,1131   ⚠️ REVIEW GATE
  DEV-1134 [6] auth        ⟵ blockedBy 1129,1130 (implicit via scaffold/types)
Batch 3 (deps B2):
  DEV-1135 [7] persistence ⟵ blockedBy 1132,1130
  DEV-1136 [8] metadata    ⟵ blockedBy 1132,1130
  DEV-1137 [9] canvas+palette ⟵ blockedBy 1131
Batch 4 (deps B3):
  DEV-1138 [10a] bind-on-create ⟵ blockedBy 1137
  DEV-1139 [10b] rebind         ⟵ blockedBy 1138
  DEV-1140 [11] commit pipeline ⟵ blockedBy 1135,1136,1133,1139
Batch 5 (gate):
  DEV-1141 [24] E2E manual ⟵ blockedBy 1140,1137   ← PHASE 1 EXIT GATE (SC-1)

PHASE 2 — MCP + PROPOSE-AND-CONFIRM  (milestone: Phase 2)
Batch 6 (deps Phase 1):
  DEV-1142 [13] SVG render   ⟵ blockedBy 1141
  DEV-1143 [26] transport seam ⟵ blockedBy 1141
  DEV-1144 [18] proposal model ⟵ blockedBy 1140,1133   ⚠️ REVIEW GATE
Batch 7 (deps B6):
  DEV-1145 [14] MCP skeleton ⟵ blockedBy 1143   🔴 + ⚠️ REVIEW GATE
  DEV-1146 [16] read tools   ⟵ blockedBy 1145,1142
Batch 8 (deps B7):
  DEV-1147 [15a] OAuth        ⟵ blockedBy 1145,1134   🔴
  DEV-1148 [15b] DCR          ⟵ blockedBy 1147         🔴
  DEV-1149 [15c] scoping      ⟵ blockedBy 1148,1135
  DEV-1150 [17] propose tools ⟵ blockedBy 1144,1146,1149
Batch 9 (deps B8):
  DEV-1151 [12a] ws broadcast ⟵ blockedBy 1140
  DEV-1152 [12b] edit guard   ⟵ blockedBy 1151   ⚠️ REVIEW GATE
  DEV-1153 [19] proposal UI   ⟵ blockedBy 1152,1150,1144
Batch 10 (gate):
  DEV-1154 [22] onboarding ⟵ blockedBy 1145   🔴
  DEV-1155 [25] E2E Claude loop ⟵ blockedBy 1153,1154,1147,1148   🔴 ← PHASE 2 EXIT GATE (SC-2,3)

PHASE 3 — EXPORT & HARDENING  (milestone: Phase 3)
Batch 11 (deps Phase 2):
  DEV-1156 [20] line-list ⟵ blockedBy 1146,1136
  DEV-1157 [21] export    ⟵ blockedBy 1142,1135
  DEV-1158 [23] tenant isolation ⟵ blockedBy 1149
Batch 12 (gate):
  DEV-1159 [27] full workflow ⟵ blockedBy 1155,1156,1157,1158   🔴 ← v1 EXIT GATE
```

## Critical path
1129 → 1132 → 1135 → 1137 → 1138 → 1139 → 1140 → 1141 → 1144 → 1145 → 1147 → 1148 → 1150 → 1153 → 1155 → 1159
The MCP auth chain (1145→1147→1148) is the longest high-complexity, human-gated stretch and the riskiest.

---

## Review gates (Ralph loop pauses for human/lead sign-off before dependents start)
- After **DEV-1133** [4] validator — before anything commits through it.
- After **DEV-1144** [18] proposal lifecycle — before propose tools (1150).
- After **DEV-1145** [14] MCP skeleton — before the auth chain (1147+).
- After **DEV-1152** [12b] sync guard — before proposal UI (1153).

## Human hand-off points (🔴 — loop MUST STOP, write HUMAN-VERIFY.md, do not self-certify)
DEV-1145 [14], DEV-1147 [15a], DEV-1148 [15b], DEV-1154 [22], DEV-1155 [25], DEV-1159 [27].
All cluster in the Phase-2 auth chain + the two human-verified E2E gates. 6 of 31 tasks are not autonomously loop-closable. (Note: 15c/1149 was de-risked to 🟢 by isolating the automatable scoping logic from the OAuth flow.)

---

## Ralph-loop execution contract

For Claude Code fan-out:

1. **Batches are the parallelism unit.** Fan out subagents within a batch; join before next batch. Read live `blockedBy` from Linear — anything unblocked is fan-out-ready.
2. **🟢 `loop:auto`** run fully autonomous — loop until `pnpm test && pnpm lint && pnpm typecheck` green.
3. **🟡 `loop:snapshot`** need the visual-diff harness (DEV-1142 + golden fixtures). Loop converges when rendered output matches golden within tolerance. **Build the harness before any 🟡 task in Phase 2**; Phase 1 🟡 tasks (1131,1137,1138,1139,1141) need a minimal screenshot-compare from Batch 1.
4. **🔴 `loop:human`** — agent builds to the acceptance scaffold, writes HUMAN-VERIFY.md with exact steps, then **the loop STOPS and surfaces the handoff.** Do not mark done autonomously. These need a human with Claude Desktop + the OAuth flow.
5. **`gate:review`** — loop pauses, posts a diff summary, waits for approval before dependents start.
6. **`gate:phase-exit`** (1141, 1155, 1159) are hard stops — all prior batch exit criteria green before crossing.

### The cynic's note (unchanged, still the most important thing)
A naive Ralph loop pointed at this graph will hit DEV-1147 [15a] (OAuth + Desktop connector) and either spin forever — no test it can run proves a human completed the Desktop OAuth — or hallucinate success. The 🔴 tags and the explicit STOP-and-handoff are the guardrail. Filter the Linear board to `loop:human` to see the six hand-off points before launching the loop.
