// Server-side SVG render of canonical diagram state (DEV-1142, FR-9).
//
// Why this exists: the MCP tool surface (PRD §5.2) returns "structured diagram
// state AND an SVG snapshot" so Claude — which cannot see the user's browser
// canvas — can verify what a diagram looks like before and after a proposal
// (FR-9). That snapshot must be produced ON THE SERVER from the single source of
// truth (canonical Postgres state), never from the browser. This module is that
// renderer.
//
// It is the full server-side render harness the Phase-1 minimal compares
// (components/canvas/scene-to-svg.ts, sc1-workflow-to-svg.ts) explicitly defer to
// ("the full server-side SVG harness is DEV-1142"). Unlike those — which render
// the Excalidraw element SKELETONS the canvas places — this renders the canonical
// DIAGRAM STATE: placed equipment (symbol + placement + tag) and the connection
// edges between their ports. It is what an MCP read tool hands back.
//
// Design constraints honored:
//   - PURE + browser-free + deterministic. No Excalidraw runtime, no DOM, no I/O.
//     Identical state always yields byte-identical SVG, so it is golden-stable and
//     loop-closable in CI (🟡). This is why we render symbol primitives directly
//     (offset/scaled from the 0..100 local box, mirroring lib/symbols/render-svg)
//     rather than going through the canvas-layer Excalidraw skeleton adapter:
//     `lib/diagram` stays independent of `components/canvas`, and there is no
//     hidden non-determinism (font roughness, antialiasing) to defeat the golden.
//   - Canonical state in, SVG out. Equipment metadata (the `tag` label) comes from
//     the parallel store (CLAUDE.md fact #1), never from Excalidraw `customData`.
//   - Connectors (process/signal lines) are edges, drawn port-to-port from the
//     resolved endpoint geometry; signal lines render dashed.

import {
  getSymbol,
  type SymbolDefinition,
  type SymbolId,
  type SymbolPrimitive,
} from "@/lib/symbols";
import {
  bodyBoxFromPlacement,
  routeConnectionPoints,
  type BodyBox,
  type Point,
} from "./orthogonal-route";
import {
  hopPathData,
  verticalSegments,
  type VerticalSegment,
} from "./line-hops";

/** Symbol-library local box edge length; every primitive is authored in 0..100. */
const LOCAL_BOX = 100;
/** Default on-canvas footprint (px) when a placement gives no size. */
const DEFAULT_PLACEMENT_SIZE = 100;

const STROKE = "#1e1e1e";
const STROKE_WIDTH = 2;
const DASH = "6 4";
const LABEL_FILL = "#1e1e1e";
const LABEL_FONT_SIZE = 12;
const LABEL_FONT_FAMILY = "sans-serif";
/** Gap (px) between an equipment's bottom edge and its tag label baseline. */
const LABEL_OFFSET = 14;

/** A placed piece of equipment in canonical state: symbol + placement + tag. */
export interface RenderEquipment {
  /** Excalidraw scene element id (kept for stable ordering / diagnostics). */
  readonly elementId: string;
  /** Which symbol this element is (drives geometry). */
  readonly symbolId: SymbolId;
  /** Scene-space x of the placement box top-left. */
  readonly x: number;
  /** Scene-space y of the placement box top-left. */
  readonly y: number;
  /** Edge length (px) the 0..100 local box maps onto. Defaults to 100. */
  readonly size?: number;
  /** Equipment tag from the parallel metadata store; rendered as a label. */
  readonly tag?: string;
}

/** A connection edge in canonical state, reduced to its drawable endpoints. */
export interface RenderConnection {
  /** Excalidraw scene element id of the connector line. */
  readonly elementId: string;
  /** Resolved scene-space start point (source port). */
  readonly start: { readonly x: number; readonly y: number };
  /** Resolved scene-space end point (target port). */
  readonly end: { readonly x: number; readonly y: number };
  /** Whether this is a signal line (dashed). Defaults to false (solid process). */
  readonly dashed?: boolean;
  /** Source equipment element id. When both ends resolve to placed equipment, the
   * edge is routed orthogonally against their body faces (matching the canvas);
   * otherwise it falls back to a straight segment. */
  readonly sourceElementId?: string;
  /** Target equipment element id. See `sourceElementId`. */
  readonly targetElementId?: string;
  /** Explicit intermediate route points (DEV-1210). When present the route passes
   * through them (start → waypoints → end) instead of being auto-routed. */
  readonly waypoints?: readonly Point[];
}

