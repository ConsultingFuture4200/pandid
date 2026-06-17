# Extraction P&ID Co-Editor — PRD

> **Created:** 2026-06-16
> **Version:** v0.1.0
> **Status:** Approved for implementation planning
> **Scope:** v1, full Path C. One product, all five client priorities.
> **Standing rules honored:** PRD is markdown (version-controlled). Read-once deliverables (runbooks, one-sheets) will be HTML when produced separately.

---

## 1. Summary

A hosted, multi-tenant web application that renders a live P&ID-style diagramming canvas (Excalidraw) for designers of hemp/hydrocarbon **extraction equipment systems**. The same application exposes its own remote **Streamable HTTP MCP server**, which the user adds to their **Claude Desktop** as a custom connector. The user works two surfaces side by side: the **browser canvas** (where they draw and where the diagram is visible) and **Claude Desktop** (where they converse). Claude does not mutate the canvas directly — it **proposes** changes through MCP tools, and the human **confirms or rejects** each proposal in the browser. A deterministic validator screens every proposed and manual change for structural correctness before commit.

This architecture ("Path C") was selected because it is the only one that satisfies all three hard requirements simultaneously: a custom extraction-equipment symbol library, a live iterative editor, and Claude-driven editing — while keeping inference **subscription-covered** (no API key, no Terms-of-Service exposure) by running Claude inside the user's own Desktop.

---

## 2. Goals & Non-Goals

### 2.1 Goals (v1)

| # | Goal | Client priority rank |
|---|------|----------------------|
| G1 | Custom (standard ISA-style) extraction-equipment symbol library + full manual editing on a hosted canvas | 1 |
| G2 | Claude-driven diagram editing via the app's MCP server, propose-and-confirm | 2 |
| G3 | Deterministic **connectivity** validation gating every committed change | 3 |
| G4 | Equipment metadata (tag, type, attributes) + line-list export | 4 |
| G5 | Save / load / version diagrams per account | 5 |

### 2.2 Non-Goals (explicitly deferred)

- **Process-aware / domain validation** (e.g. "a CRC column must sit downstream of extraction and upstream of collection"). v1 validates *connectivity*, not *process correctness*. → v2.
- **Certified / stamped engineering output.** The product resembles ISA-5.1 closely but is explicitly **not** for PE sign-off or AHJ/permit submission. Output is for internal design and client proposals.
- **Real-time multi-user co-presence** (multiple humans on one canvas, cursors, etc.). v1 is single human + Claude advisor per diagram.
- **Autonomous Claude editing.** Claude never commits. Propose-and-confirm only.
- **Multiple diagrams per active session.** One active diagram at a time; users switch by selecting another by name (which rebinds the session).
- **A built-in API-key chat panel.** Not built in v1, but the transport layer is isolated so it can be added (see §9 fallback).

---

## 3. Users & Core Workflow

**Primary user:** an extraction-system designer (the client and their team). Comfortable with process equipment and P&ID conventions; not necessarily a developer.

**Canonical workflow:**

1. User logs into the web app (browser), opens or creates a diagram, which becomes the **active diagram** for their account.
2. One-time: user adds the app's MCP server as a **custom connector** in Claude Desktop (Settings → Connectors), authenticating via the app's OAuth. The connector is **account-scoped** — it acts on whatever diagram is active for that account.
3. User draws manually on the canvas (drag equipment from the symbol library, connect, label) — fully functional with no Claude involvement.
4. User asks Claude (in Desktop) to do something: *"add a CRC column after the collection pot and connect it."*
5. Claude calls the app's MCP tools. The tools **stage a proposal** (the validated change set) and return structured diagram state + an SVG snapshot so Claude can describe what it intends.
6. The browser canvas shows the **pending proposal** (visually distinct). User clicks **Accept** or **Reject**.
7. On accept, the validator runs once more, the change commits to canonical state, and the canvas re-renders. On reject, the proposal is discarded.

---

