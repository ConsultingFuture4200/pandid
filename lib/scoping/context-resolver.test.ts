/**
 * MCP ContextResolver adapter tests (DEV-1149).
 *
 * Proves the seam the MCP server (DEV-1145) plugs into: a request's connector
 * token resolves to `{ accountId, activeDiagramId }`, and an unresolvable token
 * / no-active-diagram denies (returns null) so the server emits its deny
 * response. Also proves the "switching active diagram redirects the tool target"
 * acceptance end-to-end through the resolver the server actually calls.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { JsonRpcRequest } from "@/lib/claude-transport/mcp";
import {
  DiagramService,
  InMemoryDiagramRepository,
} from "@/lib/diagram";
import { InMemoryScopingRepository } from "./in-memory-repository";
import { ScopingService } from "./service";
import { createScopingContextResolver } from "./context-resolver";
import type { AccountResolver } from "./types";

const ACCOUNT_A = "11111111-1111-1111-1111-111111111111";

function tokenResolver(map: Record<string, string>): AccountResolver {
  return { async resolveAccount(t: string) { return map[t] ?? null; } };
}

/** A tools/call request whose token is carried in params for the test extractor. */
function call(token: string | null): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: token === null ? {} : { _token: token },
  };
}

const extractToken = (req: JsonRpcRequest): string | null => {
  const params = req.params;
  if (params === undefined || Array.isArray(params)) return null;
  const token = params["_token"];
  return typeof token === "string" ? token : null;
};

describe("createScopingContextResolver", () => {
  let diagrams: DiagramService;
  let service: ScopingService;
  let resolve: (req: JsonRpcRequest) => Promise<unknown>;

  beforeEach(() => {
    const diagramRepo = new InMemoryDiagramRepository();
    diagrams = new DiagramService(diagramRepo);
    const scopingRepo = new InMemoryScopingRepository(diagramRepo);
    service = new ScopingService(
      scopingRepo,
      diagrams,
      tokenResolver({ "tok-a": ACCOUNT_A }),
    );
    resolve = createScopingContextResolver(service, extractToken);
  });

  it("resolves a request's token to the account's active-diagram context", async () => {
    const diagram = await diagrams.create({ accountId: ACCOUNT_A, name: "P&ID" });
    await service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: diagram.id });

    await expect(resolve(call("tok-a"))).resolves.toEqual({
      accountId: ACCOUNT_A,
      activeDiagramId: diagram.id,
    });
  });

  it("denies (null) when no token is present", async () => {
    await expect(resolve(call(null))).resolves.toBeNull();
  });

  it("denies (null) for an unknown token", async () => {
    await expect(resolve(call("bogus"))).resolves.toBeNull();
  });

  it("denies (null) when the account has no active diagram", async () => {
    await expect(resolve(call("tok-a"))).resolves.toBeNull();
  });

  it("redirects the resolved target after a web-side rebind", async () => {
    const first = await diagrams.create({ accountId: ACCOUNT_A, name: "First" });
    const second = await diagrams.create({ accountId: ACCOUNT_A, name: "Second" });

    await service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: first.id });
    await expect(resolve(call("tok-a"))).resolves.toMatchObject({
      activeDiagramId: first.id,
    });

    await service.setActiveDiagram({ accountId: ACCOUNT_A, diagramId: second.id });
    await expect(resolve(call("tok-a"))).resolves.toMatchObject({
      activeDiagramId: second.id,
    });
  });

  it("propagates unexpected (non-scoping) errors instead of masking them as deny", async () => {
    const exploding: AccountResolver = {
      async resolveAccount() {
        throw new Error("token store unreachable");
      },
    };
    const svc = new ScopingService(
      new InMemoryScopingRepository(new InMemoryDiagramRepository()),
      diagrams,
      exploding,
    );
    const r = createScopingContextResolver(svc, extractToken);
    await expect(r(call("tok-a"))).rejects.toThrow("token store unreachable");
  });
});
