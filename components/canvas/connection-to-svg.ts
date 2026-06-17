// Deterministic SVG renderer for a "two equipment + bound connection" scene
// (DEV-1138 🟡, FR-3).
//
// Why this exists: bind-on-create's 🟡 criterion is a golden compare of "two
// equipment + bound connection". A pixel screenshot of a live Excalidraw canvas
// is non-deterministic and needs a browser, so (following the DEV-1131/1137
// pattern) we render the SAME geometry the canvas places — the two symbol bodies
// plus the port-to-port arrow buildBoundConnection produces — into a normalized,
// byte-stable SVG and golden-compare it. This proves the connection geometry and
// its two endpoints are correct and unchanged.
//
// The full server-side SVG harness is DEV-1142; this is the Phase-1 minimal
// compare scoped to this task's output.

import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

import { getSymbol } from "@/lib/symbols";
import { symbolToSkeletons } from "./symbol-to-skeleton";
import {
  buildBoundConnection,
  portScenePoint,
  type ConnectionRequest,
} from "./connection-binding";

const STROKE = "#1e1e1e";
const STROKE_WIDTH = 2;
const DASH = "6 4";
/** Endpoint marker radius (px) — visualizes that the arrow lands on a port. */
const PORT_MARKER_R = 3;

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function strokeAttrs(dashed: boolean): string {
  const dash = dashed ? ` stroke-dasharray="${DASH}"` : "";
  return `fill="none" stroke="${STROKE}" stroke-width="${STROKE_WIDTH}"${dash}`;
}

/** Render an equipment body skeleton (rectangle/ellipse/diamond/line/triangle). */
function renderEquipmentSkeleton(el: ExcalidrawElementSkeleton): string {
  const attrs = strokeAttrs(
    (el as { strokeStyle?: string }).strokeStyle === "dashed",
  );
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
      throw new Error(`Unhandled skeleton type in connection render: ${el.type}`);
  }
}

/**
 * Render a bound-connection scene to a deterministic, normalized SVG: both
 * equipment bodies, port markers at the two bound endpoints, and the connection
 * line between them. Output is byte-stable (fixed precision, no locale) and safe
 * to commit as a golden.
 */
export function connectionSceneToSvg(
  request: ConnectionRequest,
  viewport: { readonly width: number; readonly height: number },
): string {
  const sourceBody = symbolToSkeletons(
    getSymbol(request.source.element.symbolId),
    request.source.element,
  );
  const targetBody = symbolToSkeletons(
    getSymbol(request.target.element.symbolId),
    request.target.element,
  );

  const arrow = buildBoundConnection(request) as unknown as {
    x: number;
    y: number;
    points: readonly (readonly number[])[];
    strokeStyle?: string;
  };
  const dashed = arrow.strokeStyle === "dashed";
  const linePts = arrow.points
    .map((pt) => `${fmt(arrow.x + (pt[0] ?? 0))},${fmt(arrow.y + (pt[1] ?? 0))}`)
    .join(" ");

  const start = portScenePoint(request.source);
  const end = portScenePoint(request.target);
  const markerAttrs = `fill="${STROKE}" stroke="none"`;

  const body: string[] = [
    ...sourceBody.map(renderEquipmentSkeleton),
    ...targetBody.map(renderEquipmentSkeleton),
    `<polyline points="${linePts}" ${strokeAttrs(dashed)} data-connection="bound"/>`,
    `<circle cx="${fmt(start.x)}" cy="${fmt(start.y)}" r="${PORT_MARKER_R}" ${markerAttrs} data-port="source"/>`,
    `<circle cx="${fmt(end.x)}" cy="${fmt(end.y)}" r="${PORT_MARKER_R}" ${markerAttrs} data-port="target"/>`,
  ];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewport.width} ${viewport.height}" data-scene="bound-connection">`,
    `  ${body.join("\n  ")}`,
    `</svg>`,
    "",
  ].join("\n");
}
