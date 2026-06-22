// Attribute-editor field derivation + pure model updates (this task: equipment
// attribute editor for /editor).
//
// The attribute panel is DRIVEN BY the symbol library (lib/symbols), never by a
// per-type hardcoded form. For a selected `PlacedNode` we derive exactly the
// fields the validator's `requiredAttributesRule` checks:
//
//   - the implicit IDENTITY field — `tag` for equipment, `lineId` for a connector
//     (mirrors lib/validator/connectivity-rules `identityKeyFor`), then
//   - every entry in the symbol's `requiredAttributes` (DEV-1131), carrying its
//     label, datatype hint, and — for enums — the constrained option set.
//
// Each field reports whether it is still MISSING using the same "non-empty
// string, enum value must be an allowed option" predicate the validator applies,
// so what the panel flags as missing is exactly what would block a Save.
//
// Pure + browser-free + deterministic: no React, no Excalidraw, no I/O — so the
// field derivation and the model update are unit-testable without a canvas.

import {
  SYMBOL_DEFINITIONS,
  getRequiredAttributes,
  type AttributeType,
  type SymbolId,
} from "@/lib/symbols";
import type { JsonObject, JsonValue } from "@/lib/types";
import type {
  PlacedEdge,
  PlacedNode,
  PlacementModel,
} from "./placement-model";

/** Identity attribute key per kind — mirrors the validator (PRD §6). */
const EQUIPMENT_TAG_KEY = "tag";
const CONNECTOR_ID_KEY = "lineId";

/** The implicit identity field's key for a symbol's kind. */
function identityKeyFor(symbolId: SymbolId): string {
  return SYMBOL_DEFINITIONS[symbolId].kind === "equipment"
    ? EQUIPMENT_TAG_KEY
    : CONNECTOR_ID_KEY;
}

/**
 * A present, non-empty string attribute. Blank/whitespace counts as missing.
 * Same predicate the validator's `requiredAttributesRule` uses, so the panel's
 * "missing" markers match exactly what blocks a Save.
 */
function nonEmptyString(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** One row the attribute panel renders: a labeled input bound to one attribute. */
export interface AttributeField {
  /** Machine key written into `node.attributes`. */
  readonly key: string;
  /** Human-facing label. */
  readonly label: string;
  /** Input kind — `enum` renders a <select> over `options`. */
  readonly type: AttributeType;
  /** Allowed values when `type === "enum"`; omitted otherwise. */
  readonly options?: readonly string[];
  /** Current value as a string for input binding ("" when unset/non-string). */
  readonly value: string;
  /** True when this required field is still unsatisfied (validator would block). */
  readonly missing: boolean;
}

/** Read an attribute as an input-bindable string ("" when unset/non-string). */
function asInputValue(attributes: JsonObject, key: string): string {
  const value = attributes[key];
  return typeof value === "string" ? value : "";
}

/** Is a required field satisfied? Mirrors the validator (enum must be allowed). */
function fieldSatisfied(
  attributes: JsonObject,
  key: string,
  type: AttributeType,
  options: readonly string[] | undefined,
): boolean {
  const value = attributes[key];
  if (!nonEmptyString(value)) {
    return false;
  }
  if (type === "enum" && options !== undefined && !options.includes(value)) {
    return false;
  }
  return true;
}

/**
 * Derive the ordered list of required fields for any placed symbol (node OR
 * edge), pre-filled from its current attributes and flagged for missingness —
 * driven entirely by the symbol library, never hardcoded per type. The identity
 * field (`tag` for equipment, `lineId` for a connector) leads, then the symbol's
 * declared required attributes in definition order. Shared by the node and edge
 * derivations so both stay in lockstep with the validator.
 */
function symbolAttributeFields(
  symbolId: SymbolId,
  attributes: JsonObject,
): readonly AttributeField[] {
  const fields: AttributeField[] = [];

  const identityKey = identityKeyFor(symbolId);
  fields.push({
    key: identityKey,
    label: identityKey === EQUIPMENT_TAG_KEY ? "Tag" : "Line ID",
    type: "string",
    value: asInputValue(attributes, identityKey),
    missing: !fieldSatisfied(attributes, identityKey, "string", undefined),
  });

  for (const required of getRequiredAttributes(symbolId)) {
    fields.push({
      key: required.key,
      label: required.label,
      type: required.type,
      ...(required.options !== undefined ? { options: required.options } : {}),
      value: asInputValue(attributes, required.key),
      missing: !fieldSatisfied(
        attributes,
        required.key,
        required.type,
        required.options,
      ),
    });
  }

  return fields;
}

/** Required fields for a placed equipment node (see {@link symbolAttributeFields}). */
export function nodeAttributeFields(node: PlacedNode): readonly AttributeField[] {
  return symbolAttributeFields(node.symbolId, node.attributes);
}

/** Required fields for a connection edge: identity `lineId` then required line
 * attributes (e.g. `service`). Drives the edge attribute editor (DEV-1194). */
export function edgeAttributeFields(edge: PlacedEdge): readonly AttributeField[] {
  return symbolAttributeFields(edge.symbolId, edge.attributes);
}

/**
 * Return a new model with a single attribute on one node (by element id) set to
 * `value`. Pure: never mutates the input model/node (PlacementModel is readonly).
 * A node id that is not present yields the model unchanged.
 */
export function setNodeAttribute(
  model: PlacementModel,
  nodeElementId: string,
  key: string,
  value: string,
): PlacementModel {
  let changed = false;
  const nodes = model.nodes.map((node) => {
    if (node.elementId !== nodeElementId) {
      return node;
    }
    changed = true;
    return { ...node, attributes: { ...node.attributes, [key]: value } };
  });
  if (!changed) {
    return model;
  }
  return { ...model, nodes };
}

/** Look up a node by its element id, or null when absent. */
export function findNode(
  model: PlacementModel,
  nodeElementId: string | null,
): PlacedNode | null {
  if (nodeElementId === null) {
    return null;
  }
  return model.nodes.find((n) => n.elementId === nodeElementId) ?? null;
}

/**
 * Return a new model with a single attribute on one edge (by element id) set to
 * `value`. Pure: never mutates the input model/edge. An edge id that is not
 * present yields the model unchanged. Mirrors {@link setNodeAttribute} for the
 * edge attribute editor (DEV-1194).
 */
export function setEdgeAttribute(
  model: PlacementModel,
  edgeElementId: string,
  key: string,
  value: string,
): PlacementModel {
  let changed = false;
  const edges = model.edges.map((edge) => {
    if (edge.elementId !== edgeElementId) {
      return edge;
    }
    changed = true;
    return { ...edge, attributes: { ...edge.attributes, [key]: value } };
  });
  if (!changed) {
    return model;
  }
  return { ...model, edges };
}

/** Look up an edge by its element id, or null when absent. */
export function findEdge(
  model: PlacementModel,
  edgeElementId: string | null,
): PlacedEdge | null {
  if (edgeElementId === null) {
    return null;
  }
  return model.edges.find((e) => e.elementId === edgeElementId) ?? null;
}
