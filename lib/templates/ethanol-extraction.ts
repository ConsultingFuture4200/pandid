// Template: "Ethanol Extraction System P&ID" (a faithful copy of the supplied
// CADWORX drawing). Two equipment bands — an extraction/chilling top band and a
// filter/evaporator/condenser bottom band — wired with process lines through
// inline ball valves, plus the drawing's title block.
//
// Fidelity note: the symbol library is approximate (CID2 pump → generic pump,
// AODP → diaphragm-pump, tanks → vessel, wavy runs → expansion-joint), and the
// model has no tee/junction or arbitrary-waypoint routing, so shared headers and
// some long runs are approximated by orthogonally-routed port-to-port edges. See
// the plan's "Known fidelity gaps" for the capabilities a 1:1 copy would need.

import type {
  PlacedEdge,
  PlacedNode,
  PlacementModel,
} from "@/components/canvas/placement-model";
import type { SheetMetadata } from "@/lib/sheet/types";
import type { DiagramTemplate } from "./types";
import { at, connect, place, type PlacedRef } from "./build";

/** Title block copied from the drawing (CADWORX, rev 0). */
function ethanolSheet(): SheetMetadata {
  return {
    title: "ETHANOL EXTRACTION SYSTEM P&ID",
    client: "John Z",
    drawingNo: "CW-PID-03",
    jobNo: "CW_111",
    scale: "N.T.S",
    sheet: "1 OF 1",
    drawnBy: "HRB",
    checkedBy: "BHR",
    approvedBy: "BHR",
    logo: "CADWORX",
    projection: "third-angle",
    notes: [
      "ALL DIMENSIONS ARE IN MM UNLESS OTHERWISE SPECIFIED",
      "THIS DRAWING IS THE PRIVATE PROPERTY OF JOHN Z / CADWORX. UNAUTHORIZED DISCLOSURE TO ANY THIRD PARTY OR DUPLICATION NOT PERMITTED.",
    ],
    revisions: [
      {
        rev: "0",
        date: "17.05.2026",
        description: "INITIAL RELEASE",
        drawnBy: "HRB",
        checkedBy: "BHR",
      },
    ],
  };
}

