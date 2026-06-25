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
    logo: "BIZZYBEE",
    projection: "third-angle",
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
  // Column-rack geometry. Each column has a JUNCTION tee centred directly above
  // (inlet) and below (outlet) it, so the manifold header tees off to each column
  // with an honest branch (DEV-1209) and the drops are clean vertical lines. The
  // per-column isolation valve sits inline on the horizontal header just left of
  // its junction.
  const cc = (i: number) => 540 + i * 200; // column centre x
  const inletJY = 300; // junction/valve box-top on the inlet header
  const colY = 460;
  const outletJY = 640; // junction/valve box-top on the outlet header

  // ── Solvent supply train (top-left): tank → chiller (pre-cool) → feed pump.
  // Kept clear of the return lane (a vertical line down the far left at x≈170).
  const solventTank = place("eq-solvent-tank", "vessel", 120, 120, {
    tag: "ST-101",
  });
  const chiller = place("eq-chiller", "chiller", 250, 130, {
    tag: "CH-101",
    duty: "",
    medium: "",
  });
  const feedPump = place("eq-feed-pump", "diaphragm-pump", 360, 130, {
    tag: "P-101",
    pumpType: "AODP",
  });

  // ── Material columns, inlet/outlet junction tees, and isolation valves
  const columns: PlacedRef[] = [];
  const inletJunctions: PlacedRef[] = [];
  const outletJunctions: PlacedRef[] = [];
  const inletValves: PlacedRef[] = [];
  const outletValves: PlacedRef[] = [];
  for (let i = 0; i < COLUMN_COUNT; i += 1) {
    const n = i + 1;
    columns.push(
      place(`eq-column-${n}`, "extraction-column", cc(i) - 50, colY, {
        tag: `MC-${n}`,
        capacity: "10 lb",
        orientation: "vertical",
      }),
    );
    inletJunctions.push(place(`eq-jt-in-${n}`, "junction", cc(i) - 50, inletJY));
    outletJunctions.push(place(`eq-jt-out-${n}`, "junction", cc(i) - 50, outletJY));
    inletValves.push(
      place(`eq-bv-in-${n}`, "ball-valve", cc(i) - 190, inletJY, {
        tag: `BV-${n}`,
        valveType: "ball",
      }),
    );
    outletValves.push(
      place(`eq-bv-out-${n}`, "ball-valve", cc(i) - 190, outletJY, {
        tag: `BV-${COLUMN_COUNT + n}`,
        valveType: "ball",
      }),
    );
  }

  // ── Recovery train along the bottom: cauldron → pump → filter → EPR vessel →
  // condenser. The recovered-ethanol return uses an explicit waypointed route
  // (DEV-1210) down the right and along the very bottom, clear of the rack.
  const cauldron = place("eq-cauldron", "collection-tank", 220, 940, {
    tag: "COL-101",
    volume: "",
  });
  const transferPump = place("eq-transfer-pump", "diaphragm-pump", 470, 950, {
    tag: "P-102",
    pumpType: "AODP",
  });
  const filter = place("eq-filter", "filter", 660, 940, {
    tag: "F-101",
    micronRating: "",
  });
  const recoveryVessel = place("eq-recovery-vessel", "vessel", 880, 940, {
    tag: "RV-101",
  });
  const condenser = place("eq-condenser", "condenser", 1120, 940, {
    tag: "CD-101",
    duty: "",
  });
  const crudeTank = place("eq-crude-tank", "collection-tank", 1340, 1080, {
    tag: "CV-101",
    volume: "",
  });

  const refs: readonly PlacedRef[] = [
    solventTank, chiller, feedPump,
    ...columns, ...inletJunctions, ...outletJunctions, ...inletValves, ...outletValves,
    cauldron, transferPump, filter, recoveryVessel, condenser, crudeTank,
  ];
  const nodes: readonly PlacedNode[] = refs.map((r) => r.node);

  let n = 0;
  const nextId = (): string => {
    n += 1;
    return String(n).padStart(2, "0");
  };
  const line = (
    from: ReturnType<typeof at>,
    to: ReturnType<typeof at>,
    waypoints?: readonly { readonly x: number; readonly y: number }[],
  ): PlacedEdge => {
    const id = nextId();
    return connect(
      `line-${id}`,
      from,
      to,
      { lineId: `L-${id}`, service: "" },
      waypoints,
    );
  };

  const edges: PlacedEdge[] = [
    // Solvent supply: tank → chiller → feed pump → first inlet valve.
    line(at(solventTank, "right"), at(chiller, "left")),
    line(at(chiller, "right"), at(feedPump, "suction")),
    line(at(feedPump, "discharge"), at(inletValves[0], "left")),
  ];
  // Inlet manifold: header runs valve → junction → valve → junction …; each
  // junction tees DOWN to its column.
  for (let i = 0; i < COLUMN_COUNT; i += 1) {
    edges.push(line(at(inletValves[i], "right"), at(inletJunctions[i], "left")));
    edges.push(line(at(inletJunctions[i], "bottom"), at(columns[i], "top")));
    if (i < COLUMN_COUNT - 1) {
      edges.push(line(at(inletJunctions[i], "right"), at(inletValves[i + 1], "left")));
    }
  }
  // Outlet manifold: each column drops into its junction tee; the header runs
  // junction → valve → junction …; the left end drains to the cauldron.
  for (let i = 0; i < COLUMN_COUNT; i += 1) {
    edges.push(line(at(columns[i], "bottom"), at(outletJunctions[i], "top")));
    edges.push(line(at(outletJunctions[i], "left"), at(outletValves[i], "right")));
    if (i < COLUMN_COUNT - 1) {
      edges.push(line(at(outletValves[i + 1], "left"), at(outletJunctions[i], "right")));
    }
  }
  edges.push(
    // Collection header → cauldron, then the recovery train.
    line(at(outletValves[0], "left"), at(cauldron, "top")),
    line(at(cauldron, "right"), at(transferPump, "suction")),
    line(at(transferPump, "discharge"), at(filter, "in")),
    line(at(filter, "out"), at(recoveryVessel, "left")),
    // EPR: vapour up to the condenser; crude drains off the recovery vessel.
    line(at(recoveryVessel, "top"), at(condenser, "inlet")),
    line(at(recoveryVessel, "bottom"), at(crudeTank, "top")),
    // Recovered ethanol back to the solvent tank — waypointed down the right and
    // along the very bottom (y=1260), clear of the rack (DEV-1210).
    line(at(condenser, "outlet"), at(solventTank, "bottom"), [
      { x: 1170, y: 1260 },
      { x: 170, y: 1260 },
    ]),
  );

  return {
    nodes,
    edges,
    viewport: { width: 1700, height: 1340 },
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
