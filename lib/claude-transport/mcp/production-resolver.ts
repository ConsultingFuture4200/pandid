/**
 * The production MCP `ContextResolver`: bearer token → account → active diagram.
 *
 * This replaces the deny-by-default resolver on the live server path. It wires
 * the auth chain end-to-end, composing modules it only IMPORTS (it edits none):
 *
 *   1. The request's HTTP `Authorization` header carries the connector's bearer
 *      access token (MCP auth spec 2025-11-25). `bearerTokenFromHeader`
 *      (lib/mcp-oauth) extracts the raw token; a missing/garbage header ⇒ null.
 *   2. The OAuth service (`resolveAccessToken`, lib/mcp-oauth) validates the
 *      token and resolves it to an `accountId`; an unknown/expired token ⇒ null.
 *   3. The scoping service (`resolveContext`, lib/scoping) maps that account to
 *      its single ACTIVE diagram and returns `{ accountId, activeDiagramId }`.
 *      No active diagram ⇒ a `ScopingError`, which we map to null (deny).
 *
 * Returning `null` is the single "refuse this call" signal the MCP server acts
 * on (its deny response tells the user to sign in or pick an active diagram).
 * Both "no account behind the token" and "account has no active diagram" deny;
 * an unexpected fault propagates so a real server error is not masked as a deny.
 *
 * Account-scoping invariant (CLAUDE.md): the account is derived from the token,
 * never from the JSON-RPC body — a caller cannot name another account's diagram.
 */
import {
  bearerTokenFromHeader,
  getOAuthService,
  type OAuthService,
} from "@/lib/mcp-oauth";
import {
  ScopingError,
  getScopingService,
  type AccountResolver,
  type ScopingService,
} from "@/lib/scoping";
import type { TransportContext } from "../types";
import type { ContextResolver } from "./server";

/**
 * An {@link AccountResolver} backed by the OAuth service: the raw bearer token →
 * the account it is scoped to. This is the token→account seam the scoping
 * service (DEV-1149) is constructed with; the OAuth task (DEV-1147) owns the
 * validation, so this only adapts its principal to an `accountId`.
 */
function oauthAccountResolver(oauth: OAuthService): AccountResolver {
  return {
    async resolveAccount(token: string): Promise<string | null> {
      const principal = await oauth.resolveAccessToken(token);
      return principal?.accountId ?? null;
    },
  };
}

/**
 * Build the production context resolver. Defaults to the process-wide OAuth +
 * scoping services; tests inject fakes. The returned resolver is the real
 * `ContextResolver` the live server (`getMcpServer`) runs with.
 */
export function createProductionContextResolver(
  oauth: OAuthService = getOAuthService(),
  scoping: ScopingService = getScopingService(oauthAccountResolver(oauth)),
): ContextResolver {
  return async ({ authorization }) => {
    const token = bearerTokenFromHeader(authorization);
    if (token === null) {
      return null;
    }
    try {
      return await scoping.resolveContext(token);
    } catch (error) {
      if (error instanceof ScopingError) {
        // unauthorized / no-active-diagram both mean "refuse this call" → null.
        return null;
      }
      throw error;
    }
  };
}

/** Re-exported for the server wiring; keeps the import surface here. */
export type { TransportContext };
