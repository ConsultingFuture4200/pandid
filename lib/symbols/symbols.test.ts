// Tests for the extraction-equipment symbol library (DEV-1131, PRD §6).
//
// Covers the three acceptance criteria:
//   1. Each symbol defined with its required-attribute set.
//   2. A golden SVG fixture per symbol matches the renderer within tolerance (🟡).
//   3. `listEquipmentTypes` enumerates them all.
//
// Run via the project test command once the DEV-1129 scaffold lands:
//   pnpm test
// (vitest config + toolchain are owned by DEV-1129, not this task.)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SYMBOL_DEFINITIONS,
  SYMBOL_IDS,
  getRequiredAttributes,
  getSymbol,
  isSymbolId,
  listEquipmentTypes,
  renderSymbolSvg,
  type SymbolId,
} from "./index";

const goldenDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "golden",
);

// PRD §6 required attributes BEYOND the implicit identity field
// (tag for equipment, lineId for process-line, none for signal-line).
const EXPECTED_REQUIRED_KEYS: Readonly<Record<SymbolId, readonly string[]>> = {
  "extraction-column": ["capacity", "orientation"],
  "collection-tank": ["volume"],
  "crc-column": ["mediaType"],
  heater: ["duty", "medium"],
  chiller: ["duty", "medium"],
  pump: ["pumpType"],
  "gate-valve": ["valveType"],
  "check-valve": ["valveType"],
  "instrument-bubble": ["measuredVariable"],
  "process-line": ["service"],
  "signal-line": [],
};

/**
 * Normalize an SVG for visual-diff comparison within tolerance.
 * Collapses insignificant whitespace and rounds numeric coordinates to the
 * nearest integer so a sub-pixel rendering drift does not fail the snapshot,
 * while any geometry/topology change still does.
 */
function normalizeSvg(svg: string): string {
  return svg
    .replace(/\s+/g, " ")
    .replace(/-?\d+\.\d+/g, (m) => String(Math.round(Number(m))))
    .trim();
}

describe("symbol library — definitions", () => {
  it("defines exactly the PRD §6 standard set (11 symbols, ≥2 valves)", () => {
    expect(SYMBOL_IDS).toHaveLength(11);
    const valves = SYMBOL_IDS.filter((id) => id.endsWith("-valve"));
    expect(valves.length).toBeGreaterThanOrEqual(2);
  });

  it.each(SYMBOL_IDS)("'%s' carries its PRD §6 required attributes", (id) => {
    const keys = getRequiredAttributes(id).map((a) => a.key);
    expect(keys).toEqual(EXPECTED_REQUIRED_KEYS[id]);
  });

  it.each(SYMBOL_IDS)("'%s' has a non-empty primitive skeleton and ports", (id) => {
    const def = getSymbol(id);
    expect(def.primitives.length).toBeGreaterThan(0);
    expect(def.ports.length).toBeGreaterThan(0);
  });

  it("enum attributes declare options; non-enum attributes do not", () => {
    for (const id of SYMBOL_IDS) {
      for (const attr of getRequiredAttributes(id)) {
        if (attr.type === "enum") {
          expect(attr.options && attr.options.length).toBeGreaterThan(0);
        } else {
          expect(attr.options).toBeUndefined();
        }
      }
    }
  });

  it("classifies process/signal lines as connectors and the rest as equipment", () => {
    expect(getSymbol("process-line").kind).toBe("connector");
    expect(getSymbol("signal-line").kind).toBe("connector");
    expect(getSymbol("pump").kind).toBe("equipment");
  });

  it("isSymbolId narrows known ids and rejects unknown ones", () => {
    expect(isSymbolId("pump")).toBe(true);
    expect(isSymbolId("flux-capacitor")).toBe(false);
  });
});

describe("symbol library — list_equipment_types", () => {
  it("enumerates every symbol with id, label, kind, and required attributes", () => {
    const listed = listEquipmentTypes();
    expect(listed.map((t) => t.id)).toEqual([...SYMBOL_IDS]);
    for (const t of listed) {
      expect(t.label).toBe(SYMBOL_DEFINITIONS[t.id].label);
      expect(t.kind).toBe(SYMBOL_DEFINITIONS[t.id].kind);
      expect(t.requiredAttributes).toEqual(SYMBOL_DEFINITIONS[t.id].requiredAttributes);
    }
  });
});

describe("symbol library — golden SVG (🟡 visual diff)", () => {
  it.each(SYMBOL_IDS)("'%s' renders matching its golden fixture", (id) => {
    const golden = readFileSync(join(goldenDir, `${id}.svg`), "utf8");
    const rendered = renderSymbolSvg(getSymbol(id));
    expect(normalizeSvg(rendered)).toBe(normalizeSvg(golden));
  });

  it("signal line is the dashed connector", () => {
    const golden = readFileSync(join(goldenDir, "signal-line.svg"), "utf8");
    expect(golden).toContain("stroke-dasharray");
  });
});
