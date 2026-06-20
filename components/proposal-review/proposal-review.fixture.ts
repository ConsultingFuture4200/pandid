/**
 * Deterministic fixture for the pending-proposal canvas UI (DEV-1153 🟡).
 *
 * Models PRD §3 step 5/6 / SC-2: a committed diagram (one extraction column) plus
 * Claude's staged proposal to "add a CRC column after it and connect them". The
 * staged change is the WHOLE next-scene edit (one committer, one shape — see
 * lib/mcp-tools/scene-edit.ts) carried under the `pid` projection key. Element ids
 * are FIXED literals (not generated) so the golden SVGs are byte-stable.
 *
 * The three render modes the overlay produces (pending / accepted / rejected) all
 * derive from this single committed-state + staged-change pair, so the goldens
 * track exactly one scenario across its three decision outcomes.
 */
import type { JsonObject } from "@/lib/types";
import type {
  CommittedSceneInput,
  StagedChangeInput,
} from "./proposal-diff";

/** Viewport shared by the committed scene and the staged edit. */
const VIEWPORT = { width: 420, height: 440 } as const;

// ── Committed canonical state: one extraction column EX-101 ──────────────────

const EX_101_ID = "eq-ex-101";

/** The committed scene's `pid` projection (geometry + edges). */
const committedScene: JsonObject = {
  pid: {
    placements: [
      {
        elementId: EX_101_ID,
        symbolId: "extraction-column",
        x: 160,
        y: 60,
        size: 100,
        portIds: ["top", "bottom", "left", "right"],
      },
    ],
    connections: [],
    viewport: VIEWPORT,
  },
};

/** Committed element tags (from the parallel metadata store). */
const committedTags = new Map<string, string>([[EX_101_ID, "EX-101"]]);

export const COMMITTED: CommittedSceneInput = {
  scene: committedScene,
  tagByElementId: committedTags,
};

// ── Staged proposal: add CRC column CRC-1 + connect EX-101 → CRC-1 ────────────

const CRC_1_ID = "eq-crc-1";
const LINE_1_ID = "line-ex101-crc1";

/**
 * Resolved port geometry, mirroring lib/mcp-tools/scene-edit's `portPoint`:
 *   absolute = placement.{x,y} + (port.{x,y} / 100) * size.
 * EX-101 bottom port (50,90) at (160,60,size 100) → (210, 150).
 * CRC-1 top port (50,10) at (160,220,size 100)    → (210, 230).
 */
const EX_101_BOTTOM = { x: 210, y: 150 };
const CRC_1_TOP = { x: 210, y: 230 };

/** The staged edit's scene `pid` projection — committed + the proposed additions. */
const stagedScene: JsonObject = {
  pid: {
    placements: [
      {
        elementId: EX_101_ID,
        symbolId: "extraction-column",
        x: 160,
        y: 60,
        size: 100,
        portIds: ["top", "bottom", "left", "right"],
      },
      {
        elementId: CRC_1_ID,
        symbolId: "crc-column",
        x: 160,
        y: 220,
        size: 100,
        portIds: ["top", "bottom"],
      },
    ],
    connections: [
      {
        elementId: LINE_1_ID,
        sourceElementId: EX_101_ID,
        targetElementId: CRC_1_ID,
        start: EX_101_BOTTOM,
        end: CRC_1_TOP,
        signal: false,
      },
    ],
    viewport: VIEWPORT,
  },
};

/** The staged edit's `elements` (id + attributes), the tag source for the staged side. */
const stagedElements = [
  { id: EX_101_ID, attributes: { tag: "EX-101", capacity: "50L" } as JsonObject },
  { id: CRC_1_ID, attributes: { tag: "CRC-1", mediaType: "silica" } as JsonObject },
  { id: LINE_1_ID, attributes: { lineId: "L-1", service: "extract" } as JsonObject },
];

export const STAGED: StagedChangeInput = {
  scene: stagedScene,
  elements: stagedElements,
};

export const FIXTURE_IDS = {
  ex101: EX_101_ID,
  crc1: CRC_1_ID,
  line1: LINE_1_ID,
} as const;