## 4. Architecture (settled)

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Pattern | **Path C** — web app hosts canvas + exposes remote MCP server; Claude Desktop drives it | Only pattern satisfying custom symbols + live editor + Claude, subscription-covered |
| Frontend | Next.js (App Router) + React + TypeScript; Excalidraw embedded **client-side only** (`ssr:false`) | Matches existing stack; Excalidraw requires client-side mount |
| Diagram engine | Excalidraw `@excalidraw/excalidraw`; programmatic edits via `convertToExcalidrawElements` → `updateScene`; reads via `onChange` | Documented programmatic API; the read/write handles the loop needs |
| Claude transport | **Streamable HTTP MCP** (protocol 2025-11-25) with **OAuth**, added in Desktop as a Custom Connector | Verified: Desktop connects to remote MCP only via Custom Connectors, not config file; SSE is deprecating |
| Server reachability | Public-internet HTTPS endpoint | Verified: connectors call the server **from Anthropic's cloud**, not the local device — no localhost option |
| Auth / pairing | **Account-based.** Web login + connector OAuth (Dynamic Client Registration supported). Connector acts on the account's active diagram | User's chosen model; maps onto documented connector OAuth |
| Interaction contract | **Propose-and-confirm.** Claude stages; human commits | Eliminates concurrent-write/last-write-wins entirely — single committer |
| Canvas sync | Server is source of truth; browser is a view over **WebSocket**. **Whole-scene broadcast** with an in-progress-edit guard (defer incoming redraw while user is mid-manipulation) | Simple, correct mirror; extraction P&IDs are small. Element-level diffing = v2 |
| Tool return payload | **Structured diagram state + server-rendered SVG snapshot** | State for Claude's reasoning; snapshot for verification of a canvas it can't see |
| Metadata | Equipment attributes in a **parallel store keyed by element ID**, not Excalidraw `customData` | `convertToExcalidrawElements` drops `customData`; parallel store is the single source of truth for metadata |
| Persistence | **Postgres** | Multi-tenant accounts/sessions/diagrams/metadata with relational integrity; matches existing stack |
| Hosting | Multi-tenant service you operate | Client requirement ("you host it as a service") |

---

## 5. Functional Requirements

### 5.1 Canvas & manual editing (G1)
- FR-1 Render an Excalidraw canvas in the browser, client-side mounted.
- FR-2 Provide a palette of extraction-equipment symbols (see §6). User can place, move, resize, rotate, delete, and label.
- FR-3 User can draw connections (process lines, signal lines) between equipment ports; connections bind to elements and follow them when moved.
- FR-4 Manual edits are validated on commit (§5.3) and persisted (§5.5).

### 5.2 Claude editing via MCP (G2)
- FR-5 Expose a remote Streamable HTTP MCP server with OAuth, addable as a Desktop custom connector.
- FR-6 MCP tools operate on the account's **active diagram**.
- FR-7 Every mutating tool produces a **staged proposal**, never a direct commit.
- FR-8 Mutating tools run the validator on the proposal and **refuse to stage an invalid proposal**, returning the validation errors to Claude instead.
- FR-9 Tool responses return structured diagram state **and** an SVG snapshot.
- FR-10 The browser surfaces pending proposals with Accept/Reject; accept re-validates then commits, reject discards.

**MCP tool surface (v1):**

| Tool | Type | Returns |
|------|------|---------|
| `get_active_diagram` | read | structured state + SVG |
| `list_equipment_types` | read | available symbols + required attributes |
| `add_equipment` | propose | proposal id + state + SVG |
| `connect` | propose | proposal id + state + SVG |
| `set_metadata` | propose | proposal id + state + SVG |
| `delete_element` | propose | proposal id + state + SVG |
| `move_or_relabel` | propose | proposal id + state + SVG |
| `validate_active_diagram` | read | validator report |
| `export_line_list` | read | line-list data (§5.4) |

### 5.3 Deterministic connectivity validation (G3)
- FR-11 Validate, on every commit (manual or accepted proposal): (a) every connection endpoint binds to a real element port; (b) no orphan/dangling connections; (c) equipment tags unique within the diagram; (d) required metadata fields present for each placed equipment type.
- FR-12 Validation is **connectivity/structural only** in v1. No process-topology rules. (Domain rules = v2; the validator is built behind an interface so domain rules slot in without rework.)
- FR-13 Validation failures block the commit and return actionable messages (which element, which rule).

