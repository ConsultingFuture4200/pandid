// Standard extraction-equipment symbol set (PRD §6).
//
// Authority note (PRD §6): "you design the set, client approves." This is the
// proposed v1 set; client approval gates dependent features (DEV-1133 validator,
// DEV-1137 canvas). Domain/house symbols are deferred to v2.
//
// `requiredAttributes` lists fields REQUIRED BEYOND the implicit identity field:
//   - equipment symbols are identified by `tag`
//   - the process line is identified by `lineId`
//   - the signal line carries no required attributes (dashed connector only)
// The implicit identity field is therefore not repeated in `requiredAttributes`.

import type { SymbolDefinition, SymbolId } from "./types";

// Geometry is intentionally simple and deterministic: every symbol lives in a
// 100x100 local box so the golden-SVG harness produces byte-stable output.
// These approximate ISA-5.1; they are not certified engineering symbols.

const EXTRACTION_COLUMN: SymbolDefinition = {
  id: "extraction-column",
  label: "Extraction column",
  kind: "equipment",
  requiredAttributes: [
    { key: "capacity", label: "Capacity", type: "string" },
    {
      key: "orientation",
      label: "Orientation",
      type: "enum",
      options: ["vertical", "horizontal"],
    },
  ],
  // Tall vertical vessel with rounded ends approximated by a tall rectangle.
  primitives: [{ shape: "rectangle", x: 35, y: 10, width: 30, height: 80 }],
  ports: [
    { id: "top", x: 50, y: 10 },
    { id: "bottom", x: 50, y: 90 },
    { id: "left", x: 35, y: 50 },
    { id: "right", x: 65, y: 50 },
  ],
};

const COLLECTION_TANK: SymbolDefinition = {
  id: "collection-tank",
  label: "Collection pot / tank",
  kind: "equipment",
  requiredAttributes: [{ key: "volume", label: "Volume", type: "string" }],
  // Squat horizontal vessel.
  primitives: [{ shape: "rectangle", x: 15, y: 30, width: 70, height: 50 }],
  ports: [
    { id: "top", x: 50, y: 30 },
    { id: "bottom", x: 50, y: 80 },
    { id: "left", x: 15, y: 55 },
    { id: "right", x: 85, y: 55 },
  ],
};

const CRC_COLUMN: SymbolDefinition = {
  id: "crc-column",
  label: "CRC column",
  kind: "equipment",
  requiredAttributes: [{ key: "mediaType", label: "Media type", type: "string" }],
  // Packed column: narrow tall rectangle with a centered packing band.
  primitives: [
    { shape: "rectangle", x: 40, y: 10, width: 20, height: 80 },
    { shape: "rectangle", x: 40, y: 35, width: 20, height: 30 },
  ],
  ports: [
    { id: "top", x: 50, y: 10 },
    { id: "bottom", x: 50, y: 90 },
  ],
};

const HEATER: SymbolDefinition = {
  id: "heater",
  label: "Heater",
  kind: "equipment",
  requiredAttributes: [
    { key: "duty", label: "Duty", type: "string" },
    { key: "medium", label: "Medium", type: "string" },
  ],
  // Circular exchanger body.
  primitives: [{ shape: "ellipse", x: 20, y: 20, width: 60, height: 60 }],
  ports: [
    { id: "left", x: 20, y: 50 },
    { id: "right", x: 80, y: 50 },
  ],
};

const CHILLER: SymbolDefinition = {
  id: "chiller",
  label: "Chiller",
  kind: "equipment",
  requiredAttributes: [
    { key: "duty", label: "Duty", type: "string" },
    { key: "medium", label: "Medium", type: "string" },
  ],
  // Circular exchanger body with an inner ring to distinguish from heater.
  primitives: [
    { shape: "ellipse", x: 20, y: 20, width: 60, height: 60 },
    { shape: "ellipse", x: 35, y: 35, width: 30, height: 30 },
  ],
  ports: [
    { id: "left", x: 20, y: 50 },
    { id: "right", x: 80, y: 50 },
  ],
};

