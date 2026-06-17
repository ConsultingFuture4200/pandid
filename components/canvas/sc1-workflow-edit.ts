// Build the source-agnostic DiagramEdit for the SC-1 manual workflow (DEV-1141).
//
// The commit pipeline (DEV-1140) is the single committer: a manual canvas edit
// arrives as a `DiagramEdit` (scene + placed elements + derived connection
// edges). SC-1 ("draw 4-column→header→collection-tank, save, reload") is exactly
// such an edit. This pure builder translates the SC-1 fixture into that edit so
// the round-trip test drives the REAL commit/persist path — not a bespoke save —
// honoring "one committer" (CLAUDE.md architecture invariants).
//
// Each process line is itself an element (equipmentType `process-line`, no ports)
// AND contributes a derived `Connection` edge; equipment elements carry their
// symbol id as equipmentType and their required attributes. This matches the
// shape the commit pipeline's Zod schema + validator expect. Pure: no I/O.

import type { DiagramEdit } from "@/lib/diagram/commit";
import {
  SC1_CONNECTIONS,
  SC1_EQUIPMENT,
  SC1_SCENE,
  type Sc1Connection,
  type Sc1Equipment,
} from "./sc1-workflow.fixture";

/**
 * Translate the SC-1 fixture into a `DiagramEdit` for the commit pipeline.
 *
 * Elements: each equipment piece (with its required attributes) plus each
 * process line (as a connector element carrying lineId + service). Connections:
 * the derived source→target edges, keyed by the process-line element id.
 */
export function buildSc1Edit(
  equipment: readonly Sc1Equipment[] = SC1_EQUIPMENT,
  connections: readonly Sc1Connection[] = SC1_CONNECTIONS,
): DiagramEdit {
  return {
    scene: SC1_SCENE,
    elements: [
      ...equipment.map((e) => ({
        id: e.placed.elementId,
        equipmentType: e.placed.symbolId,
        portIds: [...e.portIds],
        attributes: e.attributes,
      })),
      ...connections.map((c) => ({
        id: c.elementId,
        equipmentType: "process-line",
        portIds: [],
        attributes: c.attributes,
      })),
    ],
    connections: connections.map((c) => ({
      elementId: c.elementId,
      sourceElementId: c.source.elementId,
      targetElementId: c.target.elementId,
    })),
  };
}
