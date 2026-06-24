/**
 * Create-diagram action tests (PRD §2.2 / §3).
 *
 * Exercises the injectable core of the create flow (`createDiagramWith`) over
 * in-memory diagram + scoping services — no session cookie, no DB. Covers:
 *   - creates a diagram (with an initial immutable version) and makes it active;
 *   - the account always comes from the session user, never the form;
 *   - an empty / whitespace name is rejected without creating anything.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DiagramService,
  InMemoryDiagramRepository,
  type DiagramRepository,
} from "@/lib/diagram";
import {
  InMemoryScopingRepository,
  ScopingService,
} from "@/lib/scoping";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { snapshotToPlacementModel } from "@/components/canvas/placement-model";
import {
  createDiagramFromTemplateWith,
  createDiagramWith,
} from "./diagram-actions";

const ACCOUNT = "11111111-1111-1111-1111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-2222-2222-222222222222";

interface Harness {
  diagramRepo: DiagramRepository;
  diagrams: DiagramService;
  scoping: ScopingService;
}

function makeHarness(): Harness {
  const diagramRepo = new InMemoryDiagramRepository();
  const diagrams = new DiagramService(diagramRepo);
  const scopingRepo = new InMemoryScopingRepository(diagramRepo);
  const scoping = new ScopingService(scopingRepo, diagrams);
  return { diagramRepo, diagrams, scoping };
}

function userFor(accountId: string): AuthenticatedUser {
  return { accountId, email: "user@example.com" };
}

describe("createDiagramWith", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("creates a diagram with an initial version and sets it active", async () => {
    const result = await createDiagramWith(
      { user: userFor(ACCOUNT), diagrams: h.diagrams, scoping: h.scoping },
      "Rig A",
    );
    expect(result.error).toBeUndefined();

    const list = await h.diagrams.list(ACCOUNT);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Rig A");

    // Initial immutable version was seeded.
    const opened = await h.diagrams.open({
      accountId: ACCOUNT,
      diagramId: list[0].id,
    });
    expect(opened.versions).toHaveLength(1);

    // It became the account's active diagram.
    const active = await h.scoping.getActiveDiagram(ACCOUNT);
    expect(active?.id).toBe(list[0].id);
  });

  it("scopes the new diagram to the session account, not another account", async () => {
    await createDiagramWith(
      { user: userFor(ACCOUNT), diagrams: h.diagrams, scoping: h.scoping },
      "Mine",
    );

    expect(await h.diagrams.list(ACCOUNT)).toHaveLength(1);
    expect(await h.diagrams.list(OTHER_ACCOUNT)).toHaveLength(0);
    expect(await h.scoping.getActiveDiagram(OTHER_ACCOUNT)).toBeNull();
  });

  it("trims the name before persisting", async () => {
    await createDiagramWith(
      { user: userFor(ACCOUNT), diagrams: h.diagrams, scoping: h.scoping },
      "  Padded  ",
    );
    const list = await h.diagrams.list(ACCOUNT);
    expect(list[0].name).toBe("Padded");
  });

  it("rejects an empty / whitespace name without creating anything", async () => {
    for (const name of ["", "   "]) {
      const result = await createDiagramWith(
        { user: userFor(ACCOUNT), diagrams: h.diagrams, scoping: h.scoping },
        name,
      );
      expect(result.error).toBeDefined();
    }
    expect(await h.diagrams.list(ACCOUNT)).toHaveLength(0);
    expect(await h.scoping.getActiveDiagram(ACCOUNT)).toBeNull();
  });
});

describe("createDiagramFromTemplateWith", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("seeds a new active diagram from the template's model", async () => {
    const result = await createDiagramFromTemplateWith(
      { user: userFor(ACCOUNT), diagrams: h.diagrams, scoping: h.scoping },
      "ethanol-extraction",
    );
    expect(result.error).toBeUndefined();

    const list = await h.diagrams.list(ACCOUNT);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Ethanol Extraction System P&ID");

    // The seeded version carries the template's geometry (not an empty scene).
    const opened = await h.diagrams.open({
      accountId: ACCOUNT,
      diagramId: list[0].id,
    });
    const snapshot = await h.diagrams.restoreVersion({
      accountId: ACCOUNT,
      diagramId: list[0].id,
      versionId: opened.versions[0].id,
    });
    const model = snapshotToPlacementModel(snapshot);
    expect(model.nodes.length).toBeGreaterThanOrEqual(33);
    expect(model.edges.length).toBeGreaterThanOrEqual(25);
    expect(model.sheet?.title).toBe("ETHANOL EXTRACTION SYSTEM P&ID");

    // It became the account's active diagram.
    const active = await h.scoping.getActiveDiagram(ACCOUNT);
    expect(active?.id).toBe(list[0].id);
  });

  it("returns an error for an unknown template without creating anything", async () => {
    const result = await createDiagramFromTemplateWith(
      { user: userFor(ACCOUNT), diagrams: h.diagrams, scoping: h.scoping },
      "does-not-exist",
    );
    expect(result.error).toBeDefined();
    expect(await h.diagrams.list(ACCOUNT)).toHaveLength(0);
    expect(await h.scoping.getActiveDiagram(ACCOUNT)).toBeNull();
  });
});
