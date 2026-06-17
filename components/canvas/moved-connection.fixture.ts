// Canonical scenes for the rebind-on-move 🟡 golden snapshot (DEV-1139, FR-3).
//
// REBIND_BASE_SCENE is the starting bound connection (an extraction column →
// collection tank process line). MOVED_CONNECTION_SCENE is that same connection
// after the target tank has been dragged down-and-right: the arrow's source
// anchor is unchanged but its endpoint delta now reaches the tank's new
// position, proving the connection FOLLOWED the moved element. The golden SVG
// captures exactly that moved geometry. Pure data.

import { rebindOnMove } from "./connection-rebind";
import type { ConnectionRequest, PlacedEquipment } from "./connection-binding";

/** Source equipment: an extraction column placed at the left. */
export const REBIND_SOURCE: PlacedEquipment = {
  elementId: "el-extraction",
  symbolId: "extraction-column",
  x: 40,
  y: 60,
  size: 100,
};

/** Target equipment: a collection tank placed to the right (pre-move). */
export const REBIND_TARGET: PlacedEquipment = {
  elementId: "el-tank",
  symbolId: "collection-tank",
  x: 260,
  y: 60,
  size: 100,
};

/** Starting connection: source "right" port → target "left" port. */
export const REBIND_BASE_SCENE: ConnectionRequest = {
  source: { element: REBIND_SOURCE, portId: "right" },
  target: { element: REBIND_TARGET, portId: "left" },
  connector: "process-line",
};

/** The tank is dragged by (+80, +120); the connection must follow it. */
export const TANK_MOVE = {
  elementId: REBIND_TARGET.elementId,
  x: REBIND_TARGET.x + 80,
  y: REBIND_TARGET.y + 120,
} as const;

/** Scene after the move — what the golden SVG renders. */
export const MOVED_CONNECTION_SCENE: ConnectionRequest = rebindOnMove(
  REBIND_BASE_SCENE,
  TANK_MOVE,
);

/** Viewport the golden SVG is rendered into (room for the moved tank). */
export const MOVED_CONNECTION_VIEWPORT = { width: 480, height: 320 } as const;