/** The drawable view of canonical diagram state this renderer consumes. */
export interface DiagramRenderState {
  readonly equipment: readonly RenderEquipment[];
  readonly connections: readonly RenderConnection[];
  /** SVG viewport. Required so output is self-describing and stable. */
  readonly viewport: { readonly width: number; readonly height: number };
}

/** Stable numeric formatting: integers stay integers; no locale; fixed precision. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Minimal XML-escape for text content (tags are user-supplied metadata). */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Scale a local-space coordinate (0..LOCAL_BOX) into placed scene space. */
function scale(local: number, origin: number, size: number): number {
  return origin + (local / LOCAL_BOX) * size;
}

function strokeAttrs(dashed: boolean): string {
  const dash = dashed ? ` stroke-dasharray="${DASH}"` : "";
  return `fill="none" stroke="${STROKE}" stroke-width="${STROKE_WIDTH}"${dash}`;
}

/** Like {@link strokeAttrs} but for symbol primitives, which may be solid-filled
 * (e.g. a junction tee dot). */
function primitiveAttrs(dashed: boolean, filled: boolean): string {
  const dash = dashed ? ` stroke-dasharray="${DASH}"` : "";
  const fill = filled ? STROKE : "none";
  return `fill="${fill}" stroke="${STROKE}" stroke-width="${STROKE_WIDTH}"${dash}`;
}

/**
 * Render one symbol primitive, offset to `origin` and scaled to `size`. Mirrors
 * the local-box renderer in lib/symbols/render-svg, but in placed scene space.
 */
function renderPrimitive(
  p: SymbolPrimitive,
  origin: { x: number; y: number },
  size: number,
): string {
  const attrs = primitiveAttrs(p.dashed === true, p.filled === true);
  switch (p.shape) {
    case "rectangle": {
      const x = scale(p.x, origin.x, size);
      const y = scale(p.y, origin.y, size);
      const w = (p.width / LOCAL_BOX) * size;
      const h = (p.height / LOCAL_BOX) * size;
      return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" ${attrs}/>`;
    }
    case "ellipse": {
      const cxLocal = p.x + p.width / 2;
      const cyLocal = p.y + p.height / 2;
      const cx = scale(cxLocal, origin.x, size);
      const cy = scale(cyLocal, origin.y, size);
      const rx = (p.width / 2 / LOCAL_BOX) * size;
      const ry = (p.height / 2 / LOCAL_BOX) * size;
      return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}" ${attrs}/>`;
    }
    case "diamond": {
      const cx = scale(p.x + p.width / 2, origin.x, size);
      const cy = scale(p.y + p.height / 2, origin.y, size);
      const left = scale(p.x, origin.x, size);
      const right = scale(p.x + p.width, origin.x, size);
      const top = scale(p.y, origin.y, size);
      const bottom = scale(p.y + p.height, origin.y, size);
      const pts = [
        [cx, top],
        [right, cy],
        [cx, bottom],
        [left, cy],
      ]
        .map(([px, py]) => `${fmt(px ?? 0)},${fmt(py ?? 0)}`)
        .join(" ");
      return `<polygon points="${pts}" ${attrs}/>`;
    }
    case "triangle": {
      const pts = (p.points ?? [])
        .map(
          ([px, py]) =>
            `${fmt(scale(px, origin.x, size))},${fmt(scale(py, origin.y, size))}`,
        )
        .join(" ");
      return `<polygon points="${pts}" ${attrs}/>`;
    }
    case "line": {
      const pts = (p.points ?? [])
        .map(
          ([px, py]) =>
            `${fmt(scale(px, origin.x, size))},${fmt(scale(py, origin.y, size))}`,
        )
        .join(" ");
      return `<polyline points="${pts}" ${attrs}/>`;
    }
    default: {
      // Exhaustiveness guard: a new PrimitiveShape must be handled here.
      const exhaustive: never = p.shape;
      throw new Error(`Unhandled primitive shape: ${String(exhaustive)}`);
    }
  }
}

