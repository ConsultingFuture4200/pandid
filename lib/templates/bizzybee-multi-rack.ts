// Template: "BizzyBee Multi-Rack — Ethanol (ethyl solvent) extraction".
//
// Modeled on the BizzyBee Multi-Rack / Large Ethyl Solvent Rack (closed-loop
// ethanol extraction): a solvent tank feeds chilled ethanol through a pump to a
// rack of 10 lb material columns (inlet manifold across the top, collection
// manifold across the bottom); extracted solution drains to a collection
// cauldron, is pumped through a filter into an Electro-Passive-Recovery (EPR)
// vessel, and recovered ethanol condenses back to the solvent tank — a closed
// loop. Crude oil drains off the recovery vessel.
//
// Fidelity note: same symbol-library approximations as the ethanol-extraction
// template (cauldron/recovery → vessel, AODP → diaphragm-pump), and the inlet/
// collection headers are approximated by chained port-to-port edges (no tee
// junction yet — see DEV-1209). Reference:
// https://www.bizzybee.com/products/large-ethyl-solvent-rack

import type {
  PlacedEdge,
  PlacedNode,
  PlacementModel,
} from "@/components/canvas/placement-model";
import type { SheetMetadata } from "@/lib/sheet/types";
import type { DiagramTemplate } from "./types";
import { at, connect, place, type PlacedRef } from "./build";

/** Number of material columns on the rack. */
const COLUMN_COUNT = 6;

function multiRackSheet(): SheetMetadata {
  return {
    title: "BIZZYBEE MULTI-RACK — ETHANOL EXTRACTION P&ID",
    client: "",
    drawingNo: "BB-MR-01",
    jobNo: "",
    scale: "N.T.S",
    sheet: "1 OF 1",
    drawnBy: "",
    checkedBy: "",
    approvedBy: "",
    notes: [
      "ALL DIMENSIONS ARE IN MM UNLESS OTHERWISE SPECIFIED",
      "CLOSED-LOOP ETHYL (ETHANOL) SOLVENT EXTRACTION. SOLVENT RECOVERY BY ELECTRO-PASSIVE RECOVERY (EPR).",
      "MATERIAL COLUMNS: 6 x 10 LB. SEE BIZZYBEE MULTI-RACK / LARGE ETHYL SOLVENT RACK.",
    ],
    revisions: [
      {
        rev: "0",
        date: "25.06.2026",
        description: "INITIAL RELEASE",
        drawnBy: "",
        checkedBy: "",
      },
    ],
  };
}

