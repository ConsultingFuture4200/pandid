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
  "instrument-bubble": INSTRUMENT_BUBBLE,
  "process-line": PROCESS_LINE,
  "signal-line": SIGNAL_LINE,
};

/** All symbol ids in palette order. */
export const SYMBOL_IDS: readonly SymbolId[] = Object.keys(
  SYMBOL_DEFINITIONS,
) as SymbolId[];
