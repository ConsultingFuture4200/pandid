/**
 * Tests for the Claude-transport seam (DEV-1143, PRD §9).
 *
 * These lock the seam's contract — the cheap insurance against the #1 platform
 * risk. They assert:
 *   1. Any conforming transport (here a fake "mcp" and a fake "api-key-chat")
 *      satisfies the SAME `ClaudeTransport` interface — so the fallback is
 *      additive, not a rewrite.
 *   2. The registry resolves the active transport without callers knowing the
 *      mechanism, and the `activate` lever switches Path C → Path B.
 *   3. The seam is propose-only: `propose` stages a pending proposal or reports
 *      a validator refusal, and NEVER commits. (One committer; proposals staged
 *      never applied.)
 *   4. The payload schemas accept well-formed values and reject malformed ones.
 */
import { describe, expect, it } from "vitest";
import { TransportRegistry } from "./registry";
import {
  TransportError,
  diagramViewSchema,
  proposeResultSchema,
  transportKindSchema,
  type ClaudeTransport,
  type Proposal,
  type ProposedChange,
  type ProposeResult,
  type TransportContext,
  type TransportKind,
} from "./types";

const CONTEXT: TransportContext = {
  accountId: "11111111-1111-4111-8111-111111111111",
  activeDiagramId: "22222222-2222-4222-8222-222222222222",
};

function pendingProposal(): Proposal {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    diagramId: CONTEXT.activeDiagramId,
    stagedChange: { op: "add-element", equipmentType: "crc-column" },
    validatorReport: { valid: true, errors: [] },
    status: "pending",
    createdAt: "2026-06-20T00:00:00.000Z",
  };
}

/**
 * A minimal in-memory transport used to prove the interface is implementable by
 * more than one mechanism. `kind` is parameterized so the same fake stands in
 * for both Path C (`mcp`) and the §9 fallback (`api-key-chat`).
 */
class FakeTransport implements ClaudeTransport {
  readonly kind: TransportKind;
  readonly proposeResult: ProposeResult;

  constructor(kind: TransportKind, proposeResult: ProposeResult) {
    this.kind = kind;
    this.proposeResult = proposeResult;
  }

  async getActiveDiagram(context: TransportContext) {
    expect(context).toEqual(CONTEXT);
    return { state: { elements: [] }, svg: "<svg/>" };
  }

  async propose(
    context: TransportContext,
    change: ProposedChange,
  ): Promise<ProposeResult> {
    expect(context).toEqual(CONTEXT);
    expect(change).toBeTypeOf("object");
    return this.proposeResult;
  }
}

describe("ClaudeTransport interface", () => {
  it("is propose-only: the seam exposes no commit/apply/accept method", () => {
    // The one-committer invariant is structural — a transport simply cannot
    // commit because the interface gives it no method to. Assert the surface.
    const transport: ClaudeTransport = new FakeTransport(
      "mcp",
      { status: "staged", proposal: pendingProposal() },
    );
    const surface = Object.getOwnPropertyNames(
      Object.getPrototypeOf(transport),
    ).filter((n) => n !== "constructor");
    expect(surface.sort()).toEqual(["getActiveDiagram", "propose"]);
    for (const forbidden of ["commit", "apply", "accept", "reject", "save"]) {
      expect(surface).not.toContain(forbidden);
    }
  });

  it("getActiveDiagram returns structured state + an SVG snapshot (FR-9)", async () => {
    const transport = new FakeTransport("mcp", {
      status: "staged",
      proposal: pendingProposal(),
    });
    const view = await transport.getActiveDiagram(CONTEXT);
    expect(diagramViewSchema.safeParse(view).success).toBe(true);
    expect(view.svg).toContain("<svg");
  });

  it("propose stages a PENDING proposal — never an accepted/applied one", async () => {
    const transport = new FakeTransport("mcp", {
      status: "staged",
      proposal: pendingProposal(),
    });
    const result = await transport.propose(CONTEXT, { op: "noop" });
    expect(result.status).toBe("staged");
    if (result.status === "staged") {
      // Proposals are staged, never applied: status must be pending.
      expect(result.proposal.status).toBe("pending");
    }
  });

  it("propose returns a validator refusal as a result, not an exception (FR-8)", async () => {
    const report = {
      valid: false,
      errors: [{ code: "duplicate-tag", elementId: "e1", message: "dup" }],
    };
    const transport = new FakeTransport("mcp", {
      status: "rejected",
      validatorReport: report,
    });
    const result = await transport.propose(CONTEXT, { op: "bad" });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.validatorReport.valid).toBe(false);
    }
  });

  it("the same interface is satisfied by both Path C and the §9 fallback", () => {
    // Additive-not-rewrite: a Path B (api-key-chat) transport is assignable to
    // the exact same type the rest of the app consumes.
    const mcp: ClaudeTransport = new FakeTransport("mcp", {
      status: "staged",
      proposal: pendingProposal(),
    });
    const fallback: ClaudeTransport = new FakeTransport("api-key-chat", {
      status: "staged",
      proposal: pendingProposal(),
    });
    expect(mcp.kind).toBe("mcp");
    expect(fallback.kind).toBe("api-key-chat");
  });
});

