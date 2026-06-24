// Canonical-state fixture for the server-side SVG render golden (DEV-1142).
//
// A small but representative known diagram, expressed as the canonical
// `DiagramRenderState` the server-side renderer consumes (placed equipment +
// connection edges). The "known diagram" the acceptance criterion asks for.
//
// Topology: an extraction column feeds a collection tank via one process line; a
// signal line runs from an instrument bubble to the tank. This exercises every
// render path that matters — rectangle + ellipse bodies, tag labels, and BOTH a
// solid (process) and a dashed (signal) connector — so the golden meaningfully
// guards the renderer.
//
// Connection endpoints are computed from the REAL symbol port geometry
// (`portPoint`) so the fixture stays honest against the symbol library: if a
// symbol's ports move, the golden must be regenerated, surfacing the change.
// Pure data — no I/O, no Excalidraw runtime.

import { getSymbol, type SymbolId } from "@/lib/symbols";
import type {
  DiagramRenderState,
  RenderConnection,
  RenderEquipment,
} from "./render-svg";

const LOCAL_BOX = 100;

/** Resolve a placed equipment's named port to a scene-space point. */
function portPoint(eq: RenderEquipment, portId: string): { x: number; y: number } {
  const def = getSymbol(eq.symbolId);
  const port = def.ports.find((p) => p.id === portId);
  if (port === undefined) {
    throw new Error(
      `Port '${portId}' does not exist on symbol '${eq.symbolId}'.`,
    );
  }
  const size = eq.size ?? 100;
  return {
    x: eq.x + (port.x / LOCAL_BOX) * size,
    y: eq.y + (port.y / LOCAL_BOX) * size,
  };
}

function equipment(
  elementId: string,
  symbolId: SymbolId,
  x: number,
  y: number,
  tag: string,
): RenderEquipment {
  return { elementId, symbolId, x, y, size: 100, tag };
}

const COLUMN = equipment("col-1", "extraction-column", 60, 40, "EX-101");
const TANK = equipment("tank-1", "collection-tank", 60, 240, "TK-101");
const INSTRUMENT = equipment("it-1", "instrument-bubble", 240, 240, "LT-1");

const EQUIPMENT: readonly RenderEquipment[] = [COLUMN, TANK, INSTRUMENT];

const CONNECTIONS: readonly RenderConnection[] = [
  {
    elementId: "line-1",
    start: portPoint(COLUMN, "bottom"),
    end: portPoint(TANK, "top"),
    dashed: false,
    sourceElementId: COLUMN.elementId,
    targetElementId: TANK.elementId,
  },
  {
    elementId: "sig-1",
    start: portPoint(INSTRUMENT, "process"),
    end: portPoint(TANK, "right"),
    dashed: true,
    sourceElementId: INSTRUMENT.elementId,
    targetElementId: TANK.elementId,
  },
];

/** The known diagram rendered by the DEV-1142 golden test. */
export const RENDER_FIXTURE: DiagramRenderState = {
  equipment: EQUIPMENT,
  connections: CONNECTIONS,
  viewport: { width: 420, height: 400 },
};
