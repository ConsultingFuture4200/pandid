// Placement-model serializer tests — the load/save bridge between the live canvas
// and canonical state (this task: wire /editor to a real diagram).
//
// What must hold:
//   1. model → DiagramEdit produces the shape the SINGLE commit pipeline accepts
//      (elements with ports + attributes, derived connections), so a manual save
//      drives the same validate→persist path an accepted proposal does.
//   2. model → scene → snapshot → model round-trips: what the canvas commits is
//      what reloads (SC-6 spirit at the canvas layer), with metadata re-attached
//      by element id (never via customData — CLAUDE.md fact #1).
//   3. an empty / legacy snapshot projects to an empty model, not an error.
//
// These are pure (no browser, no I/O) so they pin the serialization deterministically.

import { describe, expect, it } from "vitest";
import {
  DiagramCommitPipeline,
  diagramEditSchema,
} from "@/lib/diagram/commit";
import {
  DiagramService,
  InMemoryDiagramRepository,
} from "@/lib/diagram";
import { createConnectivityValidator } from "@/lib/validator";
import {
  EMPTY_PLACEMENT_MODEL,
  placementModelToEdit,
  placementModelToScene,
  snapshotToPlacementModel,
  type PlacementModel,
} from "./placement-model";

const ACCOUNT = "11111111-1111-1111-1111-111111111111";

/** A small but valid two-node, one-edge model (passes v1 connectivity). */
function sampleModel(): PlacementModel {
  return {
    nodes: [
      {
        elementId: "col-1",
        symbolId: "extraction-column",
        x: 40,
        y: 40,
        size: 100,
        attributes: { tag: "EX-101", capacity: "5L", orientation: "vertical" },
      },
      {
        elementId: "tank-1",
        symbolId: "collection-tank",
        x: 40,
        y: 240,
        size: 100,
        attributes: { tag: "TK-101", volume: "200L" },
      },
    ],
    edges: [
      {
        elementId: "line-1",
        symbolId: "process-line",
        sourceElementId: "col-1",
        targetElementId: "tank-1",
        start: { x: 90, y: 140 },
        end: { x: 90, y: 240 },
        attributes: { lineId: "L-1", service: "extract" },
      },
    ],
    viewport: { width: 620, height: 520 },
  };
}

describe("placementModelToEdit", () => {
  it("emits a DiagramEdit the commit pipeline schema accepts", () => {
    const edit = placementModelToEdit(sampleModel());
    expect(diagramEditSchema.safeParse(edit).success).toBe(true);
  });

  it("turns nodes into elements with their symbol ports + attributes", () => {
    const edit = placementModelToEdit(sampleModel());
    const col = edit.elements.find((e) => e.id === "col-1");
    expect(col?.equipmentType).toBe("extraction-column");
    // Extraction-column exposes ports; they must be carried for the validator.
    expect(col?.portIds.length).toBeGreaterThan(0);
    expect(col?.attributes.tag).toBe("EX-101");
  });

  it("turns edges into connector elements AND derived connections", () => {
    const edit = placementModelToEdit(sampleModel());
    const line = edit.elements.find((e) => e.id === "line-1");
    expect(line?.equipmentType).toBe("process-line");
    expect(line?.portIds).toEqual([]);
    expect(edit.connections).toEqual([
      {
        elementId: "line-1",
        sourceElementId: "col-1",
        targetElementId: "tank-1",
      },
    ]);
  });
});

describe("placementModelToScene", () => {
  it("carries the structural pid projection the read tools/overlay read back", () => {
    const scene = placementModelToScene(sampleModel());
    const pid = (scene as { pid?: { placements?: unknown[]; connections?: unknown[] } })
      .pid;
    expect(pid?.placements).toHaveLength(2);
    expect(pid?.connections).toHaveLength(1);
  });
});