const PUMP: SymbolDefinition = {
  id: "pump",
  label: "Pump",
  kind: "equipment",
  requiredAttributes: [{ key: "pumpType", label: "Type", type: "string" }],
  // Circle with a discharge nub approximated by a small triangle on top.
  primitives: [
    { shape: "ellipse", x: 25, y: 30, width: 50, height: 50 },
    {
      shape: "triangle",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [50, 30],
        [60, 10],
        [40, 10],
      ],
    },
  ],
  ports: [
    { id: "suction", x: 25, y: 55 },
    { id: "discharge", x: 75, y: 55 },
  ],
};

const GATE_VALVE: SymbolDefinition = {
  id: "gate-valve",
  label: "Gate valve",
  kind: "equipment",
  requiredAttributes: [{ key: "valveType", label: "Valve type", type: "string" }],
  // Classic bow-tie: two opposing triangles.
  primitives: [
    {
      shape: "triangle",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [20, 35],
        [20, 65],
        [50, 50],
      ],
    },
    {
      shape: "triangle",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [80, 35],
        [80, 65],
        [50, 50],
      ],
    },
  ],
  ports: [
    { id: "left", x: 20, y: 50 },
    { id: "right", x: 80, y: 50 },
  ],
};

const CHECK_VALVE: SymbolDefinition = {
  id: "check-valve",
  label: "Check valve",
  kind: "equipment",
  requiredAttributes: [{ key: "valveType", label: "Valve type", type: "string" }],
  // Single directional triangle with a seat bar (the stop) on the wide side.
  primitives: [
    {
      shape: "triangle",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [25, 35],
        [25, 65],
        [70, 50],
      ],
    },
    { shape: "line", x: 0, y: 0, width: 0, height: 0, points: [[70, 30], [70, 70]] },
  ],
  ports: [
    { id: "in", x: 25, y: 50 },
    { id: "out", x: 70, y: 50 },
  ],
};

const INSTRUMENT_BUBBLE: SymbolDefinition = {
  id: "instrument-bubble",
  label: "Instrument bubble",
  kind: "equipment",
  requiredAttributes: [
    { key: "measuredVariable", label: "Measured variable", type: "string" },
  ],
  // ISA instrument balloon: a circle.
  primitives: [{ shape: "ellipse", x: 25, y: 25, width: 50, height: 50 }],
  ports: [{ id: "process", x: 50, y: 75 }],
};

// ── Extraction-equipment set expansion (DEV-1200) ────────────────────────────
// Clean ISA-ish glyphs in the same 100x100 local box, using only the existing
// primitive shapes (rectangle/ellipse/triangle/line) so the golden renderer and
// the canvas adapter need no changes. Approximate ISA-5.1; not certified.

const VESSEL: SymbolDefinition = {
  id: "vessel",
  label: "Vessel / tank",
  kind: "equipment",
  // Generic labeled vessel — covers holding/warm/feed tanks and unlabeled boxes.
  requiredAttributes: [],
  primitives: [{ shape: "rectangle", x: 20, y: 15, width: 60, height: 70 }],
  ports: [
    { id: "top", x: 50, y: 15 },
    { id: "bottom", x: 50, y: 85 },
    { id: "left", x: 20, y: 50 },
    { id: "right", x: 80, y: 50 },
  ],
};

const CENTRIFUGE: SymbolDefinition = {
  id: "centrifuge",
  label: "Centrifuge",
  kind: "equipment",
  requiredAttributes: [],
  // Horizontal basket: an ellipse bowl with a centre axis line.
  primitives: [
    { shape: "ellipse", x: 15, y: 25, width: 70, height: 50 },
    { shape: "line", x: 0, y: 0, width: 0, height: 0, points: [[15, 50], [85, 50]] },
  ],
  ports: [
    { id: "feed", x: 50, y: 25 },
    { id: "left", x: 15, y: 50 },
    { id: "right", x: 85, y: 50 },
    { id: "discharge", x: 50, y: 75 },
  ],
};

