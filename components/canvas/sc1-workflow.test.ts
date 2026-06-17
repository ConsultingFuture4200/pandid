// SC-1 manual-workflow tests (DEV-1141, Phase 1 exit gate).
//
// SC-1: "A user can draw a 4-column→header→collection-tank P&ID manually, save,
// reload." Two loop-closable proofs live here (the live-canvas build is the
// Playwright spec e2e/manual-workflow.spec.ts):
//
//   1. 🟡 golden SVG — the final diagram's geometry (every equipment body + every
//      bound process line) renders byte-stable and matches the committed golden.
//   2. save + reload round-trip — the SC-1 edit goes through the REAL commit
//      pipeline (validate → persist a new immutable version), and reloading the
//      persisted version returns an identical scene + intact metadata (one
//      committer; versions immutable — CLAUDE.md invariants).
//
// Together these prove the editor works end-to-end with NO Claude involvement.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createConnectivityValidator } from "@/lib/validator";
import { DiagramCommitPipeline } from "@/lib/diagram/commit";
import { DiagramService, InMemoryDiagramRepository } from "@/lib/diagram";
import { sc1WorkflowToSvg } from "./sc1-workflow-to-svg";
import { buildSc1Edit } from "./sc1-workflow-edit";
import { SC1_EQUIPMENT, SC1_CONNECTIONS } from "./sc1-workflow.fixture";

const goldenDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "golden",
);

function normalizeSvg(svg: string): string {
  return svg
    .replace(/\s+/g, " ")
    .replace(/-?\d+\.\d+/g, (m) => String(Math.round(Number(m))))
    .trim();
}

describe("SC-1 final diagram — golden SVG (🟡 visual diff)", () => {
  it("has the SC-1 topology: 4 columns + header + tank, 5 process lines", () => {
    // Guards the fixture against drift so the golden actually means "SC-1".
    const columns = SC1_EQUIPMENT.filter(
      (e) => e.placed.symbolId === "extraction-column",
    );
    expect(columns).toHaveLength(4);
    expect(SC1_EQUIPMENT).toHaveLength(6); // 4 columns + header + tank
    expect(SC1_CONNECTIONS).toHaveLength(5); // 4 into header + 1 to tank
  });

  it("renders the SC-1 scene matching its golden fixture", () => {
    const rendered = sc1WorkflowToSvg();
    const golden = readFileSync(join(goldenDir, "sc1-workflow.svg"), "utf8");
    expect(normalizeSvg(rendered)).toBe(normalizeSvg(golden));
  });
});

describe("SC-1 save + reload round-trip (one committer, immutable versions)", () => {
  const ACCOUNT = crypto.randomUUID();
  let service: DiagramService;
  let pipeline: DiagramCommitPipeline;
  let diagramId: string;

  beforeEach(async () => {
    const repo = new InMemoryDiagramRepository();
    service = new DiagramService(repo);
    pipeline = new DiagramCommitPipeline(service, createConnectivityValidator());
    const diagram = await service.create({
      accountId: ACCOUNT,
      name: "SC-1 rig",
    });
    diagramId = diagram.id;
  });

  it("commits the SC-1 diagram through the validator and persists a version", async () => {
    const result = await pipeline.commit({
      accountId: ACCOUNT,
      diagramId,
      edit: buildSc1Edit(),
    });

    // The valid SC-1 diagram passes the connectivity validator and lands.
    expect(result.report.valid).toBe(true);
    expect(result.snapshot.version.diagramId).toBe(diagramId);
    // Every equipment tag is preserved in the parallel metadata store.
    const tags = result.snapshot.metadata
      .map((m) => m.attributes.tag)
      .filter((t): t is string => typeof t === "string")
      .sort();
    expect(tags).toEqual([
      "EX-101",
      "EX-102",
      "EX-103",
      "EX-104",
      "HDR-1",
      "TK-101",
    ]);
  });

  it("reload returns an identical scene + intact metadata (SC-1 reload)", async () => {
    const committed = await pipeline.commit({
      accountId: ACCOUNT,
      diagramId,
      edit: buildSc1Edit(),
    });
    const versionId = committed.snapshot.version.id;

    // Reload exactly as the editor would: open the diagram, restore the version.
    const reopened = await service.open({ accountId: ACCOUNT, diagramId });
    expect(reopened.versions.map((v) => v.id)).toContain(versionId);

    const restored = await service.restoreVersion({
      accountId: ACCOUNT,
      diagramId,
      versionId,
    });

    // Scene is byte-identical to what was committed.
    expect(restored.version.excalidrawScene).toEqual(
      committed.snapshot.version.excalidrawScene,
    );
    // Metadata round-trips intact (element ids, types, attributes).
    expect(restored.metadata).toEqual(committed.snapshot.metadata);
  });
});