/** Build the placement model for the ethanol-extraction template. */
function buildModel(): PlacementModel {
  // ── Top band: holding tank → AODP#1 → centrifuge, chilling loop, AODP#2 → warm
  const holdingTank = place("eq-holding-tank", "vessel", 120, 200, {
    tag: "HOLDING TANK",
  });
  const bv1 = place("eq-bv-1", "ball-valve", 180, 90, { tag: "BV-1", valveType: "ball" });
  const bv2 = place("eq-bv-2", "ball-valve", 300, 240, { tag: "BV-2", valveType: "ball" });
  const bv3 = place("eq-bv-3", "ball-valve", 180, 380, { tag: "BV-3", valveType: "ball" });
  const aodp1 = place("eq-aodp-1", "diaphragm-pump", 380, 220, {
    tag: "AODP #1",
    pumpType: "AODP",
  });
  const centrifuge = place("eq-centrifuge", "centrifuge", 560, 200, {
    tag: "CENTRIFUGE",
  });
  const bv4 = place("eq-bv-4", "ball-valve", 520, 90, { tag: "BV-4", valveType: "ball" });
  const bv5 = place("eq-bv-5", "ball-valve", 520, 380, { tag: "BV-5", valveType: "ball" });
  const exp1 = place("eq-exp-1", "expansion-joint", 700, 110, {});
  const chillingTank = place("eq-chilling-tank", "vessel", 980, 200, {
    tag: "CHILLING TANK",
  });
  const bv6 = place("eq-bv-6", "ball-valve", 1080, 90, { tag: "BV-6", valveType: "ball" });
  const bv7 = place("eq-bv-7", "ball-valve", 1080, 180, { tag: "BV-7", valveType: "ball" });
  const bv8 = place("eq-bv-8", "ball-valve", 940, 360, { tag: "BV-8", valveType: "ball" });
  const hxChilling = place("eq-hx-chilling", "heat-exchanger", 1180, 220, {
    tag: "HX-101",
    duty: "",
    medium: "",
  });
  const cid2Chilling = place("eq-cid2-chilling", "pump", 1180, 400, {
    tag: "CID2 PUMP",
    pumpType: "CID2",
  });
  const aodp2 = place("eq-aodp-2", "diaphragm-pump", 1400, 220, {
    tag: "AODP #2",
    pumpType: "AODP",
  });
  const bv9 = place("eq-bv-9", "ball-valve", 1480, 380, { tag: "BV-9", valveType: "ball" });
  const warmTank = place("eq-warm-tank", "vessel", 1600, 200, { tag: "WARM TANK" });
  const exp2 = place("eq-exp-2", "expansion-joint", 1320, 110, {});

  // ── Bottom band: filter → fee feed tank → evaporator → vessel → condenser
  const bv10 = place("eq-bv-10", "ball-valve", 140, 700, { tag: "BV-10", valveType: "ball" });
  const bv11 = place("eq-bv-11", "ball-valve", 320, 700, { tag: "BV-11", valveType: "ball" });
  const filter = place("eq-filter", "filter", 200, 780, { tag: "FILTER", micronRating: "" });
  const bv12 = place("eq-bv-12", "ball-valve", 140, 940, { tag: "BV-12", valveType: "ball" });
  const bv13 = place("eq-bv-13", "ball-valve", 320, 940, { tag: "BV-13", valveType: "ball" });
  const feeFeedTank = place("eq-fee-feed-tank", "vessel", 480, 780, {
    tag: "FEE FEED TANK",
  });
  const bv14 = place("eq-bv-14", "ball-valve", 520, 960, { tag: "BV-14", valveType: "ball" });
  const cid2Feed = place("eq-cid2-feed", "pump", 720, 860, {
    tag: "CID2 PUMP",
    pumpType: "CID2",
  });
  const hxEvap = place("eq-hx-evap", "heat-exchanger", 720, 700, {
    tag: "HX-201",
    duty: "",
    medium: "",
  });
  const evaporator = place("eq-evaporator", "evaporator", 960, 740, {
    tag: "EVAP.",
    duty: "",
  });
  const cid2Evap = place("eq-cid2-evap", "pump", 960, 960, {
    tag: "CID2 PUMP",
    pumpType: "CID2",
  });
  const midVessel = place("eq-mid-vessel", "vessel", 1180, 740, {});
  const condenser = place("eq-condenser", "condenser", 1420, 740, {
    tag: "CONDENSER",
    duty: "",
  });
  const cid2Condenser = place("eq-cid2-condenser", "pump", 1420, 960, {
    tag: "CID2 PUMP",
    pumpType: "CID2",
  });

  const refs: readonly PlacedRef[] = [
    holdingTank, bv1, bv2, bv3, aodp1, centrifuge, bv4, bv5, exp1,
    chillingTank, bv6, bv7, bv8, hxChilling, cid2Chilling, aodp2, bv9, warmTank, exp2,
    bv10, bv11, filter, bv12, bv13, feeFeedTank, bv14, cid2Feed, hxEvap,
    evaporator, cid2Evap, midVessel, condenser, cid2Condenser,
  ];
  const nodes: readonly PlacedNode[] = refs.map((r) => r.node);

  // Process-line edges. Each is one visible pipe run between two nearby ports;
  // an auto-numbered lineId, service left blank (filled by the user).
  let n = 0;
  const line = (from: ReturnType<typeof at>, to: ReturnType<typeof at>): PlacedEdge => {
    n += 1;
    const id = `line-${String(n).padStart(2, "0")}`;
    return connect(id, from, to, { lineId: `L-${String(n).padStart(2, "0")}`, service: "" });
  };

  const edges: readonly PlacedEdge[] = [
    // Extraction subsystem
    line(at(bv1, "left"), at(holdingTank, "top")),
    line(at(bv1, "right"), at(bv4, "left")),
    line(at(holdingTank, "right"), at(bv2, "left")),
    line(at(bv2, "right"), at(aodp1, "suction")),
    line(at(aodp1, "discharge"), at(centrifuge, "left")),
    line(at(bv4, "right"), at(centrifuge, "feed")),
    line(at(centrifuge, "right"), at(exp1, "left")),
    line(at(exp1, "right"), at(bv6, "left")),
    line(at(holdingTank, "bottom"), at(bv3, "left")),
    line(at(centrifuge, "discharge"), at(bv5, "left")),
    line(at(bv3, "right"), at(filter, "in")),
    line(at(bv5, "right"), at(feeFeedTank, "top")),
    // Chilling subsystem
    line(at(bv6, "right"), at(bv7, "left")),
    line(at(bv7, "right"), at(chillingTank, "top")),
    line(at(chillingTank, "right"), at(hxChilling, "left")),
    line(at(hxChilling, "bottom"), at(cid2Chilling, "suction")),
    line(at(cid2Chilling, "discharge"), at(bv8, "right")),
    line(at(bv8, "left"), at(chillingTank, "bottom")),
    line(at(hxChilling, "right"), at(aodp2, "suction")),
    line(at(aodp2, "discharge"), at(bv9, "left")),
    line(at(bv9, "right"), at(warmTank, "bottom")),
    line(at(hxChilling, "top"), at(exp2, "right")),
    line(at(exp2, "left"), at(warmTank, "top")),
    // Filter / feed / evaporator / condenser subsystem
    line(at(bv10, "right"), at(filter, "in")),
    line(at(filter, "out"), at(bv11, "left")),
    line(at(bv11, "right"), at(feeFeedTank, "left")),
    line(at(bv12, "right"), at(filter, "in")),
    line(at(bv13, "right"), at(feeFeedTank, "bottom")),
    line(at(feeFeedTank, "bottom"), at(bv14, "left")),
    line(at(bv14, "right"), at(cid2Feed, "suction")),
    line(at(cid2Feed, "discharge"), at(hxEvap, "left")),
    line(at(hxEvap, "right"), at(evaporator, "top")),
    line(at(evaporator, "bottom"), at(cid2Evap, "suction")),
    line(at(evaporator, "side"), at(midVessel, "left")),
    line(at(midVessel, "right"), at(condenser, "inlet")),
    line(at(condenser, "outlet"), at(cid2Condenser, "suction")),
  ];

  return {
    nodes,
    edges,
    viewport: { width: 1800, height: 1180 },
    sheet: ethanolSheet(),
  };
}

export const ETHANOL_EXTRACTION_TEMPLATE: DiagramTemplate = {
  id: "ethanol-extraction",
  name: "Ethanol Extraction System",
  description:
    "Full ethanol/hydrocarbon extraction line — holding & chilling tanks, AODP pumps, centrifuge, filter, evaporator and condenser, wired with ball valves.",
  diagramName: "Ethanol Extraction System P&ID",
  buildModel,
};
