// Render fixture for the obstacle-avoidance golden (DEV-1210).
//
// Two collection tanks on a horizontal run with a vessel sitting directly on the
// straight line between them. The connection's source/target are the tanks, so
// the vessel is an OBSTACLE: the run must bend around it instead of drawing
// through it. Guards the multi-bend autorouter end-to-end through the SVG render.

import type {
  DiagramRenderState,
  RenderConnection,
  RenderEquipment,
} from "./render-svg";
import { at, connect, place } from "@/lib/templates/build";

const TANK_A = place("eq-a", "collection-tank", 40, 200, { tag: "TK-1" });
const BLOCKER = place("eq-blk", "vessel", 240, 200, { tag: "V-1" });
const TANK_B = place("eq-b", "collection-tank", 440, 200, { tag: "TK-2" });

const LINE = connect("line-1", at(TANK_A, "right"), at(TANK_B, "left"));

const EQUIPMENT: readonly RenderEquipment[] = [
  { elementId: TANK_A.elementId, symbolId: TANK_A.symbolId, x: TANK_A.x, y: TANK_A.y, size: TANK_A.size, tag: "TK-1" },
  { elementId: BLOCKER.elementId, symbolId: BLOCKER.symbolId, x: BLOCKER.x, y: BLOCKER.y, size: BLOCKER.size, tag: "V-1" },
  { elementId: TANK_B.elementId, symbolId: TANK_B.symbolId, x: TANK_B.x, y: TANK_B.y, size: TANK_B.size, tag: "TK-2" },
];

const CONNECTIONS: readonly RenderConnection[] = [
  {
    elementId: LINE.elementId,
    start: LINE.start ?? { x: 0, y: 0 },
    end: LINE.end ?? { x: 0, y: 0 },
    dashed: false,
    sourceElementId: LINE.sourceElementId ?? undefined,
    targetElementId: LINE.targetElementId ?? undefined,
  },
];

/** Endpoints + the blocker, for the geometry assertions. */
export const OBSTACLE_SCENE = { line: LINE, blocker: BLOCKER } as const;

/** Canonical render state for the obstacle-avoidance golden. */
export const OBSTACLE_ROUTE_RENDER_STATE: DiagramRenderState = {
  equipment: EQUIPMENT,
  connections: CONNECTIONS,
  viewport: { width: 600, height: 400 },
};