const FILTER: SymbolDefinition = {
  id: "filter",
  label: "Filter",
  kind: "equipment",
  requiredAttributes: [{ key: "micronRating", label: "Micron rating", type: "string" }],
  // Housing with two cartridge columns.
  primitives: [
    { shape: "rectangle", x: 25, y: 15, width: 50, height: 70 },
    { shape: "rectangle", x: 35, y: 25, width: 10, height: 50 },
    { shape: "rectangle", x: 55, y: 25, width: 10, height: 50 },
  ],
  ports: [
    { id: "in", x: 25, y: 50 },
    { id: "out", x: 75, y: 50 },
  ],
};

const EVAPORATOR: SymbolDefinition = {
  id: "evaporator",
  label: "Evaporator",
  kind: "equipment",
  requiredAttributes: [{ key: "duty", label: "Duty", type: "string" }],
  // Tall shell with an internal tube bundle and a tapered (coned) bottom.
  primitives: [
    { shape: "rectangle", x: 35, y: 10, width: 30, height: 70 },
    { shape: "line", x: 0, y: 0, width: 0, height: 0, points: [[42, 15], [42, 75]] },
    { shape: "line", x: 0, y: 0, width: 0, height: 0, points: [[50, 15], [50, 75]] },
    { shape: "line", x: 0, y: 0, width: 0, height: 0, points: [[58, 15], [58, 75]] },
    { shape: "triangle", x: 0, y: 0, width: 0, height: 0, points: [[35, 80], [65, 80], [50, 92]] },
  ],
  ports: [
    { id: "top", x: 50, y: 10 },
    { id: "bottom", x: 50, y: 92 },
    { id: "side", x: 65, y: 45 },
  ],
};

const CONDENSER: SymbolDefinition = {
  id: "condenser",
  label: "Condenser",
  kind: "equipment",
  requiredAttributes: [{ key: "duty", label: "Duty", type: "string" }],
  // Shell with an internal serpentine cooling coil.
  primitives: [
    { shape: "rectangle", x: 25, y: 20, width: 50, height: 60 },
    {
      shape: "line",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [[30, 30], [45, 40], [30, 50], [45, 60], [30, 70]],
    },
  ],
  ports: [
    { id: "inlet", x: 50, y: 20 },
    { id: "outlet", x: 50, y: 80 },
  ],
};

const HEAT_EXCHANGER: SymbolDefinition = {
  id: "heat-exchanger",
  label: "Heat exchanger",
  kind: "equipment",
  requiredAttributes: [
    { key: "duty", label: "Duty", type: "string" },
    { key: "medium", label: "Medium", type: "string" },
  ],
  // Classic shell box with a zig-zag exchange element through it.
  primitives: [
    { shape: "rectangle", x: 20, y: 30, width: 60, height: 40 },
    {
      shape: "line",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [[25, 50], [40, 40], [55, 60], [70, 50]],
    },
  ],
  ports: [
    { id: "left", x: 20, y: 50 },
    { id: "right", x: 80, y: 50 },
    { id: "top", x: 50, y: 30 },
    { id: "bottom", x: 50, y: 70 },
  ],
};

const DIAPHRAGM_PUMP: SymbolDefinition = {
  id: "diaphragm-pump",
  label: "Diaphragm pump (AODP)",
  kind: "equipment",
  requiredAttributes: [{ key: "pumpType", label: "Type", type: "string" }],
  // Circular body with two opposed chevrons (the diaphragm).
  primitives: [
    { shape: "ellipse", x: 25, y: 25, width: 50, height: 50 },
    { shape: "line", x: 0, y: 0, width: 0, height: 0, points: [[40, 40], [50, 50], [40, 60]] },
    { shape: "line", x: 0, y: 0, width: 0, height: 0, points: [[60, 40], [50, 50], [60, 60]] },
  ],
  ports: [
    { id: "suction", x: 25, y: 50 },
    { id: "discharge", x: 75, y: 50 },
  ],
};

const BALL_VALVE: SymbolDefinition = {
  id: "ball-valve",
  label: "Ball valve",
  kind: "equipment",
  requiredAttributes: [{ key: "valveType", label: "Valve type", type: "string" }],
  // Bow-tie body with the ball drawn as a centre circle.
  primitives: [
    { shape: "triangle", x: 0, y: 0, width: 0, height: 0, points: [[20, 35], [20, 65], [50, 50]] },
    { shape: "triangle", x: 0, y: 0, width: 0, height: 0, points: [[80, 35], [80, 65], [50, 50]] },
    { shape: "ellipse", x: 42, y: 42, width: 16, height: 16 },
  ],
  ports: [
    { id: "left", x: 20, y: 50 },
    { id: "right", x: 80, y: 50 },
  ],
};

