# HUMAN-VERIFY: on-canvas waypoint capture (DEV-1210)

🔴 This feature is canvas-interaction code that **cannot be verified headlessly**
(it needs a live Excalidraw point-edit session). The code is typechecked,
unit-tested, and Linus-reviewed (one silent-data-loss bug was found and fixed —
captured routes now pin `start`/`end`, not just `waypoints`). **The live drag
behavior below has NOT been self-certified — please verify.**

## What changed

When you edit a connection's bend points on the canvas, those points now persist
as the edge's `waypoints` and survive Save/reload. Implementation:
`components/canvas/waypoint-capture.ts` (pure decision core, unit-tested) wired
into `pid-canvas.tsx` `handleChange`.

## How it should behave

- Entering the point editor on a line and **not** dragging → nothing locks (the
  line still auto-reroutes when you move a connected node).
- **Dragging a bend** → the line becomes manually routed: it keeps your shape and
  stops auto-rerouting; it survives Save and reload.
- **Straightening** a line (removing its bends) → it reverts to auto-routing.

## Verify steps

1. Open `/editor` with any diagram that has connections (e.g. create the
   **Hydrocarbon Extractor** template from `/diagrams`).
2. Select a process line. Enter Excalidraw's point editor (the on-canvas hint:
   **Ctrl + double-click**, or select then **Ctrl + Enter**).
3. **Without dragging**, click away. Then drag a connected piece of equipment a
   little. ✅ Expect: the line **re-routes** automatically (it was NOT locked by
   merely inspecting it).
4. Re-enter the point editor on a line and **drag a midpoint** to bend the line
   through a clear lane. Click away.
5. Drag a connected piece of equipment. ✅ Expect: the line keeps your hand-routed
   bend (endpoints follow the equipment, your waypoint stays put).
6. Click **Save**, then reload the page (or restore the just-saved version). ✅
   Expect: the hand-routed bend is **still there** (not snapped back to auto).
7. Export **Drawing sheet (SVG)**. ✅ Expect: the exported pipe follows the same
   hand-routed path (and hops any line it crosses).
8. **Regression — straighten:** re-enter the editor on the bent line, drag the
   midpoint back so the line is straight (or delete the bend point). Move a node.
   ✅ Expect: it auto-routes again (waypoints cleared).
9. **MCP-origin edge (the bug that was fixed):** have Claude propose a connection
   via the connector (so the edge originates from MCP, not hand-drawn), accept
   it, then bend it (step 4–6). ✅ Expect: the bend survives Save/reload — this is
   the case that previously would have silently lost the routing.

## If something is wrong

- Bend vanishes after Save/reload → the `start`/`end` pin may not be landing;
  check `captureWaypointEdit` in `pid-canvas.tsx` and the gate in
  `model-to-scene.ts` (waypoint branch needs `start` + `end` + `waypoints`).
- Line locks just from inspecting it (won't auto-reroute) → the baseline snapshot
  isn't firing; check `decideWaypointCapture` returns `snapshot` on first sight.
- Live edit flickers/reverts mid-drag → a re-render is clobbering it; confirm the
  shell still passes `committedModel` (not `pendingModel`) as `initialModel`.
