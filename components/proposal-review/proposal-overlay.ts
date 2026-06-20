/**
 * Pending-proposal overlay renderer (DEV-1153, PRD §5.2 step 6, FR-10).
 *
 * Renders the canvas as the human sees it while deciding a proposal: the committed
 * diagram drawn normally, with the proposal's NEW elements overlaid "visually
 * distinct" (FR-10) — ghosted: a highlight colour, dashed outline, reduced opacity.
 * The human clicks Accept (commit) or Reject (discard) on this preview.
 *
 * Three render modes drive the three golden states (the 🟡 acceptance criterion):
 *   - "pending"  → committed elements + proposed elements ghosted (the decision view)
 *   - "accepted" → the proposal committed: every element drawn normally (no ghost),
 *                  because accept ran the staged edit through the commit pipeline and
 *                  it is now canonical state
 *   - "rejected" → the proposal discarded: only the committed elements, drawn
 *                  normally; the proposed elements are gone
 *
 * Why a dedicated renderer rather than reusing lib/diagram/render-svg: that
 * renderer draws a single homogeneous canonical state. Here we must draw two
 * classes of element (committed vs proposed) with different styling in one SVG, and
 * the ghost styling is this UI's concern, not the canonical renderer's. The drawing
 * geometry (symbol primitives offset/scaled from the 0..100 local box; port-to-port
 * edges) mirrors lib/diagram/render-svg exactly so a proposed element previews at
 * the same place it will land once committed.
 *
 * Pure + browser-free + deterministic: diff in, SVG out. Identical input always
 * yields byte-identical SVG, so it is golden-stable and loop-closable in CI (🟡).
 */
import {
  getSymbol,
  type SymbolDefinition,
  type SymbolPrimitive,
} from "@/lib/symbols";
import type {
  ProposalConnection,
  ProposalDiff,
  ProposalEquipment,
} from "./proposal-diff";

/** Symbol-library local box edge length; every primitive is authored in 0..100. */
const LOCAL_BOX = 100;

// Committed (canonical) styling — matches lib/diagram/render-svg.
const STROKE = "#1e1e1e";
const STROKE_WIDTH = 2;
const DASH = "6 4";
const LABEL_FILL = "#1e1e1e";

// Proposed (ghost) styling — visually distinct (FR-10): a highlight colour, a
// dashed outline, and reduced opacity, so a proposed element reads clearly as
// "not yet committed".
const GHOST_STROKE = "#2563eb";
const GHOST_DASH = "4 3";
const GHOST_OPACITY = "0.55";

const LABEL_FONT_SIZE = 12;
const LABEL_FONT_FAMILY = "sans-serif";
/** Gap (px) between an equipment's bottom edge and its tag label baseline. */
const LABEL_OFFSET = 14;

/** Which view to render — drives the three golden states. */
export type ProposalRenderMode = "pending" | "accepted" | "rejected";

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

/** Drawing style for one class of element (committed vs proposed/ghost). */
interface Style {
  readonly stroke: string;
  readonly dash: string;
  readonly opacity?: string;
  readonly ghost: boolean;
}

const COMMITTED_STYLE: Style = { stroke: STROKE, dash: DASH, ghost: false };
const GHOST_STYLE: Style = {
  stroke: GHOST_STROKE,
  dash: GHOST_DASH,
  opacity: GHOST_OPACITY,
  ghost: true,
};

/** Stroke attributes for a primitive in the given style. `dashed` forces the
 * element's own dashed style (e.g. a signal line); ghosts are always dashed. */
function strokeAttrs(style: Style, dashed: boolean): string {
  const wantsDash = dashed || style.ghost;
  const dashAttr = wantsDash ? ` stroke-dasharray="${style.dash}"` : "";
  const opacity = style.opacity !== undefined ? ` opacity="${style.opacity}"` : "";
  return `fill="none" stroke="${style.stroke}" stroke-width="${STROKE_WIDTH}"${dashAttr}${opacity}`;
}

/** Render one symbol primitive, offset to `origin` and scaled to `size`. Mirrors
 * lib/diagram/render-svg's primitive renderer, but styled per element class. */
