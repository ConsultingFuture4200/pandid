// Public surface of the extraction-equipment symbol library (DEV-1131, PRD §6).
//
// Consumers:
//   - DEV-1137 canvas/palette  → SYMBOL_DEFINITIONS, getSymbol
//   - DEV-1133 validator        → getRequiredAttributes (FR-11(d))
//   - `list_equipment_types`    → listEquipmentTypes (FR-6 read tool surface)
//
// This module exposes only pure data + pure functions. No canvas, no DB, no I/O.

import { SYMBOL_DEFINITIONS, SYMBOL_IDS } from "./definitions";
import type {
  EquipmentTypeSummary,
  RequiredAttribute,
  SymbolDefinition,
  SymbolId,
} from "./types";

export type {
  AttributeType,
  EquipmentTypeSummary,
  PrimitiveShape,
  RequiredAttribute,
  SymbolDefinition,
  SymbolId,
  SymbolKind,
  SymbolPort,
  SymbolPrimitive,
} from "./types";
export { SYMBOL_DEFINITIONS, SYMBOL_IDS } from "./definitions";
export { renderSymbolSvg } from "./render-svg";

/** Narrow an arbitrary string to a known SymbolId. */
export function isSymbolId(value: string): value is SymbolId {
  return Object.prototype.hasOwnProperty.call(SYMBOL_DEFINITIONS, value);
}

/**
 * Look up a symbol definition by id.
 * @throws if the id is unknown — callers at boundaries should pre-validate with `isSymbolId`.
 */
export function getSymbol(id: SymbolId): SymbolDefinition {
  const def = SYMBOL_DEFINITIONS[id];
  if (def === undefined) {
    throw new Error(`Unknown symbol id: ${id}`);
  }
  return def;
}

/** Required attributes (beyond the implicit identity field) for a symbol. */
export function getRequiredAttributes(id: SymbolId): readonly RequiredAttribute[] {
  return getSymbol(id).requiredAttributes;
}

/**
 * Enumerate the available equipment/connector types and their required attributes.
 * Backs the `list_equipment_types` MCP read tool (PRD §5.2). Pure; returns the
 * full set in palette order.
 */
export function listEquipmentTypes(): readonly EquipmentTypeSummary[] {
  return SYMBOL_IDS.map((id) => {
    const def = SYMBOL_DEFINITIONS[id];
    return {
      id: def.id,
      label: def.label,
      kind: def.kind,
      requiredAttributes: def.requiredAttributes,
    };
  });
}