/** Render an equipment body (its primitives) plus its tag label, if any. */
function renderEquipment(eq: RenderEquipment): string[] {
  const def: SymbolDefinition = getSymbol(eq.symbolId);
  const size = eq.size ?? DEFAULT_PLACEMENT_SIZE;
  const origin = { x: eq.x, y: eq.y };
  const body = def.primitives.map((p) => renderPrimitive(p, origin, size));
  if (eq.tag === undefined || eq.tag === "") {
    return body;
  }
  const labelX = scale(50, origin.x, size);
  const labelY = origin.y + size + LABEL_OFFSET;
  body.push(
    `<text x="${fmt(labelX)}" y="${fmt(labelY)}" font-family="${LABEL_FONT_FAMILY}" ` +
      `font-size="${LABEL_FONT_SIZE}" fill="${LABEL_FILL}" text-anchor="middle" ` +
      `data-tag="${escapeText(eq.tag)}">${escapeText(eq.tag)}</text>`,
  );
  return body;
}

/**
 * The orthogonal route points for a connection. When both endpoints resolve to
 * placed equipment, the edge is routed at right angles against their body faces —
 * the SAME routing the live canvas uses (DEV-1204), so the exported sheet matches
 * what the user drew. Unbound endpoints fall back to a straight segment.
 */
function connectionRoute(
  conn: RenderConnection,
  boxById: ReadonlyMap<string, BodyBox>,
): readonly Point[] {
  const sourceBox =
    conn.sourceElementId !== undefined
      ? boxById.get(conn.sourceElementId) ?? null
      : null;
  const targetBox =
    conn.targetElementId !== undefined
      ? boxById.get(conn.targetElementId) ?? null
      : null;
  return routeConnectionPoints(
    conn.start,
    sourceBox,
    conn.end,
    targetBox,
    conn.waypoints,
  );
}

/**
 * Render one connection edge. Where this edge's horizontal segments cross the
 * vertical segments of OTHER edges, it hops over them (DEV-1208) — a crossing
 * reads as "no connection". A non-crossing edge stays a plain `<polyline>`, so
 * diagrams without crossings render byte-identically.
 */
function renderConnection(
  conn: RenderConnection,
  route: readonly Point[],
  obstacles: readonly VerticalSegment[],
): string {
  const attrs = strokeAttrs(conn.dashed === true);
  const data = `data-connection="${escapeText(conn.elementId)}"`;
  const hopped = hopPathData(route, obstacles, fmt);
  if (hopped !== null) {
    return `<path d="${hopped}" ${attrs} ${data}/>`;
  }
  const pts = route.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ");
  return `<polyline points="${pts}" ${attrs} ${data}/>`;
}

/**
 * Render canonical diagram state to a deterministic, normalized SVG string.
 *
 * Draw order is connectors first, then equipment bodies + labels, so equipment
 * sits visually on top of the lines that meet at its ports. Output is byte-stable
 * (fixed precision, no locale) and safe to commit as a golden fixture (🟡), and
 * is valid SVG suitable for an MCP tool return (FR-9).
 *
 * Pure: no I/O, no Excalidraw runtime. Identical state → identical SVG.
 */
export function renderDiagramSvg(state: DiagramRenderState): string {
  const { inner, width, height } = diagramSvgInner(state);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" data-diagram="canonical">`,
    `  ${inner}`,
    `</svg>`,
    "",
  ].join("\n");
}

/** The diagram's inner SVG markup (connectors + equipment, no `<svg>` wrapper)
 * plus its viewport — so a drawing-sheet renderer (DEV-1201) can embed the
 * diagram inside a framed sheet without re-deriving geometry. */
export function diagramSvgInner(state: DiagramRenderState): {
  readonly inner: string;
  readonly width: number;
  readonly height: number;
} {
  // Body box per placed equipment, so a connection can route against the faces of
  // the symbols it joins — the same geometry the canvas routes against.
  const boxById = new Map<string, BodyBox>(
    state.equipment.map((eq) => [
      eq.elementId,
      bodyBoxFromPlacement(
        eq.symbolId,
        eq.x,
        eq.y,
        eq.size ?? DEFAULT_PLACEMENT_SIZE,
      ),
    ]),
  );
  // Route every connection first, then render each one hopping over the vertical
  // segments of the OTHERS (DEV-1208), so crossings read as line-jumps.
  const routes = state.connections.map((c) => connectionRoute(c, boxById));
  const verticalsByConnection = routes.map(verticalSegments);
  const lines = state.connections.map((c, i) => {
    const obstacles = verticalsByConnection.flatMap((vs, j) =>
      j === i ? [] : vs,
    );
    return renderConnection(c, routes[i], obstacles);
  });
  const bodies = state.equipment.flatMap(renderEquipment);
  return {
    inner: [...lines, ...bodies].join("\n  "),
    width: state.viewport.width,
    height: state.viewport.height,
  };
}