function buildModel(): PlacementModel {
  // Column rack geometry: COLUMN_COUNT columns in a row, inlet valves above,
  // outlet valves below.
  const colY = 420;
  const inletY = 300;
  const outletY = 600;
  const colX = (i: number) => 380 + i * 160;

  // ── Solvent supply train (top-left): tank → chiller (pre-cool) → feed pump
  const solventTank = place("eq-solvent-tank", "vessel", 100, 120, {
    tag: "ST-101",
  });
  const chiller = place("eq-chiller", "chiller", 280, 130, {
    tag: "CH-101",
    duty: "",
    medium: "",
  });
  const feedPump = place("eq-feed-pump", "diaphragm-pump", 460, 130, {
    tag: "P-101",
    pumpType: "AODP",
  });

  // ── Material columns + their inlet / outlet valves
  const columns: PlacedRef[] = [];
  const inletValves: PlacedRef[] = [];
  const outletValves: PlacedRef[] = [];
  for (let i = 0; i < COLUMN_COUNT; i += 1) {
    const n = i + 1;
    columns.push(
      place(`eq-column-${n}`, "extraction-column", colX(i), colY, {
        tag: `MC-${n}`,
        capacity: "10 lb",
        orientation: "vertical",
      }),
    );
    inletValves.push(
      place(`eq-bv-in-${n}`, "ball-valve", colX(i), inletY, {
        tag: `BV-${n}`,
        valveType: "ball",
      }),
    );
    outletValves.push(
      place(`eq-bv-out-${n}`, "ball-valve", colX(i), outletY, {
        tag: `BV-${COLUMN_COUNT + n}`,
        valveType: "ball",
      }),
    );
  }

  // ── Recovery train (bottom): cauldron → pump → filter → EPR vessel → condenser
  const cauldron = place("eq-cauldron", "collection-tank", 180, 780, {
    tag: "COL-101",
    volume: "",
  });
  const transferPump = place("eq-transfer-pump", "diaphragm-pump", 400, 790, {
    tag: "P-102",
    pumpType: "AODP",
  });
  const filter = place("eq-filter", "filter", 580, 780, {
    tag: "F-101",
    micronRating: "",
  });
  const recoveryVessel = place("eq-recovery-vessel", "vessel", 780, 780, {
    tag: "RV-101",
  });
  const condenser = place("eq-condenser", "condenser", 1010, 780, {
    tag: "CD-101",
    duty: "",
  });
  const crudeTank = place("eq-crude-tank", "collection-tank", 780, 960, {
    tag: "CV-101",
    volume: "",
  });

  const refs: readonly PlacedRef[] = [
    solventTank, chiller, feedPump,
    ...columns, ...inletValves, ...outletValves,
    cauldron, transferPump, filter, recoveryVessel, condenser, crudeTank,
  ];
  const nodes: readonly PlacedNode[] = refs.map((r) => r.node);

  let n = 0;
  const line = (from: ReturnType<typeof at>, to: ReturnType<typeof at>): PlacedEdge => {
    n += 1;
    const id = `line-${String(n).padStart(2, "0")}`;
    return connect(id, from, to, { lineId: `L-${String(n).padStart(2, "0")}`, service: "" });
  };

  const edges: PlacedEdge[] = [
    // Solvent supply: tank → chiller → feed pump → inlet manifold
    line(at(solventTank, "right"), at(chiller, "left")),
    line(at(chiller, "right"), at(feedPump, "suction")),
    line(at(feedPump, "discharge"), at(inletValves[0], "left")),
  ];
  // Inlet manifold header (chained valves) + a drop from each valve to its column
  for (let i = 0; i < COLUMN_COUNT; i += 1) {
    if (i < COLUMN_COUNT - 1) {
      edges.push(line(at(inletValves[i], "right"), at(inletValves[i + 1], "left")));
    }
    edges.push(line(at(inletValves[i], "right"), at(columns[i], "top")));
  }
  // Each column drains through its outlet valve into the collection header
  for (let i = 0; i < COLUMN_COUNT; i += 1) {
    edges.push(line(at(columns[i], "bottom"), at(outletValves[i], "left")));
    if (i < COLUMN_COUNT - 1) {
      edges.push(line(at(outletValves[i], "right"), at(outletValves[i + 1], "left")));
    }
  }
  edges.push(
    // Collection header → cauldron, then the recovery train
    line(at(outletValves[0], "left"), at(cauldron, "top")),
    line(at(cauldron, "right"), at(transferPump, "suction")),
    line(at(transferPump, "discharge"), at(filter, "in")),
    line(at(filter, "out"), at(recoveryVessel, "left")),
    // EPR: vapor up to the condenser, recovered ethanol back to the solvent tank
    line(at(recoveryVessel, "top"), at(condenser, "inlet")),
    line(at(condenser, "outlet"), at(solventTank, "top")),
    // Crude oil drains off the recovery vessel
    line(at(recoveryVessel, "bottom"), at(crudeTank, "top")),
  );

  return {
    nodes,
    edges,
    viewport: { width: 1800, height: 1120 },
    sheet: multiRackSheet(),
  };
}

export const BIZZYBEE_MULTI_RACK_TEMPLATE: DiagramTemplate = {
  id: "bizzybee-multi-rack",
  name: "BizzyBee Multi-Rack (Ethanol)",
  description:
    "Closed-loop ethyl-solvent multi-rack: solvent tank + chiller feed a rack of six 10 lb material columns; solution is collected, filtered, and recovered by EPR back to the solvent tank.",
  diagramName: "BizzyBee Multi-Rack — Ethanol Extraction P&ID",
  buildModel,
};
