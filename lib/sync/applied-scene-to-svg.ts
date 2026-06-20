// Render a session's applied scene to deterministic SVG (DEV-1151 [12a] 🟡).
//
// After a session applies a whole-scene broadcast, its `SyncState.scene` holds
// the canonical scene it must render. This helper turns that applied scene into
// the same normalized, byte-stable SVG the server-side renderer produces, so the
// golden compare can assert "what a session shows after applying a broadcast" ==
// "the known canonical diagram". It is the visible end of the broadcast→apply
// loop the 🟡 acceptance ("browser applies broadcast, reflects the change") pins.
//
// The applied scene is opaque JSON carrying the canonical render-state under a
// `renderState` key (see sync.fixture.ts). We read it back and delegate to the
// shared DEV-1142 renderer — no new geometry logic here, so the golden tracks
// the one canonical renderer. Pure: no I/O, no Excalidraw runtime.

import { renderDiagramSvg, type DiagramRenderState } from "@/lib/diagram/render-svg";
import type { JsonObject } from "@/lib/types";

/**
 * Render the canonical scene a session has applied.
 *
 * @throws if the scene does not carry a `renderState` (a malformed broadcast
 *   scene — fail loud rather than render nothing).
 */
export function appliedSceneToSvg(scene: JsonObject): string {
  const renderState = scene.renderState;
  if (renderState === undefined || renderState === null) {
    throw new Error(
      "Applied scene is missing its canonical render-state and cannot be rendered.",
    );
  }
  return renderDiagramSvg(renderState as unknown as DiagramRenderState);
}