describe("snapshotToPlacementModel round-trip", () => {
  it("reloads the exact model committed through the single pipeline", async () => {
    const repo = new InMemoryDiagramRepository();
    const diagrams = new DiagramService(repo);
    const pipeline = new DiagramCommitPipeline(
      diagrams,
      createConnectivityValidator(),
    );
    const diagram = await diagrams.create({ accountId: ACCOUNT, name: "RT" });

    const model = sampleModel();
    const { snapshot } = await pipeline.commit({
      accountId: ACCOUNT,
      diagramId: diagram.id,
      edit: placementModelToEdit(model),
    });

    const reloaded = snapshotToPlacementModel(snapshot);

    // Nodes: same ids, symbols, geometry, and re-attached attributes (by id).
    expect(reloaded.nodes.map((n) => n.elementId).sort()).toEqual(
      ["col-1", "tank-1"],
    );
    const col = reloaded.nodes.find((n) => n.elementId === "col-1");
    expect(col?.symbolId).toBe("extraction-column");
    expect(col?.attributes.tag).toBe("EX-101");

    // Edge round-trips with endpoints + re-attached line attributes.
    expect(reloaded.edges).toHaveLength(1);
    expect(reloaded.edges[0]).toMatchObject({
      elementId: "line-1",
      symbolId: "process-line",
      sourceElementId: "col-1",
      targetElementId: "tank-1",
      attributes: { lineId: "L-1", service: "extract" },
    });
  });

  it("round-trips drawing-sheet metadata through the scene (DEV-1201)", () => {
    const sheet = {
      title: "Ethanol P&ID",
      client: "John Z",
      drawingNo: "CW-PID-03",
      jobNo: "CW_111",
      scale: "N.T.S",
      sheet: "1 of 1",
      drawnBy: "HRB",
      checkedBy: "BHR",
      approvedBy: "",
      notes: ["ALL DIMENSIONS IN MM"],
      revisions: [
        { rev: "0", date: "2026-06-17", description: "INITIAL RELEASE", drawnBy: "HRB", checkedBy: "BHR" },
      ],
    };
    const scene = placementModelToScene({ ...sampleModel(), sheet });
    const reloaded = snapshotToPlacementModel({
      version: {
        id: "00000000-0000-0000-0000-000000000000",
        diagramId: "00000000-0000-0000-0000-000000000001",
        excalidrawScene: scene,
        createdAt: "2026-06-20T00:00:00.000Z",
      },
      metadata: [],
    });
    expect(reloaded.sheet).toEqual(sheet);
  });

  it("round-trips connection waypoints through the scene (DEV-1210)", () => {
    const base = sampleModel();
    const waypoints = [
      { x: 300, y: 900 },
      { x: 40, y: 900 },
    ];
    const withWaypoints: PlacementModel = {
      ...base,
      edges: base.edges.map((e) => ({ ...e, waypoints })),
    };
    const scene = placementModelToScene(withWaypoints);
    const reloaded = snapshotToPlacementModel({
      version: {
        id: "00000000-0000-0000-0000-000000000000",
        diagramId: "00000000-0000-0000-0000-000000000001",
        excalidrawScene: scene,
        createdAt: "2026-06-20T00:00:00.000Z",
      },
      metadata: [],
    });
    expect(reloaded.edges[0].waypoints).toEqual(waypoints);
  });

  it("projects an empty/legacy scene to the empty model (not an error)", () => {
    const reloaded = snapshotToPlacementModel({
      version: {
        id: "00000000-0000-0000-0000-000000000000",
        diagramId: "00000000-0000-0000-0000-000000000001",
        excalidrawScene: { type: "excalidraw", elements: [], appState: {} },
        createdAt: "2026-06-20T00:00:00.000Z",
      },
      metadata: [],
    });
    expect(reloaded.nodes).toEqual([]);
    expect(reloaded.edges).toEqual([]);
    expect(reloaded.viewport).toEqual(EMPTY_PLACEMENT_MODEL.viewport);
  });
});
