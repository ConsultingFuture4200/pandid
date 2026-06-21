/**
 * Production context-resolver tests (DEV-1145 auth seam → DEV-1147/1149).
 *
 * The resolver is the live server's `ContextResolver`: it maps a request's HTTP
 * `Authorization` header to the account-scoped `TransportContext`. These tests
 * exercise the full chain header → bearer token → account → active diagram with
 * a real `ScopingService` over in-memory diagram/scoping repos and a fake
 * token→account resolver standing in for the OAuth chain (mirrors the scoping
 * service tests). The deny cases (missing/invalid token, no active diagram) all
 * resolve to `null`, the single "refuse this call" signal the server acts on.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  DiagramService,
  InMemoryDiagramRepository,
  type DiagramRepository,
} from "@/lib/diagram";
import {
  InMemoryScopingRepository,
  ScopingService,
  type AccountResolver,
} from "@/lib/scoping";
import { OAuthService, InMemoryOAuthRepository } from "@/lib/mcp-oauth";
import { createProductionContextResolver } from "./production-resolver";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";

/** A token → account map standing in for the OAuth chain (DEV-1147/1148). */
function tokenResolver(map: Record<string, string>): AccountResolver {
  return {
    async resolveAccount(token: string) {
      return map[token] ?? null;
    },
  };
}

interface Harness {
  diagrams: DiagramService;
  scoping: ScopingService;
}

function makeHarness(accounts: AccountResolver): Harness {
  const diagramRepo: DiagramRepository = new InMemoryDiagramRepository();
  const diagrams = new DiagramService(diagramRepo);
  const scopingRepo = new InMemoryScopingRepository(diagramRepo);
  const scoping = new ScopingService(scopingRepo, diagrams, accounts);
  return { diagrams, scoping };
}

/** A throwaway OAuth service for the (unused-when-scoping-injected) first arg. */
function dummyOAuth(): OAuthService {
  return new OAuthService(new InMemoryOAuthRepository());
}

describe("createProductionContextResolver", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness(tokenResolver({ "tok-a": ACCOUNT_A }));
  });

  it("resolves a valid Bearer header to the account's active-diagram context", async () => {
    const diagram = await h.diagrams.create({ accountId: ACCOUNT_A, name: "P&ID 1" });
    await h.scoping.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: diagram.id });

    const resolve = createProductionContextResolver(dummyOAuth(), h.scoping);
    const context = await resolve({
      request: { jsonrpc: "2.0", id: 1, method: "tools/call" },
      authorization: "Bearer tok-a",
    });
    expect(context).toEqual({ accountId: ACCOUNT_A, activeDiagramId: diagram.id });
  });

  it("denies a missing or non-Bearer Authorization header", async () => {
    const resolve = createProductionContextResolver(dummyOAuth(), h.scoping);
    expect(
      await resolve({ request: { jsonrpc: "2.0", id: 1, method: "tools/call" }, authorization: null }),
    ).toBeNull();
    expect(
      await resolve({
        request: { jsonrpc: "2.0", id: 1, method: "tools/call" },
        authorization: "Basic tok-a",
      }),
    ).toBeNull();
  });

  it("denies an unknown bearer token (unauthorized → null)", async () => {
    const resolve = createProductionContextResolver(dummyOAuth(), h.scoping);
    const context = await resolve({
      request: { jsonrpc: "2.0", id: 1, method: "tools/call" },
      authorization: "Bearer nope",
    });
    expect(context).toBeNull();
  });

  it("denies when the account has no active diagram (no-active-diagram → null)", async () => {
    // Token resolves to ACCOUNT_A, but nothing is active for it.
    const resolve = createProductionContextResolver(dummyOAuth(), h.scoping);
    const context = await resolve({
      request: { jsonrpc: "2.0", id: 1, method: "tools/call" },
      authorization: "Bearer tok-a",
    });
    expect(context).toBeNull();
  });
});
