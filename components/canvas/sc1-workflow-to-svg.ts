// Deterministic SVG renderer for the SC-1 manual-workflow scene (DEV-1141 🟡).
//
// Why this exists: SC-1's 🟡 acceptance is "golden screenshot of final diagram".
// A pixel screenshot of a live Excalidraw canvas is non-deterministic (fonts,
// hand-drawn roughness seed, antialiasing) and needs a browser, so it is not
// loop-closable in CI. Following the established Phase-1 pattern (DEV-1131/1137
// scene-to-svg, DEV-1138 connection-to-svg), we render the SAME geometry the
// canvas places — every equipment body plus every bound process line — into a
// normalized, byte-stable SVG and golden-compare it. This proves the final
// diagram's geometry is correct and unchanged. The full server-side SVG harness
// (which renders persisted canonical state) is DEV-1142; this is the Phase-1
// minimal compare scoped to this gate's fixed scene.
//
// This reuses the existing pure geometry helpers (symbolToSkeletons,
// buildBoundConnection, portScenePoint) so the golden tracks exactly what the
// bind-on-create + placement layers produce. No I/O, no Excalidraw runtime.

import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

import { getSymbol } from "@/lib/symbols";
import { symbolToSkeletons } from "./symbol-to-skeleton";
import {
  buildBoundConnection,
  portScenePoint,
  type ConnectionEndpoint,
  type ConnectionRequest,
} from "./connection-binding";
import {
  SC1_CONNECTIONS,
  SC1_EQUIPMENT,
  SC1_VIEWPORT,
  type Sc1Connection,
  type Sc1Equipment,
} from "./sc1-workflow.fixture";

const STROKE = "#1e1e1e";
const STROKE_WIDTH = 2;
const PORT_MARKER_R = 3;

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function strokeAttrs(): string {
  return `fill="none" stroke="${STROKE}" stroke-width="${STROKE_WIDTH}"`;
}

/** Render an equipment body skeleton (rectangle/ellipse/diamond/line/triangle). */
function renderEquipmentSkeleton(el: ExcalidrawElementSkeleton): string {
  const attrs = strokeAttrs();
  switch (el.type) {
    case "rectangle": {
      const { x, y, width = 0, height = 0 } = el;
      return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" ${attrs}/>`;
    }
    case "ellipse": {
      const { x, y, width = 0, height = 0 } = el;
      const cx = x + width / 2;
      const cy = y + height / 2;
      return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(width / 2)}" ry="${fmt(height / 2)}" ${attrs}/>`;
    }
    case "diamond": {
      const { x, y, width = 0, height = 0 } = el;
      const cx = x + width / 2;
      const cy = y + height / 2;
      const pts = [
        [cx, y],
        [x + width, cy],
        [cx, y + height],
        [x, cy],
      ]
        .map(([px, py]) => `${fmt(px ?? 0)},${fmt(py ?? 0)}`)
        .join(" ");
      return `<polygon points="${pts}" ${attrs}/>`;
    }
    case "line": {
      const { x, y } = el;
      const points =
        (el as { points?: readonly (readonly number[])[] }).points ?? [];
      const pts = points
        .map((pt) => `${fmt(x + (pt[0] ?? 0))},${fmt(y + (pt[1] ?? 0))}`)
        .join(" ");
      return `<polyline points="${pts}" ${attrs}/>`;
    }
    default:
      // Placed symbols only emit the geometry above; a new type is a placement
      // bug, not a render gap — fail loud.
      throw new Error(`Unhandled skeleton type in SC-1 render: ${el.type}`);
  }
}

/** Resolve an equipment element by id; fail loud on a dangling reference. */
function findEquipment(
  elementId: string,
  equipment: readonly Sc1Equipment[],
): Sc1Equipment {
  const found = equipment.find((e) => e.placed.elementId === elementId);
  if (found === undefined) {
    throw new Error(
      `SC-1 connection references unknown element '${elementId}'.`,
    );
  }
  return found;
}

/** Build the pure ConnectionRequest for a fixture connection (process line). */
function toConnectionRequest(
  conn: Sc1Connection,
  equipment: readonly Sc1Equipment[],
): ConnectionRequest {
  const sourceEl = findEquipment(conn.source.elementId, equipment);
  const targetEl = findEquipment(conn.target.elementId, equipment);
  const source: ConnectionEndpoint = {
    element: sourceEl.placed,
    portId: conn.source.portId,
  };
  const target: ConnectionEndpoint = {
    element: targetEl.placed,
    portId: conn.target.portId,
  };
  return { source, target, connector: "process-line" };
}

/** Render one bound process line: its polyline plus the two port markers. */
function renderConnection(request: ConnectionRequest): string[] {
  const arrow = buildBoundConnection(request) as unknown as {
    x: number;
    y: number;
    points: readonly (readonly number[])[];
  };
  const linePts = arrow.points
    .map((pt) => `${fmt(arrow.x + (pt[0] ?? 0))},${fmt(arrow.y + (pt[1] ?? 0))}`)
    .join(" ");
  const start = portScenePoint(request.source);
  const end = portScenePoint(request.target);
  const markerAttrs = `fill="${STROKE}" stroke="none"`;
  return [
    `<polyline points="${linePts}" ${strokeAttrs()} data-connection="bound"/>`,
    `<circle cx="${fmt(start.x)}" cy="${fmt(start.y)}" r="${PORT_MARKER_R}" ${markerAttrs} data-port="source"/>`,
    `<circle cx="${fmt(end.x)}" cy="${fmt(end.y)}" r="${PORT_MARKER_R}" ${markerAttrs} data-port="target"/>`,
  ];
}

/**
 * Render the SC-1 workflow scene (default fixture) to a deterministic,
 * normalized SVG: every equipment body, then every bound process line. Output is
 * byte-stable (fixed precision, no locale) and safe to commit as a golden.
 */
export function sc1WorkflowToSvg(
  equipment: readonly Sc1Equipment[] = SC1_EQUIPMENT,
  connections: readonly Sc1Connection[] = SC1_CONNECTIONS,
  viewport: { readonly width: number; readonly height: number } = SC1_VIEWPORT,
): string {
  const bodies = equipment.flatMap((e) =>
    symbolToSkeletons(getSymbol(e.placed.symbolId), e.placed).map(
      renderEquipmentSkeleton,
    ),
  );
  const lines = connections.flatMap((c) =>
    renderConnection(toConnectionRequest(c, equipment)),
  );
  const body = [...bodies, ...lines].join("\n  ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewport.width} ${viewport.height}" data-scene="sc1-workflow">`,
    `  ${body}`,
    `</svg>`,
    "",
  ].join("\n");
}
