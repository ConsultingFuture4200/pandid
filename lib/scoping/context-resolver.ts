/**
 * MCP `ContextResolver` adapter for account → active-diagram scoping (DEV-1149).
 *
 * The MCP server (DEV-1145) takes a `ContextResolver`:
 *   `(request) => Promise<TransportContext | null>`
 * and ships a deny-by-default one. This module builds the REAL resolver from the
 * scoping service, so once the OAuth chain (DEV-1147/1148) supplies a token
 * extractor + a token→account `AccountResolver`, the server resolves
 * `{ accountId, activeDiagramId }` for each `tools/call` with no change to the
 * server's dispatch logic.
 *
 * The connector bearer token lives on the HTTP `Authorization` header, which the
 * JSON-RPC request body does not carry — so the token EXTRACTOR is injected by
 * the route/OAuth layer (DEV-1147/1148), not invented here. This module owns
 * only the token → context resolution and the deny mapping.
 *
 * Deny mapping: a `ContextResolver` returns `null` to mean "no usable context,
 * refuse the call". Both `unauthorized` (no account behind the token) and
 * `no-active-diagram` (account has nothing selected) map to `null` here — the
 * MCP server then emits its single deny response. Unexpected errors propagate so
 * a real server fault is not silently masked as a deny.
 */
import type { JsonRpcRequest } from "@/lib/claude-transport/mcp";
import { ScopingError, type TransportContext } from "./types";
import type { ScopingService } from "./service";

/**
 * Extracts the connector bearer token for a JSON-RPC request, or null if none is
 * present. The implementation (reading the `Authorization` header) is owned by
 * the route/OAuth layer; scoping depends only on this function so the automatable
 * resolution is decoupled from the human-gated OAuth wiring.
 */
export type TokenExtractor = (request: JsonRpcRequest) => string | null;

/**
 * Build the MCP `ContextResolver` that resolves a request's connector token to
 * the account-scoped `TransportContext`. Returns `null` (deny) when the token is
 * missing, unknown, or the account has no active diagram.
 */
export function createScopingContextResolver(
  service: ScopingService,
  extractToken: TokenExtractor,
): (request: JsonRpcRequest) => Promise<TransportContext | null> {
  return async (request) => {
    const token = extractToken(request);
    if (token === null || token.length === 0) {
      return null;
    }
    try {
      return await service.resolveContext(token);
    } catch (error) {
      if (error instanceof ScopingError) {
        // unauthorized / no-active-diagram are both "refuse this call" → null.
        return null;
      }
      throw error;
    }
  };
}
