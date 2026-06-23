// Build export artifacts from the live placement model (DEV-1156 / DEV-1157).
//
// Pure + browser-free: derives the line list and an SVG from the SAME canonical
// projection the MCP read tools use (`buildCanonicalState`), so an exported line
// list matches the on-canvas topology exactly. The .excalidraw export needs the
// Excalidraw runtime and is built in the UI via a dynamic import; this module
// only handles the deterministic, runtime-free parts.

import { buildCanonicalState } from "@/lib/mcp-tools";
import { renderDiagramSvg } from "@/lib/diagram/render-svg";
import type { SymbolId } from "@/lib/symbols";
import type { ExportLineRow } from "@/lib/export/serializers";
import { placementModelToEdit, type PlacementModel } from "./placement-model";

/** The runtime-free export artifacts derived from a diagram model. */
export interface DiagramExport {
  /** Line-list rows enriched with each connector's `service` (DEV-1156). */
  readonly lineRows: readonly ExportLineRow[];
  /** SVG of the diagram, matching the canvas projection (DEV-1157). */
  readonly svg: string;
}

/** A non-empty string attribute value, else null. */
function stringAttr(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Derive the line list + SVG from the current model. Reuses the canonical-state
 * projection (so topology matches the read tools / canvas) and enriches each line
 * row with the connector's `service` attribute from the model.
 */
export function buildDiagramExport(model: PlacementModel): DiagramExport {
  const edit = placementModelToEdit(model);
  const state = buildCanonicalState({
    version: {
      id: "export",
      diagramId: "export",
      excalidrawScene: edit.scene,
      createdAt: "1970-01-01T00:00:00.000Z",
    },
    metadata: edit.elements.map((el) => ({
      diagramVersionId: "export",
      elementId: el.id,
      equipmentType: el.equipmentType as SymbolId,
      attributes: el.attributes,
    })),
  });

  const serviceByEdge = new Map(
    model.edges.map(
      (e) => [e.elementId, stringAttr(e.attributes.service)] as const,
    ),
  );
  const lineRows: ExportLineRow[] = state.lineList.map((row) => ({
    ...row,
    service: serviceByEdge.get(row.elementId) ?? null,
  }));

  return { lineRows, svg: renderDiagramSvg(state.renderState) };
}
