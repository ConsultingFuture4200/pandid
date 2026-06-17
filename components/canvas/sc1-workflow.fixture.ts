// Canonical SC-1 manual-workflow scene (DEV-1141, PRD SC-1).
//
// SC-1: "A user can draw a 4-column→header→collection-tank P&ID manually, save,
// reload." This fixture is the deterministic data for that diagram, shared by:
//   - the 🟡 golden SVG test (sc1WorkflowToSvg + golden compare),
//   - the commit/round-trip vitest (build a DiagramEdit, save, reload, compare),
//   - the Playwright E2E (seed the same arrangement on a real canvas).
//
// Topology (top→bottom process flow):
//   four extraction columns  →  header (collecting manifold vessel)  →  tank
// Each column connects into the header via a process line; the header connects
// to the collection tank via a process line. The "header" is modelled with the
// approved `collection-tank` symbol (a horizontal pot/manifold vessel) because
// PRD §6's standard set has no dedicated header symbol and the set is frozen for
// v1 — inventing a symbol here would cross the symbol-approval gate (EXECUTION.md
// §"Symbol-set approval gate"). This is a structural stand-in, not a new symbol.
//
// Every equipment element carries its symbol's required attributes plus the `tag`
// identity field, and every process line carries `lineId` + `service`, so the
// diagram passes the v1 connectivity validator (DEV-1133) unmodified — SC-1 is a
// *valid* diagram that must save and reload intact.
//
// IMPORTANT (CLAUDE.md fact #1): no metadata rides on the Excalidraw elements;
// attributes live in the parallel store. This module is pure data — no I/O, no
// Excalidraw runtime — so it is unit- and golden-testable without a browser.

import type { JsonObject } from "@/lib/types";
import type { PlacedEquipment } from "./connection-binding";

/** A placed piece of equipment plus the metadata it carries in the parallel store. */
export interface Sc1Equipment {
  readonly placed: PlacedEquipment;
  /** Equipment attributes for the parallel metadata store (incl. `tag`). */
  readonly attributes: JsonObject;
  /** Port ids this element exposes. */
  readonly portIds: readonly string[];
}

/** A process-line connection between two equipment ports, plus its attributes. */
export interface Sc1Connection {
  /** Excalidraw element id of the line. */
  readonly elementId: string;
  /** Source endpoint: element id + chosen port. */
  readonly source: { readonly elementId: string; readonly portId: string };
  /** Target endpoint: element id + chosen port. */
  readonly target: { readonly elementId: string; readonly portId: string };
  /** Line attributes for the parallel metadata store (incl. `lineId`). */
  readonly attributes: JsonObject;
}

/** Footprint each symbol is placed at (px); shared by render + placement. */
export const SC1_PLACEMENT_SIZE = 100;

/** The four extraction columns, spread along the top, feeding the header. */
const COLUMNS: readonly Sc1Equipment[] = [1, 2, 3, 4].map((n, i) => ({
  placed: {
    elementId: `col-${n}`,
    symbolId: "extraction-column",
    x: 40 + i * 140,
    y: 40,
    size: SC1_PLACEMENT_SIZE,
  },
  attributes: {
    tag: `EX-10${n}`,
    capacity: "5L",
    orientation: "vertical",
  },
  portIds: ["top", "bottom", "left", "right"],
}));

/** The header: a horizontal manifold vessel collecting the four columns. */
const HEADER: Sc1Equipment = {
  placed: {
    elementId: "header-1",
    symbolId: "collection-tank",
    x: 220,
    y: 220,
    size: SC1_PLACEMENT_SIZE,
  },
  attributes: { tag: "HDR-1", volume: "10L" },
  portIds: ["top", "bottom", "left", "right"],
};

/** The collection tank: the downstream destination. */
const TANK: Sc1Equipment = {
  placed: {
    elementId: "tank-1",
    symbolId: "collection-tank",
    x: 220,
    y: 380,
    size: SC1_PLACEMENT_SIZE,
  },
  attributes: { tag: "TK-101", volume: "200L" },
  portIds: ["top", "bottom", "left", "right"],
};

/** All six equipment elements in placement order. */
export const SC1_EQUIPMENT: readonly Sc1Equipment[] = [...COLUMNS, HEADER, TANK];

/**
 * Five process lines: one from each column's bottom into the header top, and one
 * from the header bottom into the tank top. Every line is fully attributed.
 */
export const SC1_CONNECTIONS: readonly Sc1Connection[] = [
  ...COLUMNS.map(
    (col, i): Sc1Connection => ({
      elementId: `line-col-${i + 1}`,
      source: { elementId: col.placed.elementId, portId: "bottom" },
      target: { elementId: HEADER.placed.elementId, portId: "top" },
      attributes: { lineId: `L-${i + 1}`, service: "extract" },
    }),
  ),
  {
    elementId: "line-header-tank",
    source: { elementId: HEADER.placed.elementId, portId: "bottom" },
    target: { elementId: TANK.placed.elementId, portId: "top" },
    attributes: { lineId: "L-5", service: "miscella" },
  },
];

/** Viewport the golden SVG is rendered into. */
export const SC1_VIEWPORT = { width: 620, height: 520 } as const;

/** Canonical Excalidraw scene wrapper persisted as the version's scene JSON. */
export const SC1_SCENE: JsonObject = {
  type: "excalidraw",
  elements: [],
  appState: {},
};
