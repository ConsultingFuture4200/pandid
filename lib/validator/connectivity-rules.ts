// v1 connectivity / structural rules (DEV-1133, PRD §5.3 FR-11).
//
// These are the ONLY rules v1 ships. They check structure, never process
// topology ("CRC downstream of extraction" etc. are v2 — CLAUDE.md hard
// boundary). Each rule implements `ValidationRule` and is pure over the
// `DiagramSnapshot`; v2 domain rules slot in alongside these without any caller
// change (FR-12).
//
// FR-11 rules:
//   (a) every connection endpoint binds to a real element port
//   (b) no orphan / dangling connections
//   (c) equipment tags unique within the diagram
//   (d) required metadata fields present for each placed equipment type

import { SYMBOL_DEFINITIONS, getRequiredAttributes } from "@/lib/symbols";
import type { SymbolId } from "@/lib/symbols";
import type { ElementMetadata, JsonValue } from "@/lib/types";
import type {
  DiagramElement,
  DiagramSnapshot,
  ValidationError,
  ValidationRule,
} from "./types";

/** The implicit identity attribute key per kind (PRD §6). */
const EQUIPMENT_TAG_KEY = "tag";
const CONNECTOR_ID_KEY = "lineId";

function identityKeyFor(equipmentType: SymbolId): string {
  return SYMBOL_DEFINITIONS[equipmentType].kind === "equipment"
    ? EQUIPMENT_TAG_KEY
    : CONNECTOR_ID_KEY;
}

/** A present, non-empty string attribute. Blank/whitespace counts as missing. */
function nonEmptyString(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Index metadata by element id for O(1) lookup; last write wins (defensive). */
function metadataById(
  metadata: readonly ElementMetadata[],
): Map<string, ElementMetadata> {
  const map = new Map<string, ElementMetadata>();
  for (const entry of metadata) {
    map.set(entry.elementId, entry);
  }
  return map;
}

/**
 * Rule (a) + (b): every connection endpoint must bind to a real element port,
 * and neither endpoint may be unbound (orphan/dangling).
 *
 * Reported against the connection's own `elementId` (the arrow), per FR-13.
 */
export const endpointBindingRule: ValidationRule = {
  code: "endpoint-binding",
  validate(snapshot: DiagramSnapshot): readonly ValidationError[] {
    const errors: ValidationError[] = [];
    const elementsById = new Map<string, DiagramElement>(
      snapshot.elements.map((el) => [el.id, el]),
    );

    for (const connection of snapshot.connections) {
      const ends: ReadonlyArray<{ side: "source" | "target"; id: string | null }> = [
        { side: "source", id: connection.sourceElementId },
        { side: "target", id: connection.targetElementId },
      ];

      for (const end of ends) {
        // (b) unbound endpoint → orphan.
        if (end.id === null) {
          errors.push({
            code: "endpoint-unbound",
            elementId: connection.elementId,
            message: `Connection "${connection.elementId}" has an unbound ${end.side} endpoint. Attach it to an equipment port or delete the connection.`,
          });
          continue;
        }

        // (a) endpoint must reference a real element...
        const target = elementsById.get(end.id);
        if (target === undefined) {
          errors.push({
            code: "endpoint-missing-element",
            elementId: connection.elementId,
            message: `Connection "${connection.elementId}" binds its ${end.side} endpoint to element "${end.id}", which does not exist in the diagram. Rebind it to a placed element.`,
          });
          continue;
        }

        // ...and that element must expose at least one port to bind to.
        if (target.portIds.length === 0) {
          errors.push({
            code: "endpoint-missing-port",
            elementId: connection.elementId,
            message: `Connection "${connection.elementId}" binds its ${end.side} endpoint to element "${end.id}", which exposes no ports. Bind it to an element with a connection port.`,
          });
        }
      }
    }

    return errors;
  },
};

/**
 * Rule (c): equipment tags must be unique within the diagram.
 *
 * Only `equipment`-kind elements carry a `tag`; connectors are identified by
 * `lineId` and are out of scope here. A duplicate is reported on every element
 * that shares the offending tag so the UI can highlight all of them.
 */
export const uniqueTagRule: ValidationRule = {
  code: "unique-tag",
  validate(snapshot: DiagramSnapshot): readonly ValidationError[] {
    const metaMap = metadataById(snapshot.metadata);
    // tag (normalized) → element ids carrying it.
    const tagToElementIds = new Map<string, string[]>();

    for (const element of snapshot.elements) {
      if (SYMBOL_DEFINITIONS[element.equipmentType].kind !== "equipment") {
        continue;
      }
      const tag = metaMap.get(element.id)?.attributes[EQUIPMENT_TAG_KEY];
      if (!nonEmptyString(tag)) {
        // Missing tag is rule (d)'s concern, not (c)'s.
        continue;
      }
      const key = tag.trim();
      const ids = tagToElementIds.get(key);
      if (ids === undefined) {
        tagToElementIds.set(key, [element.id]);
      } else {
        ids.push(element.id);
      }
    }

    const errors: ValidationError[] = [];
    for (const [tag, elementIds] of tagToElementIds) {
      if (elementIds.length < 2) {
        continue;
      }
      for (const elementId of elementIds) {
        errors.push({
          code: "duplicate-tag",
          elementId,
          message: `Tag "${tag}" is used by ${elementIds.length} elements. Equipment tags must be unique within the diagram — give each element a distinct tag.`,
        });
      }
    }

    return errors;
  },
};

/**
 * Rule (d): required metadata present for each placed equipment type.
 *
 * "Required" = the implicit identity field (`tag` for equipment, `lineId` for a
 * connector) plus every entry in the symbol's `requiredAttributes` (DEV-1131).
 * Enum attributes additionally must hold one of the allowed options. A
 * placed element with no metadata row at all fails for each required field.
 */
export const requiredAttributesRule: ValidationRule = {
  code: "required-attributes",
  validate(snapshot: DiagramSnapshot): readonly ValidationError[] {
    const metaMap = metadataById(snapshot.metadata);
    const errors: ValidationError[] = [];

    for (const element of snapshot.elements) {
      const definition = SYMBOL_DEFINITIONS[element.equipmentType];
      const attributes = metaMap.get(element.id)?.attributes ?? {};

      // Implicit identity field.
      const identityKey = identityKeyFor(element.equipmentType);
      if (!nonEmptyString(attributes[identityKey])) {
        errors.push({
          code: "missing-required-attribute",
          elementId: element.id,
          message: `${definition.label} "${element.id}" is missing required attribute "${identityKey}". Set a value for it.`,
        });
      }

      // Type-specific required attributes (FR-11(d), driven by the symbol set).
      for (const required of getRequiredAttributes(element.equipmentType)) {
        const value = attributes[required.key];
        if (!nonEmptyString(value)) {
          errors.push({
            code: "missing-required-attribute",
            elementId: element.id,
            message: `${definition.label} "${element.id}" is missing required attribute "${required.label}". Set a value for it.`,
          });
          continue;
        }
        if (
          required.type === "enum" &&
          required.options !== undefined &&
          !required.options.includes(value)
        ) {
          errors.push({
            code: "missing-required-attribute",
            elementId: element.id,
            message: `${definition.label} "${element.id}" attribute "${required.label}" is "${value}", which is not an allowed value (${required.options.join(", ")}).`,
          });
        }
      }
    }

    return errors;
  },
};

/** The complete v1 connectivity rule set, in evaluation order. */
export const CONNECTIVITY_RULES: readonly ValidationRule[] = [
  endpointBindingRule,
  uniqueTagRule,
  requiredAttributesRule,
];
