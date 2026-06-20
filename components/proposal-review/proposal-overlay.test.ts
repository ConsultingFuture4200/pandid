// Pending-proposal canvas UI tests (DEV-1153, 🟡 LOOP+SNAP, FR-10).
//
// This is the propose-and-confirm UI atop the proposal lifecycle (a tests-first
// primitive per CLAUDE.md), so it is tested behaviorally AND with golden SVGs.
//
// Two kinds of proof:
//   1. diff — the proposal diff correctly splits the staged scene into committed
//      (already on canvas) vs proposed (Claude's additions), so the overlay knows
//      what to ghost. This is the "visually distinct from committed elements"
//      acceptance criterion's data layer.
//   2. 🟡 golden SVG — the three decision states (pending / accepted / rejected)
//      each render byte-stable and match their committed golden. Pending ghosts the
//      proposed elements; accepted draws them normally (committed); rejected omits
//      them. These goldens ARE the "golden screenshots: pending, accepted,
//      rejected states" acceptance criterion.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { diffProposal } from "./proposal-diff";
import { renderProposalOverlay } from "./proposal-overlay";
import { COMMITTED, STAGED, FIXTURE_IDS } from "./proposal-review.fixture";

const goldenDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "golden",
);

function normalizeSvg(svg: string): string {
  return svg
    .replace(/\s+/g, " ")
    .replace(/-?\d+\.\d+/g, (m) => String(Math.round(Number(m))))
    .trim();
}

function golden(name: string): string {
  return readFileSync(join(goldenDir, name), "utf8");
}

describe("proposal diff — committed vs proposed split", () => {
  const diff = diffProposal(COMMITTED, STAGED);

  it("keeps the already-committed equipment as committed (drawn normally)", () => {
    expect(diff.committedEquipment.map((e) => e.elementId)).toEqual([
      FIXTURE_IDS.ex101,
    ]);
    expect(diff.committedConnections).toHaveLength(0);
  });

  it("marks only the proposal's NEW elements as proposed (drawn ghosted)", () => {
    expect(diff.proposedEquipment.map((e) => e.elementId)).toEqual([
      FIXTURE_IDS.crc1,
    ]);
    expect(diff.proposedConnections.map((c) => c.elementId)).toEqual([
      FIXTURE_IDS.line1,
    ]);
  });

  it("carries staged tags onto the proposed equipment", () => {
    const crc = diff.proposedEquipment.find((e) => e.elementId === FIXTURE_IDS.crc1);
    expect(crc?.tag).toBe("CRC-1");
  });

  it("does not mutate committed state when the proposal adds nothing new", () => {
    const noop = diffProposal(COMMITTED, {
      scene: COMMITTED.scene,
      elements: [{ id: FIXTURE_IDS.ex101, attributes: { tag: "EX-101" } }],
    });
    expect(noop.proposedEquipment).toHaveLength(0);
    expect(noop.proposedConnections).toHaveLength(0);
    expect(noop.committedEquipment).toHaveLength(1);
  });
});

describe("proposal overlay — 🟡 golden states", () => {
  const diff = diffProposal(COMMITTED, STAGED);

  it("pending: committed normally + proposed ghosted, matches golden", () => {
    const svg = renderProposalOverlay(diff, "pending");
    // The proposed CRC column + line render ghosted (highlight stroke + opacity).
    expect(svg).toContain('data-proposal="pending"');
    expect(svg).toContain('stroke="#2563eb"');
    expect(svg).toContain('opacity="0.55"');
    expect(normalizeSvg(svg)).toBe(normalizeSvg(golden("proposal-pending.svg")));
  });

  it("accepted: every element committed (no ghost), matches golden", () => {
    const svg = renderProposalOverlay(diff, "accepted");
    expect(svg).toContain('data-proposal="accepted"');
    // Once accepted the proposal is canonical — nothing is ghosted.
    expect(svg).not.toContain("#2563eb");
    expect(svg).not.toContain("opacity=");
    // The formerly-proposed CRC column is now present and drawn normally.
    expect(svg).toContain('data-tag="CRC-1"');
    expect(svg).toContain(`data-connection="${FIXTURE_IDS.line1}"`);
    expect(normalizeSvg(svg)).toBe(normalizeSvg(golden("proposal-accepted.svg")));
  });

  it("rejected: only committed elements remain, matches golden", () => {
    const svg = renderProposalOverlay(diff, "rejected");
    expect(svg).toContain('data-proposal="rejected"');
    // The proposal is discarded: its elements are gone, no ghost remains.
    expect(svg).not.toContain("#2563eb");
    expect(svg).not.toContain('data-tag="CRC-1"');
    expect(svg).not.toContain(FIXTURE_IDS.line1);
    // The committed extraction column is still there.
    expect(svg).toContain('data-tag="EX-101"');
    expect(normalizeSvg(svg)).toBe(normalizeSvg(golden("proposal-rejected.svg")));
  });
});
