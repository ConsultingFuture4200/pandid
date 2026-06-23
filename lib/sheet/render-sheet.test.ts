// Tests for the drawing-sheet renderer (DEV-1201).

import { describe, expect, it } from "vitest";

import { renderSheetSvg } from "./render-sheet";
import { defaultSheetMetadata } from "./types";

const sheet = {
  ...defaultSheetMetadata("ETHANOL EXTRACTION SYSTEM P&ID"),
  client: "John Z",
  drawingNo: "CW-PID-03",
  jobNo: "CW_111",
  revisions: [
    {
      rev: "0",
      date: "2026-06-17",
      description: "INITIAL RELEASE",
      drawnBy: "HRB",
      checkedBy: "BHR",
    },
  ],
};

describe("renderSheetSvg", () => {
  const svg = renderSheetSvg({
    diagramInner: '<rect x="0" y="0" width="10" height="10"/>',
    diagramWidth: 800,
    diagramHeight: 600,
    sheet,
    legend: ["Collection pot / tank", "Ball valve"],
  });

  it("is a valid svg framing the diagram", () => {
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain('data-sheet="pid"');
    // The diagram is embedded.
    expect(svg).toContain('<rect x="0" y="0" width="10" height="10"/>');
  });

  it("renders the title block fields", () => {
    expect(svg).toContain("ETHANOL EXTRACTION SYSTEM P&amp;ID");
    expect(svg).toContain("John Z");
    expect(svg).toContain("CW-PID-03");
    expect(svg).toContain("CW_111");
    expect(svg).toContain("N.T.S");
  });

  it("renders the revision table row", () => {
    expect(svg).toContain("INITIAL RELEASE");
    expect(svg).toContain("REV");
  });

  it("renders the zone grid labels (A–F, 1–10) and borders", () => {
    expect(svg).toContain(">A<");
    expect(svg).toContain(">F<");
    expect(svg).toContain(">1<");
    expect(svg).toContain(">10<");
  });

  it("renders the legend entries and general notes", () => {
    expect(svg).toContain("LEGEND &amp; ABBREVIATION");
    expect(svg).toContain("Ball valve");
    expect(svg).toContain("NOTES");
    expect(svg).toContain("ALL DIMENSIONS ARE IN MM UNLESS OTHERWISE SPECIFIED");
  });
});
