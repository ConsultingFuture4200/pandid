/**
 * Bearer-token → account principal resolution (DEV-1147, FR-21).
 *
 * The bridge between an incoming MCP HTTP request and the account it acts as.
 * DEV-1145 owns the MCP server's `ContextResolver` seam and DEV-1149 resolves
 * account → active diagram; both build their `TransportContext` from the
 * principal this returns. Kept here (not in the MCP server file) so the OAuth
 * task does not edit another task's file — DEV-1149 imports and composes this.
 *
 * Per the MCP authorization spec (2025-11-25), the connector presents the
 * access token as an `Authorization: Bearer <token>` header on every request.
 */
import type { OAuthPrincipal } from "./types";
import type { OAuthService } from "./service";

const BEARER_PREFIX = "Bearer ";

/**
 * Extract the raw bearer token from an `Authorization` header value, or null if
 * the header is absent or not a well-formed `Bearer` credential. Case-insensitive
 * on the scheme name (RFC 7235 §2.1).
 */
export function bearerTokenFromHeader(
  authorization: string | null | undefined,
): string | null {
  if (!authorization) {
    return null;
  }
  if (authorization.length < BEARER_PREFIX.length) {
    return null;
  }
  const scheme = authorization.slice(0, BEARER_PREFIX.length);
  if (scheme.toLowerCase() !== BEARER_PREFIX.toLowerCase()) {
    return null;
  }
  const token = authorization.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolve the `Authorization` header of an MCP request to its account principal,
 * or null when there is no valid, unexpired access token. Deny-by-default: a
 * missing/garbage/expired token resolves to null and the caller refuses the
 * tool call (the MCP server's existing deny-by-default posture).
 */
export async function resolveOAuthPrincipal(
  service: OAuthService,
  authorization: string | null | undefined,
  now: Date = new Date(),
): Promise<OAuthPrincipal | null> {
  const token = bearerTokenFromHeader(authorization);
  if (token === null) {
    return null;
  }
  return service.resolveAccessToken(token, now);
}