### 5.4 Metadata & line-list export (G4)
- FR-14 Each equipment element carries typed attributes (tag, equipment type, plus type-specific fields — see §6) in the parallel metadata store.
- FR-15 Export a **line list** (connections with from/to equipment, tags, line attributes) as CSV and JSON.
- FR-16 Export the diagram itself as `.excalidraw` and SVG.

### 5.5 Save / load / version (G5)
- FR-17 Diagrams persist per account; user lists, opens, renames, deletes.
- FR-18 Each save creates a new immutable version; user can view and restore prior versions.
- FR-19 Canonical diagram state = server (Postgres). Browser and MCP both act through it.

### 5.6 Accounts & connector onboarding
- FR-20 Email/password (or your standard auth) account login to the web app.
- FR-21 OAuth flow backing the MCP custom connector, binding the connector to the account.
- FR-22 In-app instructions for adding the connector in Desktop **via Settings → Connectors** (never via `claude_desktop_config.json`, which silently rejects remote URLs).

---

## 6. Symbol Library (v1 — standard set)

Standard ISA-style symbols built from Excalidraw primitives (approximate, not certified). Required-attribute set drives FR-11(d) and FR-14.

| Symbol | Required attributes (beyond tag) |
|--------|----------------------------------|
| Extraction column | tag, capacity, orientation |
| Collection pot / tank | tag, volume |
| CRC column | tag, media type |
| Heater | tag, duty, medium |
| Chiller | tag, duty, medium |
| Pump | tag, type |
| Valve (gate/check, ≥2) | tag, valve type |
| Instrument bubble | tag, measured variable |
| Process line | line id, service |
| Signal line | (dashed) |

Authority: **you design the set, client approves** before build of dependent features. Domain-specific/house symbols = v2.

---

## 7. Data Model (essentials)

- **Account** (id, auth, oauth client registration)
- **Diagram** (id, account_id, name, active flag per account)
- **DiagramVersion** (id, diagram_id, excalidraw_scene JSON, created_at, immutable)
- **ElementMetadata** (diagram_version_id, element_id, equipment_type, attributes JSONB) — the parallel store
- **Proposal** (id, diagram_id, staged_change JSON, validator_report, status: pending/accepted/rejected)
- **Connection** is represented within the Excalidraw scene; line-list export derives from scene + metadata.

---

## 8. Reliability Model

"Reliably" is delivered by **code, not the model**:
- Single committer (human) via propose-and-confirm → no write conflicts by construction.
- Validator gates every commit regardless of source → structurally valid diagrams by construction.
- Server-authoritative state → browser and Claude can never diverge from canonical truth; they are both clients of it.
- Claude's fallibility is contained: an invalid proposal is refused at staging (FR-8) and never reaches the canvas.

---

## 9. Risks & Kill Criteria

| Risk | P | Impact | Mitigation / Kill criterion |
|------|---|--------|------------------------------|
| **Custom connectors are beta on consumer plans; Anthropic has changed automation/OAuth rules 3× in 2026** | M | **H — product down** | Accepted by stakeholder ("it's just down"). **Kill/fallback criterion:** if Anthropic restricts custom-connector behavior on the client's plan tier, activate the isolated-transport fallback: a built-in API-key chat panel (Path B mechanism). Transport layer is built behind an interface so this is additive, not a rewrite. |
| Excalidraw `customData` dropped on conversion | H (certain) | M | Parallel metadata store keyed by element id (§4, §7). Designed in, not discovered. |
| Desktop rejects remote URL in config file | H (certain) | M | Onboarding uses Settings → Connectors UI only (FR-22). |
| Whole-scene broadcast stomps in-progress manual edit | M | M | In-progress-edit guard defers redraw until manipulation ends (§4). Diffing escalation = v2 if observed. |
| "Standard symbols" insufficient for real extraction work | M | M | Client approves symbol set before dependent build (§6). Domain set scheduled v2. |
| Scope: "Claude-first" does not shrink v1 | H (certain) | M | Acknowledged: the Claude loop requires the full app beneath it. v1 is the full build minus domain validator. Phased internally (§11) to de-risk, not to reduce surface. |

