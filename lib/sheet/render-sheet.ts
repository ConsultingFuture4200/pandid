// Drawing-sheet renderer (DEV-1201, Bucket B).
//
// Frames a P&ID in standard engineering-drawing furniture so an export reads
// like a real sheet: outer/inner border, zone grid (rows A–F × columns 1–10),
// a title block, a revision table, a legend, and general notes. Pure +
// deterministic SVG — no I/O, no Excalidraw runtime — so it composes with the
// diagram SVG (DEV-1157) and is byte-stable for tests.

import type { SheetMetadata } from "./types";

/** Fixed sheet canvas (landscape, ~A3 proportion). The diagram scales to fit. */
const SHEET_W = 1600;
const SHEET_H = 1100;
const MARGIN = 28;
/** Height of the bottom strip reserved for legend / notes / title block. */
const STRIP_H = 210;
const ROWS = ["A", "B", "C", "D", "E", "F"] as const;
const COLS = 10;
const STROKE = "#1e1e1e";

interface RenderSheetInput {
  /** The diagram's inner SVG markup (no wrapper) — see `diagramSvgInner`. */
  readonly diagramInner: string;
  readonly diagramWidth: number;
  readonly diagramHeight: number;
  readonly sheet: SheetMetadata;
  /** Symbol names used in the diagram, for the legend block. */
  readonly legend: readonly string[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function rect(x: number, y: number, w: number, h: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${STROKE}" stroke-width="1"/>`;
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${STROKE}" stroke-width="1"/>`;
}

function text(
  x: number,
  y: number,
  s: string,
  opts: { size?: number; anchor?: "start" | "middle" | "end"; bold?: boolean } = {},
): string {
  const size = opts.size ?? 11;
  const anchor = opts.anchor ?? "start";
  const weight = opts.bold ? ' font-weight="bold"' : "";
  return `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" text-anchor="${anchor}"${weight} fill="${STROKE}">${esc(s)}</text>`;
}

/** Border + A–F × 1–10 zone ticks just inside the inner frame. */
function renderFrame(ix: number, iy: number, iw: number, ih: number): string {
  const parts: string[] = [
    rect(MARGIN / 2, MARGIN / 2, SHEET_W - MARGIN, SHEET_H - MARGIN), // outer
    rect(ix, iy, iw, ih), // inner
  ];
  const colW = iw / COLS;
  for (let c = 0; c < COLS; c += 1) {
    const cx = ix + colW * (c + 0.5);
    const label = String(COLS - c); // 10…1 left-to-right, like a CAD sheet
    parts.push(text(cx, iy - 6, label, { anchor: "middle", size: 10 }));
    parts.push(text(cx, iy + ih + 14, label, { anchor: "middle", size: 10 }));
    if (c > 0) {
      const gx = ix + colW * c;
      parts.push(line(gx, iy, gx, iy + 8));
      parts.push(line(gx, iy + ih, gx, iy + ih - 8));
    }
  }
  const rowH = ih / ROWS.length;
  ROWS.forEach((rowLabel, r) => {
    const cy = iy + rowH * (r + 0.5) + 4;
    parts.push(text(ix - 14, cy, rowLabel, { anchor: "middle", size: 10 }));
    parts.push(text(ix + iw + 14, cy, rowLabel, { anchor: "middle", size: 10 }));
    if (r > 0) {
      const gy = iy + rowH * r;
      parts.push(line(ix, gy, ix + 8, gy));
      parts.push(line(ix + iw, gy, ix + iw - 8, gy));
    }
  });
  return parts.join("\n  ");
}

/** Title block (bottom-right): two-column field grid + revision rows on top. */
function renderTitleBlock(x: number, y: number, w: number, h: number, s: SheetMetadata): string {
  const parts: string[] = [rect(x, y, w, h)];
  // Revision strip across the top (latest 2 revisions).
  const revH = 18;
  const revs = s.revisions.slice(-2);
  parts.push(line(x, y + revH * (revs.length + 1), x + w, y + revH * (revs.length + 1)));
  parts.push(text(x + 4, y + 13, "REV", { size: 9, bold: true }));
  parts.push(text(x + 46, y + 13, "DATE", { size: 9, bold: true }));
  parts.push(text(x + 150, y + 13, "DESCRIPTION", { size: 9, bold: true }));
  parts.push(text(x + w - 90, y + 13, "DRN", { size: 9, bold: true }));
  parts.push(text(x + w - 44, y + 13, "CHK", { size: 9, bold: true }));
  revs.forEach((rev, i) => {
    const ry = y + revH * (i + 1) + 13;
    parts.push(text(x + 4, ry, rev.rev, { size: 9 }));
    parts.push(text(x + 46, ry, rev.date, { size: 9 }));
    parts.push(text(x + 150, ry, rev.description, { size: 9 }));
    parts.push(text(x + w - 90, ry, rev.drawnBy, { size: 9 }));
    parts.push(text(x + w - 44, ry, rev.checkedBy, { size: 9 }));
  });

  // Field grid below the revision strip.
  const top = y + revH * (revs.length + 1);
  const fieldH = (h - (top - y)) / 4;
  const field = (col: number, row: number, cols: number, label: string, value: string): string => {
    const cw = w / 2;
    const fx = x + col * cw;
    const fy = top + row * fieldH;
    const fw = cw * cols;
    return [
      rect(fx, fy, fw, fieldH),
      text(fx + 4, fy + 11, label, { size: 8, bold: true }),
      text(fx + 6, fy + fieldH - 6, value, { size: 12 }),
    ].join("\n  ");
  };
  parts.push(field(0, 0, 2, "TITLE", s.title));
  parts.push(field(0, 1, 1, "CLIENT", s.client));
  parts.push(field(1, 1, 1, "DRAWING NO", s.drawingNo));
  parts.push(field(0, 2, 1, "JOB NO", s.jobNo));
  parts.push(field(1, 2, 1, "SCALE / SHEET", `${s.scale}   ${s.sheet}`));
  parts.push(field(0, 3, 1, "DRAWN", s.drawnBy));
  parts.push(field(1, 3, 1, "CHECKED / APPROVED", `${s.checkedBy}  ${s.approvedBy}`));
  return parts.join("\n  ");
}

/** Legend block (bottom-left): the symbols used in the diagram. */
function renderLegend(x: number, y: number, w: number, h: number, legend: readonly string[]): string {
  const parts: string[] = [rect(x, y, w, h), text(x + 6, y + 16, "LEGEND & ABBREVIATION", { size: 10, bold: true })];
  legend.slice(0, 9).forEach((name, i) => {
    parts.push(text(x + 10, y + 36 + i * 18, `• ${name}`, { size: 10 }));
  });
  return parts.join("\n  ");
}

/** General notes block (bottom-centre). */
function renderNotes(x: number, y: number, w: number, h: number, notes: readonly string[]): string {
  const parts: string[] = [rect(x, y, w, h), text(x + 6, y + 16, "NOTES", { size: 10, bold: true })];
  notes.slice(0, 8).forEach((note, i) => {
    parts.push(text(x + 10, y + 36 + i * 18, `${i + 1}. ${note}`, { size: 10 }));
  });
  return parts.join("\n  ");
}

/** Render a full drawing sheet: framed border + grid, the diagram scaled to fit
 * the drawing area, and the legend / notes / title block strip along the bottom. */
export function renderSheetSvg(input: RenderSheetInput): string {
  const ix = MARGIN;
  const iy = MARGIN;
  const iw = SHEET_W - MARGIN * 2;
  const ih = SHEET_H - MARGIN * 2;
  // Drawing area = above the bottom strip.
  const drawW = iw - 8;
  const drawH = ih - STRIP_H - 8;
  const drawX = ix + 4;
  const drawY = iy + 4;

  const stripY = iy + ih - STRIP_H;
  const legendW = 320;
  const titleW = 560;
  const notesX = ix + legendW + 8;
  const notesW = iw - legendW - titleW - 16;

  const vw = input.diagramWidth > 0 ? input.diagramWidth : 1;
  const vh = input.diagramHeight > 0 ? input.diagramHeight : 1;

  const body = [
    renderFrame(ix, iy, iw, ih),
    // Diagram, scaled to fit the drawing area (preserve aspect).
    `<svg x="${drawX}" y="${drawY}" width="${drawW}" height="${drawH}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">`,
    `  ${input.diagramInner}`,
    `</svg>`,
    renderLegend(ix, stripY, legendW, STRIP_H, input.legend),
    renderNotes(notesX, stripY, notesW, STRIP_H, input.sheet.notes),
    renderTitleBlock(ix + iw - titleW, stripY, titleW, STRIP_H, input.sheet),
  ].join("\n  ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" data-sheet="pid"><rect x="0" y="0" width="${SHEET_W}" height="${SHEET_H}" fill="#ffffff"/>`,
    `  ${body}`,
    `</svg>`,
    "",
  ].join("\n");
}