describe("TransportRegistry", () => {
  it("resolves the active transport without the caller naming a mechanism", () => {
    const mcp = new FakeTransport("mcp", {
      status: "staged",
      proposal: pendingProposal(),
    });
    const registry = new TransportRegistry("mcp").register(mcp);
    expect(registry.active).toBe("mcp");
    expect(registry.getActiveTransport()).toBe(mcp);
  });

  it("activate flips Path C → Path B (the §9 kill-criterion lever)", () => {
    const mcp = new FakeTransport("mcp", {
      status: "staged",
      proposal: pendingProposal(),
    });
    const fallback = new FakeTransport("api-key-chat", {
      status: "staged",
      proposal: pendingProposal(),
    });
    const registry = new TransportRegistry("mcp")
      .register(mcp)
      .register(fallback);

    expect(registry.getActiveTransport()).toBe(mcp);
    registry.activate("api-key-chat");
    expect(registry.active).toBe("api-key-chat");
    // Callers re-resolve and transparently get the fallback — no caller change.
    expect(registry.getActiveTransport()).toBe(fallback);
  });

  it("refuses to activate an unregistered transport", () => {
    const registry = new TransportRegistry("mcp");
    expect(() => registry.activate("api-key-chat")).toThrowError(TransportError);
    expect(registry.has("api-key-chat")).toBe(false);
  });

  it("throws transport-unavailable when the active kind has no implementation", () => {
    const registry = new TransportRegistry("mcp");
    try {
      registry.getActiveTransport();
      throw new Error("expected getActiveTransport to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TransportError);
      expect((err as TransportError).code).toBe("transport-unavailable");
    }
  });

  it("re-registering a kind replaces the prior implementation", () => {
    const first = new FakeTransport("mcp", {
      status: "staged",
      proposal: pendingProposal(),
    });
    const second = new FakeTransport("mcp", {
      status: "rejected",
      validatorReport: { valid: false, errors: [] },
    });
    const registry = new TransportRegistry("mcp")
      .register(first)
      .register(second);
    expect(registry.getActiveTransport()).toBe(second);
  });
});

describe("transport payload schemas", () => {
  it("transportKindSchema accepts known kinds and rejects unknown ones", () => {
    expect(transportKindSchema.safeParse("mcp").success).toBe(true);
    expect(transportKindSchema.safeParse("api-key-chat").success).toBe(true);
    expect(transportKindSchema.safeParse("smtp").success).toBe(false);
  });

  it("proposeResultSchema validates both branches and rejects a bad shape", () => {
    expect(
      proposeResultSchema.safeParse({
        status: "staged",
        proposal: pendingProposal(),
      }).success,
    ).toBe(true);
    expect(
      proposeResultSchema.safeParse({
        status: "rejected",
        validatorReport: { valid: false, errors: [] },
      }).success,
    ).toBe(true);
    // A "staged" result missing its proposal is rejected by the discriminator.
    expect(
      proposeResultSchema.safeParse({ status: "staged" }).success,
    ).toBe(false);
  });

  it("diagramViewSchema requires both structured state and an svg string", () => {
    expect(
      diagramViewSchema.safeParse({ state: {}, svg: "<svg/>" }).success,
    ).toBe(true);
    expect(diagramViewSchema.safeParse({ state: {} }).success).toBe(false);
  });
});
