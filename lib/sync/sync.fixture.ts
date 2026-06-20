// Sync fixture for the broadcast→apply golden (DEV-1151 [12a] 🟡, PRD §4).
//
// A known canonical diagram, expressed as the renderer's `DiagramRenderState`,
// carried inside a whole-scene broadcast. The fixture is the "known scene" the
// golden compare pins: a session that starts empty, receives this broadcast, and
// applies it must end up rendering exactly this diagram. That end-to-end path
// (broadcast → applyBroadcast → render) is what the golden proves — i.e. "browser
// applies broadcast, reflects the change" and "two sessions converge".
//
// Topology mirrors the DEV-1142 canonical-render fixture (column → tank process
// line; instrument → tank signal line) so the golden exercises rectangle +
// ellipse bodies, tag labels, and both a solid and a dashed connector. The scene
// is the render-state embedded as opaque JSON in the broadcast's `scene` field —
// honest about the contract that a broadcast carries the canonical scene a
// session renders. Pure data: no I/O, no Excalidraw runtime.

import { getSymbol } from "@/lib/symbols";
import type { DiagramRenderState } from "@/lib/diagram/render-svg";
import type { JsonObject, JsonValue } from "@/lib/types";
import type { SceneBroadcast } from "./types";

const LOCAL_BOX = 100;

interface FixtureEquipment {
  readonly elementId: string;
  readonly symbolId: DiagramRenderState["equipment"][number]["symbolId"];
  readonly x: number;
  readonly y: number;
  readonly tag: string;
}

/** Resolve a placed equipment's named port to a scene-space point. */
function portPoint(
  eq: FixtureEquipment,
  portId: string,
): { x: number; y: number } {
  const def = getSymbol(eq.symbolId);
  const port = def.ports.find((p) => p.id === portId);
  if (port === undefined) {
    throw new Error(`Port '${portId}' does not exist on symbol '${eq.symbolId}'.`);
  }
  return {
    x: eq.x + (port.x / LOCAL_BOX) * 100,
    y: eq.y + (port.y / LOCAL_BOX) * 100,
  };
}

const COLUMN: FixtureEquipment = {
  elementId: "col-1",
  symbolId: "extraction-column",
  x: 60,
  y: 40,
  tag: "EX-101",
};
const TANK: FixtureEquipment = {
  elementId: "tank-1",
  symbolId: "collection-tank",
  x: 60,
  y: 240,
  tag: "TK-101",
};
const INSTRUMENT: FixtureEquipment = {
  elementId: "it-1",
  symbolId: "instrument-bubble",
  x: 240,
  y: 240,
  tag: "LT-1",
};

/** The canonical diagram a session renders after applying the fixture broadcast. */
export const SYNC_RENDER_STATE: DiagramRenderState = {
  equipment: [COLUMN, TANK, INSTRUMENT].map((e) => ({
    elementId: e.elementId,
    symbolId: e.symbolId,
    x: e.x,
    y: e.y,
    size: 100,
    tag: e.tag,
  })),
  connections: [
    {
      elementId: "line-1",
      start: portPoint(COLUMN, "bottom"),
      end: portPoint(TANK, "top"),
      dashed: false,
    },
    {
      elementId: "sig-1",
      start: portPoint(INSTRUMENT, "process"),
      end: portPoint(TANK, "right"),
      dashed: true,
    },
  ],
  viewport: { width: 420, height: 400 },
};

const FIXTURE_DIAGRAM_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_VERSION_ID = "22222222-2222-4222-8222-222222222222";

/**
 * The fixture canonical scene as opaque JSON: the render-state under a
 * `renderState` key. This is what the broadcast carries and what a session keeps
 * as its applied scene; {@link appliedSceneToSvg} reads it back to render.
 */
export const SYNC_SCENE: JsonObject = {
  renderState: SYNC_RENDER_STATE as unknown as JsonValue,
};

/** The whole-scene broadcast a freshly-connected session receives. */
export const SYNC_BROADCAST: SceneBroadcast = {
  type: "scene",
  diagramId: FIXTURE_DIAGRAM_ID,
  versionId: FIXTURE_VERSION_ID,
  scene: SYNC_SCENE,
};

export { FIXTURE_DIAGRAM_ID, FIXTURE_VERSION_ID };
