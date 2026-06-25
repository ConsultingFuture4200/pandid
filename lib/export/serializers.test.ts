// Tests for export serializers (DEV-1156 line list, DEV-1157 .excalidraw).

import { describe, expect, it } from "vitest";

import {
  equipmentScheduleToCsv,
  equipmentScheduleToJson,
  lineListToCsv,
  lineListToJson,
  toExcalidrawFile,
  type ExportEquipmentRow,
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

const EQUIPMENT: ExportEquipmentRow[] = [
  {
    tag: "EX-101",
    type: "Extraction column",
    equipmentType: "extraction-column",
    attributes: { orientation: "vertical", capacity: "10 lb" },
  },
  {
    tag: "HX-201",
    type: "Heat exchanger",
    equipmentType: "heat-exchanger",
    attributes: { duty: "", medium: "glycol, water" },
  },
];

describe("equipmentScheduleToCsv", () => {
  it("numbers rows and renders sorted, non-blank specs; quotes commas", () => {
    const lines = equipmentScheduleToCsv(EQUIPMENT).split("\n");
    expect(lines[0]).toBe("item,tag,type,specification");
    // capacity before orientation (sorted); both shown.
    expect(lines[1]).toBe("1,EX-101,Extraction column,capacity: 10 lb; orientation: vertical");
    // blank duty omitted; the comma in the medium value forces quoting.
    expect(lines[2]).toBe('2,HX-201,Heat exchanger,"medium: glycol, water"');
  });
});

describe("equipmentScheduleToJson", () => {
  it("carries item, tag, type, machine id, and full attributes", () => {
    const records = JSON.parse(equipmentScheduleToJson(EQUIPMENT));
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      item: 1,
      tag: "EX-101",
      type: "Extraction column",
      equipmentType: "extraction-column",
      attributes: { orientation: "vertical", capacity: "10 lb" },
    });
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
