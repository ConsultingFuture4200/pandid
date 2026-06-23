// Tests for export serializers (DEV-1156 line list, DEV-1157 .excalidraw).

import { describe, expect, it } from "vitest";

import {
  lineListToCsv,
  lineListToJson,
  toExcalidrawFile,
  type ExportLineRow,
} from "./serializers";

const ROWS: ExportLineRow[] = [
  {
    elementId: "line-1",
    lineId: "L-101",
    fromElementId: "C-101",
    fromTag: "C-101",
    toElementId: "T-101",
    toTag: "T-101",
    signal: false,
    service: "product",
  },
  {
    elementId: "sig-1",
    lineId: "S-1",
    fromElementId: "I-1",
    fromTag: "I-1",
    toElementId: "C-101",
    toTag: "C-101",
    signal: true,
    service: null,
  },
];

describe("lineListToCsv", () => {
  it("emits a header + one row per connection with process/signal type", () => {
    const csv = lineListToCsv(ROWS);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("lineId,fromTag,toTag,service,type");
    expect(lines[1]).toBe("L-101,C-101,T-101,product,process");
    expect(lines[2]).toBe("S-1,I-1,C-101,,signal");
  });

  it("quotes fields containing commas or quotes (RFC 4180)", () => {
    const csv = lineListToCsv([
      { ...ROWS[0], service: "steam, 150psi", lineId: 'L"1' },
    ]);
    expect(csv.split("\n")[1]).toBe('"L""1",C-101,T-101,"steam, 150psi",process');
  });

  it("matches connection count (one row per connection)", () => {
    expect(lineListToCsv(ROWS).split("\n")).toHaveLength(1 + ROWS.length);
  });
});

describe("lineListToJson", () => {
  it("describes the same topology as the CSV", () => {
    const records = JSON.parse(lineListToJson(ROWS)) as Array<
      Record<string, unknown>
    >;
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      lineId: "L-101",
      fromTag: "C-101",
      toTag: "T-101",
      service: "product",
      type: "process",
    });
    expect(records[1]).toMatchObject({ type: "signal", service: null });
  });
});

describe("toExcalidrawFile", () => {
  it("wraps elements in a valid .excalidraw envelope", () => {
    const file = JSON.parse(toExcalidrawFile([{ id: "a", type: "rectangle" }]));
    expect(file.type).toBe("excalidraw");
    expect(file.version).toBe(2);
    expect(Array.isArray(file.elements)).toBe(true);
    expect(file.elements[0].id).toBe("a");
    expect(file.appState).toBeDefined();
    expect(file.files).toEqual({});
  });
});