function renderPrimitive(
  p: SymbolPrimitive,
  origin: { x: number; y: number },
  size: number,
  style: Style,
): string {
  const attrs = strokeAttrs(style, p.dashed === true);
  switch (p.shape) {
    case "rectangle": {
      const x = scale(p.x, origin.x, size);
      const y = scale(p.y, origin.y, size);
      const w = (p.width / LOCAL_BOX) * size;
      const h = (p.height / LOCAL_BOX) * size;
      return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" ${attrs}/>`;
    }
    case "ellipse": {
      const cx = scale(p.x + p.width / 2, origin.x, size);
      const cy = scale(p.y + p.height / 2, origin.y, size);
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
      const exhaustive: never = p.shape;
      throw new Error(`Unhandled primitive shape: ${String(exhaustive)}`);
    }
  }
}

/** Render an equipment body (primitives) + its tag label, styled per class. */
function renderEquipment(eq: ProposalEquipment, style: Style): string[] {
  const def: SymbolDefinition = getSymbol(eq.symbolId);
  const origin = { x: eq.x, y: eq.y };
  const out = def.primitives.map((p) => renderPrimitive(p, origin, eq.size, style));
  if (eq.tag === undefined || eq.tag === "") {
    return out;
  }
  const labelX = scale(50, origin.x, eq.size);
  const labelY = origin.y + eq.size + LABEL_OFFSET;
  const fill = style.ghost ? GHOST_STROKE : LABEL_FILL;
  const opacity = style.opacity !== undefined ? ` opacity="${style.opacity}"` : "";
  out.push(
    `<text x="${fmt(labelX)}" y="${fmt(labelY)}" font-family="${LABEL_FONT_FAMILY}" ` +
      `font-size="${LABEL_FONT_SIZE}" fill="${fill}" text-anchor="middle"${opacity} ` +
      `data-tag="${escapeText(eq.tag)}">${escapeText(eq.tag)}</text>`,
  );
  return out;
}

/** Render one connection edge as a straight port-to-port line, styled per class. */
function renderConnection(conn: ProposalConnection, style: Style): string {
  const attrs = strokeAttrs(style, conn.signal);
  const pts = `${fmt(conn.start.x)},${fmt(conn.start.y)} ${fmt(conn.end.x)},${fmt(conn.end.y)}`;
  return `<polyline points="${pts}" ${attrs} data-connection="${escapeText(conn.elementId)}"/>`;
}

/**
 * Render the proposal preview SVG for a given mode.
 *
 * Draw order is connectors first, then equipment bodies + labels (so equipment
 * sits on top of the lines meeting at its ports), and within each layer committed
 * elements first, then proposed (ghosted) on top — so the human sees the proposal
 * highlighted over the existing diagram.
 *
 * Mode controls which elements appear and how:
 *   - pending:  committed (normal) + proposed (ghost)
 *   - accepted: committed + proposed, all NORMAL (the proposal is now committed)
 *   - rejected: committed only, normal (the proposal is discarded)
 *
 * Pure: no I/O, no Excalidraw runtime. Identical input → identical SVG.
 */
export function renderProposalOverlay(
  diff: ProposalDiff,
  mode: ProposalRenderMode,
): string {
  const lines: string[] = [];

  // Committed connectors + (for accepted) proposed connectors, all normal.
  for (const c of diff.committedConnections) {
    lines.push(renderConnection(c, COMMITTED_STYLE));
  }
  if (mode === "pending") {
    for (const c of diff.proposedConnections) {
      lines.push(renderConnection(c, GHOST_STYLE));
    }
  } else if (mode === "accepted") {
    for (const c of diff.proposedConnections) {
      lines.push(renderConnection(c, COMMITTED_STYLE));
    }
  }
  // "rejected": no proposed connectors at all.

  const bodies: string[] = [];
  for (const eq of diff.committedEquipment) {
    bodies.push(...renderEquipment(eq, COMMITTED_STYLE));
  }
  if (mode === "pending") {
    for (const eq of diff.proposedEquipment) {
      bodies.push(...renderEquipment(eq, GHOST_STYLE));
    }
  } else if (mode === "accepted") {
    for (const eq of diff.proposedEquipment) {
      bodies.push(...renderEquipment(eq, COMMITTED_STYLE));
    }
  }

  const body = [...lines, ...bodies].join("\n  ");
  const { width, height } = diff.viewport;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" data-proposal="${mode}">`,
    `  ${body}`,
    `</svg>`,
    "",
  ].join("\n");
}
