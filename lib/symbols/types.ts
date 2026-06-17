// Symbol-library types for the extraction-equipment P&ID set (PRD §6).
//
// Scope (DEV-1131): symbol definitions, required-attribute sets, and a pure
// enumeration surface. NO canvas wiring (that is DEV-1137 / task 9) and NO
// process/domain rules (deferred to v2 per CLAUDE.md hard boundaries).
//
// Symbols are described as primitive skeletons — the minimal geometry a renderer
// (golden-SVG harness here; Excalidraw `convertToExcalidrawElements` at the
// canvas layer) consumes. Equipment metadata never rides on Excalidraw
// `customData` (it is dropped on conversion); the parallel metadata store
// (DEV-1136) is the single source of truth. These definitions only declare
// WHICH attributes are required, not where they are stored.

/** Stable identifier for an equipment/connector symbol. kebab-case by convention. */
export type SymbolId =
  | "extraction-column"
  | "collection-tank"
  | "crc-column"
  | "heater"
  | "chiller"
  | "pump"
  | "gate-valve"
  | "check-valve"
  | "instrument-bubble"
  | "process-line"
  | "signal-line";

/**
 * Coarse classification used by the palette and the validator.
 * - `equipment`  — a placeable node carrying metadata (extraction column, pump, ...).
 * - `connector`  — an edge between equipment ports (process line, signal line).
 */
export type SymbolKind = "equipment" | "connector";

/** Datatype hint for a required attribute, used by metadata-entry UIs and validation. */
export type AttributeType = "string" | "number" | "enum";

/** A single required attribute on a symbol (drives FR-11(d) and FR-14). */
export interface RequiredAttribute {
  /** camelCase machine key, e.g. `measuredVariable`. */
  readonly key: string;
  /** Human-facing label, e.g. "Measured variable". */
  readonly label: string;
  readonly type: AttributeType;
  /** Allowed values when `type === "enum"`. Omitted otherwise. */
  readonly options?: readonly string[];
}

/** Supported primitive geometries for symbol skeletons (approximate ISA, not certified). */
export type PrimitiveShape = "rectangle" | "ellipse" | "diamond" | "line" | "triangle";

/** One primitive within a symbol's skeleton, in the symbol's local 100x100 box. */
export interface SymbolPrimitive {
  readonly shape: PrimitiveShape;
  /** Local-space x (0..100). */
  readonly x: number;
  /** Local-space y (0..100). */
  readonly y: number;
  /** Width in local space. Ignored for `line`. */
  readonly width: number;
  /** Height in local space. Ignored for `line`. */
  readonly height: number;
  /** Dashed stroke (e.g. signal lines). Defaults to solid. */
  readonly dashed?: boolean;
  /** Polyline points in local space for `line`/`triangle`; required for those shapes. */
  readonly points?: readonly (readonly [number, number])[];
}

/** A port: a named bind point connectors attach to (consumed by DEV-1138 bind-on-create). */
export interface SymbolPort {
  readonly id: string;
  /** Local-space x (0..100). */
  readonly x: number;
  /** Local-space y (0..100). */
  readonly y: number;
}

/** A complete symbol definition. Immutable. */
export interface SymbolDefinition {
  readonly id: SymbolId;
  readonly label: string;
  readonly kind: SymbolKind;
  /** Required attributes beyond the implicit identity field (tag / line id). */
  readonly requiredAttributes: readonly RequiredAttribute[];
  /** Primitive skeleton in a 100x100 local box. */
  readonly primitives: readonly SymbolPrimitive[];
  /** Bind points. Connectors expose endpoint ports; equipment exposes side ports. */
  readonly ports: readonly SymbolPort[];
}

/** Public shape returned by `listEquipmentTypes` / the `list_equipment_types` MCP tool. */
export interface EquipmentTypeSummary {
  readonly id: SymbolId;
  readonly label: string;
  readonly kind: SymbolKind;
  readonly requiredAttributes: readonly RequiredAttribute[];
}