const EXPANSION_JOINT: SymbolDefinition = {
  id: "expansion-joint",
  label: "Expansion joint",
  kind: "equipment",
  requiredAttributes: [],
  // Inline pipe run with a central bellows (zig-zag).
  primitives: [
    {
      shape: "line",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [[10, 50], [30, 50], [36, 40], [44, 60], [52, 40], [60, 60], [66, 50], [90, 50]],
    },
  ],
  ports: [
    { id: "left", x: 10, y: 50 },
    { id: "right", x: 90, y: 50 },
  ],
};

const JUNCTION: SymbolDefinition = {
  id: "junction",
  label: "Junction / tee",
  kind: "equipment",
  // A structural branch point, not labeled equipment: no tag, no attributes.
  anonymous: true,
  requiredAttributes: [],
  // A small solid dot centred in the local box; bindable (ellipse) so pipes
  // attach. Filled so it reads as a tee, not a tiny vessel/instrument bubble.
  primitives: [{ shape: "ellipse", x: 44, y: 44, width: 12, height: 12, filled: true }],
  ports: [
    { id: "top", x: 50, y: 44 },
    { id: "bottom", x: 50, y: 56 },
    { id: "left", x: 44, y: 50 },
    { id: "right", x: 56, y: 50 },
  ],
};

const PROCESS_LINE: SymbolDefinition = {
  id: "process-line",
  label: "Process line",
  kind: "connector",
  // Identity field is `lineId`; `service` is the one extra required attribute.
  requiredAttributes: [{ key: "service", label: "Service", type: "string" }],
  // Solid horizontal connector across the local box.
  primitives: [{ shape: "line", x: 0, y: 0, width: 0, height: 0, points: [[10, 50], [90, 50]] }],
  ports: [
    { id: "start", x: 10, y: 50 },
    { id: "end", x: 90, y: 50 },
  ],
};

const SIGNAL_LINE: SymbolDefinition = {
  id: "signal-line",
  label: "Signal line",
  kind: "connector",
  // Dashed connector; carries no required attributes beyond identity (PRD §6).
  requiredAttributes: [],
  primitives: [
    { shape: "line", x: 0, y: 0, width: 0, height: 0, dashed: true, points: [[10, 50], [90, 50]] },
  ],
  ports: [
    { id: "start", x: 10, y: 50 },
    { id: "end", x: 90, y: 50 },
  ],
};

/**
 * The standard v1 symbol set, keyed by id. Insertion order is the palette order.
 * Includes two valve symbols (gate + check) to satisfy PRD §6 "Valve (gate/check, ≥2)".
 */
export const SYMBOL_DEFINITIONS: Readonly<Record<SymbolId, SymbolDefinition>> = {
  "extraction-column": EXTRACTION_COLUMN,
  "collection-tank": COLLECTION_TANK,
  "crc-column": CRC_COLUMN,
  heater: HEATER,
  chiller: CHILLER,
  pump: PUMP,
  "gate-valve": GATE_VALVE,
  "check-valve": CHECK_VALVE,
  "ball-valve": BALL_VALVE,
  "instrument-bubble": INSTRUMENT_BUBBLE,
  vessel: VESSEL,
  centrifuge: CENTRIFUGE,
  filter: FILTER,
  evaporator: EVAPORATOR,
  condenser: CONDENSER,
  "heat-exchanger": HEAT_EXCHANGER,
  "diaphragm-pump": DIAPHRAGM_PUMP,
  "expansion-joint": EXPANSION_JOINT,
  junction: JUNCTION,
  "process-line": PROCESS_LINE,
  "signal-line": SIGNAL_LINE,
};

/** All symbol ids in palette order. */
export const SYMBOL_IDS: readonly SymbolId[] = Object.keys(
  SYMBOL_DEFINITIONS,
) as SymbolId[];
