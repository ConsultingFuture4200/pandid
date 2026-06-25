// Render fixture for the inline-valve golden (DEV-1211).
//
// A horizontal run between two collection tanks with a ball valve placed inline
// via `inlineValve`. The valve sits centred on the run and both pipe halves stay
// colinear through it — the geometry the golden guards, and the same shape the
// canvas draws (both consume the shared orthogonal router). Pure data.

import { getSymbol } from "@/lib/symbols";
import type {
  DiagramRenderState,
  RenderConnection,
  RenderEquipment,
} from "@/lib/diagram/render-svg";
import { at, place, inlineValve } from "./build";

const TANK_A = place("eq-tank-a", "collection-tank", 40, 40, { tag: "TK-1" });
const TANK_B = place("eq-tank-b", "collection-tank", 340, 40, { tag: "TK-2" });

const VALVE = inlineValve(
  "eq-bv",
  "ball-valve",
  at(TANK_A, "right"),
  at(TANK_B, "left"),
  { attributes: { tag: "BV-1", valveType: "ball" } },
);

/** The placed nodes (two tanks + the inline valve) and the two pipe segments. */
export const INLINE_VALVE_SCENE = {
  tankA: TANK_A,
  tankB: TANK_B,
  valve: VALVE,
} as const;

const EQUIPMENT: readonly RenderEquipment[] = [
  { elementId: TANK_A.elementId, symbolId: TANK_A.symbolId, x: TANK_A.x, y: TANK_A.y, size: TANK_A.size, tag: "TK-1" },
  { elementId: VALVE.valve.elementId, symbolId: VALVE.valve.symbolId, x: VALVE.valve.x, y: VALVE.valve.y, size: VALVE.valve.size, tag: "BV-1" },
  { elementId: TANK_B.elementId, symbolId: TANK_B.symbolId, x: TANK_B.x, y: TANK_B.y, size: TANK_B.size, tag: "TK-2" },
];

const CONNECTIONS: readonly RenderConnection[] = VALVE.segments.map((s) => ({
  elementId: s.elementId,
  start: s.start ?? { x: 0, y: 0 },
  end: s.end ?? { x: 0, y: 0 },
  dashed: false,
  sourceElementId: s.sourceElementId ?? undefined,
  targetElementId: s.targetElementId ?? undefined,
}));

// Reference getSymbol so a symbol-shape change that breaks the fixture surfaces
// here too (keeps the golden honest, mirroring render-svg.fixture).
void getSymbol("ball-valve");

/** Canonical render state for the inline-valve golden. */
export const INLINE_VALVE_RENDER_STATE: DiagramRenderState = {
  equipment: EQUIPMENT,
  connections: CONNECTIONS,
  viewport: { width: 480, height: 220 },
};
