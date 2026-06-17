// Canonical "two equipment + bound connection" scene for the 🟡 golden snapshot
// (DEV-1138, FR-3). Two placed equipment elements and the process line bound
// between a port on each. Shared by the connection-binding test (golden compare)
// so the snapshot tracks exactly what bind-on-create produces. Pure data.

import type { ConnectionRequest, PlacedEquipment } from "./connection-binding";

/** Source equipment: an extraction column placed at the left. */
export const BOUND_SOURCE: PlacedEquipment = {
  elementId: "el-extraction",
  symbolId: "extraction-column",
  x: 40,
  y: 60,
  size: 100,
};

/** Target equipment: a collection tank placed to the right. */
export const BOUND_TARGET: PlacedEquipment = {
  elementId: "el-tank",
  symbolId: "collection-tank",
  x: 280,
  y: 80,
  size: 100,
};

/** The connection drawn between the source "right" port and target "left" port. */
export const BOUND_CONNECTION_SCENE: ConnectionRequest = {
  source: { element: BOUND_SOURCE, portId: "right" },
  target: { element: BOUND_TARGET, portId: "left" },
  connector: "process-line",
};

/** Viewport the golden SVG is rendered into. */
export const BOUND_CONNECTION_VIEWPORT = { width: 460, height: 280 } as const;
