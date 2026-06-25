// Template: "Closed-loop hydrocarbon (BHO) extractor".
//
// A compact single-column closed-loop hydrocarbon (butane/propane) extractor: a
// chilled solvent tank feeds liquid solvent into the top of an extraction column;
// the solution drains to a heated collection pot where the solvent flashes off;
// vapour is drawn through a recovery pump to a chiller-cooled condenser and the
// recovered solvent returns to the tank — a closed loop. The chiller tees off a
// junction to cool both the solvent feed and the condenser (DEV-1209); the
// recovered-solvent return is waypointed clear of the equipment (DEV-1210).

import type {
  PlacedEdge,
  PlacedNode,
  PlacementModel,
} from "@/components/canvas/placement-model";
import type { SheetMetadata } from "@/lib/sheet/types";
import type { DiagramTemplate } from "./types";
import { at, connect, place } from "./build";

function extractorSheet(): SheetMetadata {
  return {
    title: "CLOSED-LOOP HYDROCARBON EXTRACTOR P&ID",
    client: "",
    drawingNo: "HC-EX-01",
    jobNo: "",
    scale: "N.T.S",
    sheet: "1 OF 1",
    drawnBy: "",
    checkedBy: "",
    approvedBy: "",
    projection: "third-angle",
    notes: [
      "ALL DIMENSIONS ARE IN MM UNLESS OTHERWISE SPECIFIED",
      "CLOSED-LOOP HYDROCARBON (BUTANE/PROPANE) EXTRACTION. SOLVENT RECOVERED BY HEATED FLASH + CONDENSER.",
    ],
    revisions: [
      { rev: "0", date: "25.06.2026", description: "INITIAL RELEASE", drawnBy: "", checkedBy: "" },
    ],
  };
}

function buildModel(): PlacementModel {
  // ── Solvent supply (top-left) → chiller → junction tee → feed valve → column
  const solventTank = place("eq-solvent-tank", "vessel", 120, 180, { tag: "ST-201" });
  const chiller = place("eq-chiller", "chiller", 320, 190, {
    tag: "CH-201",
    duty: "",
    medium: "",
  });
  // A junction tees the chilled feed line up to the pressure indicator (an
  // instrument tap) and onward to the feed valve.
  const feedTee = place("eq-jt-feed", "junction", 500, 190);
  const gauge = place("eq-pi", "instrument-bubble", 450, 60, {
    tag: "PI-201",
    measuredVariable: "pressure",
  });
  const feedValve = place("eq-bv-feed", "ball-valve", 640, 190, {
    tag: "BV-201",
    valveType: "ball",
  });

  // ── Extraction column
  const column = place("eq-column", "extraction-column", 740, 340, {
    tag: "EX-201",
    capacity: "",
    orientation: "vertical",
  });

  // ── Drain valve → heated collection pot
  const drainValve = place("eq-bv-drain", "ball-valve", 740, 540, {
    tag: "BV-202",
    valveType: "ball",
  });
  const collectionPot = place("eq-pot", "collection-tank", 700, 660, {
    tag: "CP-201",
    volume: "",
  });
  const heater = place("eq-heater", "heater", 920, 660, {
    tag: "H-201",
    duty: "",
    medium: "",
  });

  // ── Recovery: pump → chiller-cooled condenser → back to the solvent tank
  const recoveryPump = place("eq-recovery-pump", "diaphragm-pump", 1080, 540, {
    tag: "P-201",
    pumpType: "",
  });
  const condenser = place("eq-condenser", "condenser", 1080, 320, {
    tag: "CD-201",
    duty: "",
  });

  const refs = [
    solventTank, chiller, feedTee, gauge, feedValve, column,
    drainValve, collectionPot, heater, recoveryPump, condenser,
  ] as const;
  const nodes: readonly PlacedNode[] = refs.map((r) => r.node);

  let n = 0;
  const line = (
    from: ReturnType<typeof at>,
    to: ReturnType<typeof at>,
    waypoints?: readonly { readonly x: number; readonly y: number }[],
  ): PlacedEdge => {
    n += 1;
    const id = String(n).padStart(2, "0");
    return connect(`line-${id}`, from, to, { lineId: `L-${id}`, service: "" }, waypoints);
  };

  const edges: readonly PlacedEdge[] = [
    // Solvent feed: tank → chiller → junction tee → feed valve → column top.
    line(at(solventTank, "right"), at(chiller, "left")),
    line(at(chiller, "right"), at(feedTee, "left")),
    line(at(feedTee, "right"), at(feedValve, "left")),
    line(at(feedValve, "right"), at(column, "top")),
    // The junction taps the feed line up to the pressure indicator.
    line(at(feedTee, "top"), at(gauge, "process")),
    // Column drains through the valve into the heated collection pot.
    line(at(column, "bottom"), at(drainValve, "left")),
    line(at(drainValve, "right"), at(collectionPot, "top")),
    line(at(heater, "left"), at(collectionPot, "right")),
    // Recovery: pot → pump → condenser → recovered solvent back to the tank.
    // The condenser sits directly above the pump, so the return steps RIGHT into
    // a clear lane (x=1180, past the pump) before dropping to the bottom lane and
    // back to the tank — orthogonal and clear of every body (DEV-1210).
    line(at(collectionPot, "bottom"), at(recoveryPump, "suction")),
    line(at(recoveryPump, "discharge"), at(condenser, "inlet")),
    line(at(condenser, "outlet"), at(solventTank, "bottom"), [
      { x: 1130, y: 460 },
      { x: 1180, y: 460 },
      { x: 1180, y: 880 },
      { x: 170, y: 880 },
    ]),
  ];

  return {
    nodes,
    edges,
    viewport: { width: 1320, height: 960 },
    sheet: extractorSheet(),
  };
}

export const HYDROCARBON_EXTRACTOR_TEMPLATE: DiagramTemplate = {
  id: "hydrocarbon-extractor",
  name: "Hydrocarbon Extractor (BHO)",
  description:
    "Closed-loop butane/propane extractor: chilled solvent → extraction column → heated collection pot → recovery pump + chiller-cooled condenser back to the solvent tank.",
  diagramName: "Closed-Loop Hydrocarbon Extractor P&ID",
  buildModel,
};