---

## 10. Success Criteria (measurable, v1 exit)

| ID | Metric | Target |
|----|--------|--------|
| SC-1 | A user can draw a 4-column→header→collection-tank P&ID manually, save, reload | Pass/fail |
| SC-2 | From Desktop, "add a CRC column and connect it" produces a pending proposal the user accepts and sees on canvas | Pass/fail |
| SC-3 | An invalid proposal (orphan connection / duplicate tag) is refused at staging and never commits | Pass/fail |
| SC-4 | Line-list export matches the on-canvas topology for a 10-equipment diagram | 100% of connections represented |
| SC-5 | Connector onboarding completed by a non-developer following in-app instructions | < 10 min, no support |
| SC-6 | Version restore returns an exact prior scene + metadata | Byte-identical scene, metadata intact |

---

## 11. Implementation Plan (phased within one v1)

Phases are **internal de-risking gates**, not separate releases. Each gate is measurable.

### Phase 1 — Editor foundation
**Proves:** the canvas + symbols + manual editing + persistence work without any Claude involvement.
- Next.js app, Excalidraw client-side mount, account auth, Postgres, diagram CRUD + versioning.
- Symbol library (§6) as placeable templates; manual connect; metadata store.
- Connectivity validator (FR-11) wired to manual commit.
- **Exit:** SC-1, SC-6 pass; validator blocks a hand-made orphan/duplicate-tag.

### Phase 2 — MCP server + propose-and-confirm
**Proves:** Claude in Desktop can drive the canvas through the full propose→validate→confirm loop.
- Streamable HTTP MCP server with OAuth + DCR; account-scoped to active diagram.
- Read tools (`get_active_diagram`, `list_equipment_types`) returning structured state + SVG.
- Propose tools (`add_equipment`, `connect`, `set_metadata`, `delete_element`, `move_or_relabel`) staging validated proposals.
- WebSocket sync + pending-proposal UI (Accept/Reject) with in-progress-edit guard.
- Transport behind an interface (fallback seam per §9).
- **Exit:** SC-2, SC-3, SC-5 pass; connector added in Desktop via Settings and drives a live accept.

### Phase 3 — Export & hardening
**Proves:** the diagram produces usable downstream artifacts and survives real use.
- Line-list export (CSV/JSON), diagram export (.excalidraw/SVG).
- Multi-tenant isolation review; error states; onboarding instructions in-app.
- **Exit:** SC-4 passes; two tenants verified isolated; full canonical workflow (§3) runs end-to-end.

**Sequencing note:** Phase 1 is a prerequisite for Phase 2 (no Claude loop without the editor beneath it). This ordering serves the client's "Claude loop first" by reaching it as fast as structurally possible — Phase 2 is where the headline capability lands — without pretending the editor can be skipped.

---

## 12. Settled Decisions Ledger (no open questions)

| Decision | Value |
|----------|-------|
| Architecture | Path C |
| Frontend | Next.js + React + TS, Excalidraw `ssr:false` |
| Transport | Streamable HTTP MCP + OAuth, Desktop Custom Connector |
| Onboarding | Settings → Connectors UI (not config file) |
| Pairing | Account-based, connector OAuth/DCR, acts on active diagram |
| Interaction | Propose-and-confirm (human is sole committer) |
| Diagram scope | Single active diagram per session |
| Sync | Whole-scene broadcast + in-progress guard (diffing = v2) |
| Tool returns | Structured state + SVG snapshot |
| Metadata | Parallel store keyed by element id |
| Persistence | Postgres |
| Hosting | Multi-tenant service, operator-hosted, public HTTPS |
| Symbols | Standard ISA-style set, client-approved (domain set = v2) |
| Validation | Connectivity/structural only (domain rules = v2, behind interface) |
| Standards posture | Resembles ISA-5.1, not certified, not for sign-off |
| Platform-risk tolerance | Down-is-acceptable; fallback = isolated API-key chat panel if connectors restricted |
