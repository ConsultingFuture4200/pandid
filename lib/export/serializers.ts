// Export serializers (DEV-1156 line list, DEV-1157 .excalidraw).
//
// Pure string producers — no I/O, no Excalidraw runtime — so they are unit-stable
// and reusable from a server action or the browser. The DATA they serialize is
// derived elsewhere (the `LineListRow[]` from the canonical-state projection, the
// Excalidraw element list from the canvas); these functions only format it.

import type { LineListRow } from "@/lib/mcp-tools/canonical-state";

/** Columns of the exported line list, in order (FR-15). */
const LINE_LIST_COLUMNS = [
  "lineId",
  "fromTag",
  "toTag",
  "service",
  "type",
] as const;

/** A line-list row enriched with the metadata the export shows. The canonical
 * `LineListRow` carries ids + tags + signal; `service` comes from the connector's
 * attributes (looked up by the caller). */
export interface ExportLineRow extends LineListRow {
  /** The connector's `service` attribute, if any. */
  readonly service: string | null;
}

/** Escape one CSV field per RFC 4180: quote when it contains a comma, quote, or
 * newline, doubling embedded quotes. */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// ── Equipment schedule (the companion to the line list) ──────────────────────

/** One row of the equipment schedule: a placed piece of equipment with its tag,
 * human type, and the (string) attributes the metadata store carries. Anonymous
 * structural nodes (junction tees) and connectors are not equipment and are
 * excluded by the caller. */
export interface ExportEquipmentRow {
  readonly tag: string | null;
  /** Human symbol label, e.g. "Extraction column". */
  readonly type: string;
  /** Machine symbol id, e.g. "extraction-column". */
  readonly equipmentType: string;
  /** Non-tag string attributes (capacity, duty, medium, …). */
  readonly attributes: Readonly<Record<string, string>>;
}

/** Fixed columns of the exported equipment schedule, in order. */
const EQUIPMENT_COLUMNS = ["item", "tag", "type", "specification"] as const;

/** The "specification" cell: non-tag, non-blank attributes as "key: value",
 * sorted by key so the output is deterministic. */
function specification(attributes: Readonly<Record<string, string>>): string {
  return Object.keys(attributes)
    .filter((k) => k !== "tag" && attributes[k].trim() !== "")
    .sort()
    .map((k) => `${k}: ${attributes[k]}`)
    .join("; ");
}

/**
 * Serialize the equipment schedule to CSV: a header plus one row per piece of
 * equipment, numbered, in input (placement) order. RFC-4180 quoting.
 */
export function equipmentScheduleToCsv(rows: readonly ExportEquipmentRow[]): string {
  const header = EQUIPMENT_COLUMNS.join(",");
  const body = rows.map((row, i) =>
    [String(i + 1), row.tag ?? "", row.type, specification(row.attributes)]
      .map(csvField)
      .join(","),
  );
  return [header, ...body].join("\n");
}

/**
 * Serialize the equipment schedule to pretty JSON: an array of records carrying
 * the full structured attributes (so CSV and JSON describe the same equipment).
 */
export function equipmentScheduleToJson(rows: readonly ExportEquipmentRow[]): string {
  const records = rows.map((row, i) => ({
    item: i + 1,
    tag: row.tag,
    type: row.type,
    equipmentType: row.equipmentType,
    attributes: row.attributes,
  }));
  return JSON.stringify(records, null, 2);
}

/** The display value for a line-list cell (blank for an absent/null value). */
function cell(row: ExportLineRow, column: (typeof LINE_LIST_COLUMNS)[number]): string {
  switch (column) {
    case "lineId":
      return row.lineId ?? "";
    case "fromTag":
      return row.fromTag ?? "";
    case "toTag":
      return row.toTag ?? "";
    case "service":
      return row.service ?? "";
    case "type":
      return row.signal ? "signal" : "process";
  }
}

/**
 * Serialize the line list to CSV (FR-15): a header row plus one row per
 * connection, in input order. RFC-4180 quoting so tags/services with commas or
 * quotes round-trip.
 */
export function lineListToCsv(rows: readonly ExportLineRow[]): string {
  const header = LINE_LIST_COLUMNS.join(",");
  const body = rows.map((row) =>
    LINE_LIST_COLUMNS.map((c) => csvField(cell(row, c))).join(","),
  );
  return [header, ...body].join("\n");
}

/**
 * Serialize the line list to pretty JSON (FR-15): an array of objects keyed by
 * the same columns, so CSV and JSON describe identical topology.
 */
export function lineListToJson(rows: readonly ExportLineRow[]): string {
  const records = rows.map((row) => ({
    lineId: row.lineId,
    fromTag: row.fromTag,
    toTag: row.toTag,
    service: row.service,
    type: row.signal ? "signal" : "process",
    fromElementId: row.fromElementId,
    toElementId: row.toElementId,
  }));
  return JSON.stringify(records, null, 2);
}

/**
 * Wrap an Excalidraw element list in the `.excalidraw` file envelope (FR-16) so
 * the export opens in excalidraw.com. The elements are produced by the canvas
 * layer (`convertToExcalidrawElements`); this only frames them.
 */
export function toExcalidrawFile(elements: readonly unknown[]): string {
  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "https://pandid.vercel.app",
      elements,
      appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
      files: {},
    },
    null,
    2,
  );
}
