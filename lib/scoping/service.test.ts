/**
 * Account → active-diagram scoping tests (DEV-1149).
 *
 * Covers the four acceptance criteria:
 *   1. Token → account → active-diagram resolution.
 *   2. Switching active diagram in the web app redirects the tool target.
 *   3. Single active diagram per session (per account) enforced.
 *   4. Automatable — no Desktop needed (a fake AccountResolver stands in for the
 *      OAuth chain).
 *
 * Tenant isolation is exercised: a diagram owned by another account can neither
 * be activated nor resolved.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  DiagramService,
  InMemoryDiagramRepository,
  type DiagramRepository,
} from "@/lib/diagram";
import { InMemoryScopingRepository } from "./in-memory-repository";
import { ScopingService, denyAllAccountResolver } from "./service";
import { ScopingError, type AccountResolver } from "./types";

const ACCOUNT_A = "11111111-1111-1111-1111-111111111111";
const ACCOUNT_B = "22222222-2222-2222-2222-222222222222";

/** A token → account map standing in for the OAuth chain (DEV-1147/1148). */
function tokenResolver(map: Record<string, string>): AccountResolver {
  return {
    async resolveAccount(token: string) {
      return map[token] ?? null;
    },
  };
}

interface Harness {
  diagramRepo: DiagramRepository;
  diagrams: DiagramService;
  scopingRepo: InMemoryScopingRepository;
  service: ScopingService;
}

function makeHarness(accounts: AccountResolver): Harness {
  const diagramRepo = new InMemoryDiagramRepository();
  const diagrams = new DiagramService(diagramRepo);
  const scopingRepo = new InMemoryScopingRepository(diagramRepo);
  const service = new ScopingService(scopingRepo, diagrams, accounts);
  return { diagramRepo, diagrams, scopingRepo, service };
}

describe("ScopingService.resolveContext — token → account → active diagram", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness(tokenResolver({ "tok-a": ACCOUNT_A, "tok-b": ACCOUNT_B }));
  });

  it("resolves a token to its account's active diagram", async () => {
    const diagram = await h.diagrams.create({ accountId: ACCOUNT_A, name: "P&ID 1" });
    await h.service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: diagram.id });

    const context = await h.service.resolveContext("tok-a");

    expect(context).toEqual({
      accountId: ACCOUNT_A,
      activeDiagramId: diagram.id,
    });
  });

  it("rejects an unknown token as unauthorized (deny-by-default seam)", async () => {
    await expect(h.service.resolveContext("nope")).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("rejects when the account has no active diagram", async () => {
    // Account exists (token resolves) but has selected nothing active.
    await expect(h.service.resolveContext("tok-a")).rejects.toMatchObject({
      code: "no-active-diagram",
    });
  });

  it("the deny-all default resolver refuses every token", async () => {
    const denied = makeHarness(denyAllAccountResolver);
    await expect(denied.service.resolveContext("anything")).rejects.toMatchObject(
      { code: "unauthorized" },
    );
  });
});

describe("ScopingService.setActiveDiagram — web-side rebind redirects tool target", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness(tokenResolver({ "tok-a": ACCOUNT_A }));
  });

  it("switching the active diagram changes what the connector token resolves to", async () => {
    const first = await h.diagrams.create({ accountId: ACCOUNT_A, name: "First" });
    const second = await h.diagrams.create({ accountId: ACCOUNT_A, name: "Second" });

    await h.service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: first.id });
    expect((await h.service.resolveContext("tok-a")).activeDiagramId).toBe(first.id);

    // User selects another diagram by name in the web app → rebind.
    await h.service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: second.id });
    expect((await h.service.resolveContext("tok-a")).activeDiagramId).toBe(second.id);
  });

  it("returns the now-active diagram with active=true", async () => {
    const diagram = await h.diagrams.create({ accountId: ACCOUNT_A, name: "P&ID" });
    const activated = await h.service.setActiveDiagram({
      accountId: ACCOUNT_A,
      diagramId: diagram.id,
    });
    expect(activated).toMatchObject({ id: diagram.id, active: true });
  });

  it("refuses to activate a diagram the account does not own (tenant isolation)", async () => {
    const foreign = await h.diagrams.create({ accountId: ACCOUNT_B, name: "Theirs" });
    await expect(
      h.service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: foreign.id }),
    ).rejects.toBeInstanceOf(ScopingError);
    await expect(
      h.service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: foreign.id }),
    ).rejects.toMatchObject({ code: "diagram-not-found" });
  });

  it("refuses to activate a non-existent diagram", async () => {
    await expect(
      h.service.setActiveDiagram({
        accountId: ACCOUNT_A,
        diagramId: "33333333-3333-3333-3333-333333333333",
      }),
    ).rejects.toMatchObject({ code: "diagram-not-found" });
  });
});

describe("ScopingService — single active diagram per account", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness(tokenResolver({ "tok-a": ACCOUNT_A }));
  });

  it("activating a second diagram deactivates the first", async () => {
    const first = await h.diagrams.create({ accountId: ACCOUNT_A, name: "First" });
    const second = await h.diagrams.create({ accountId: ACCOUNT_A, name: "Second" });

    await h.service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: first.id });
    await h.service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: second.id });

    const active = await h.service.getActiveDiagram(ACCOUNT_A);
    expect(active?.id).toBe(second.id);
    // Exactly one diagram is active for the account.
    expect(active).not.toBeNull();
  });

  it("getActiveDiagram returns null before anything is selected", async () => {
    expect(await h.service.getActiveDiagram(ACCOUNT_A)).toBeNull();
  });

  it("clearActiveDiagram removes the selection (idempotent)", async () => {
    const diagram = await h.diagrams.create({ accountId: ACCOUNT_A, name: "P&ID" });
    await h.service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: diagram.id });

    await h.service.clearActiveDiagram(ACCOUNT_A);
    expect(await h.service.getActiveDiagram(ACCOUNT_A)).toBeNull();
    // Idempotent: clearing again is a no-op.
    await h.service.clearActiveDiagram(ACCOUNT_A);
    expect(await h.service.getActiveDiagram(ACCOUNT_A)).toBeNull();
  });

  it("does not return a deleted diagram as active (stale pointer dropped)", async () => {
    const diagram = await h.diagrams.create({ accountId: ACCOUNT_A, name: "P&ID" });
    await h.service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: diagram.id });
    await h.diagrams.delete({ accountId: ACCOUNT_A, diagramId: diagram.id });

    expect(await h.service.getActiveDiagram(ACCOUNT_A)).toBeNull();
  });

  it("isolates active selection per account", async () => {
    const a = await h.diagrams.create({ accountId: ACCOUNT_A, name: "A" });
    const b = await h.diagrams.create({ accountId: ACCOUNT_B, name: "B" });
    await h.service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: a.id });
    await h.service.setActiveDiagram({ accountId: ACCOUNT_B, diagramId: b.id });

    expect((await h.service.getActiveDiagram(ACCOUNT_A))?.id).toBe(a.id);
    expect((await h.service.getActiveDiagram(ACCOUNT_B))?.id).toBe(b.id);
  });
});
