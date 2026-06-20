/**
 * OAuth discovery metadata (DEV-1147, FR-21).
 *
 * The documents Claude Desktop reads to discover how to authenticate the custom
 * connector, before it ever hits /authorize:
 *
 *   - Authorization Server Metadata (RFC 8414) — advertises the authorize/token
 *     endpoints, supported grant types, and the PKCE method this provider
 *     requires.
 *   - Protected Resource Metadata (RFC 9728) — tells the client which
 *     authorization server protects the MCP resource (/api/mcp). This is the
 *     pointer the spec's discovery flow follows from the 401 on the resource.
 *
 * The `registration_endpoint` is advertised but **implemented by DEV-1148**
 * (Dynamic Client Registration). This module only names it so discovery is
 * complete; it does not register clients.
 *
 * Built relative to a request origin so the same code serves any deployment
 * host (the connector calls the public HTTPS origin — CLAUDE.md fact #3).
 */
import { CODE_CHALLENGE_METHOD, MCP_OAUTH_SCOPE } from "./types";

/** Path of the MCP resource these documents protect. */
const MCP_RESOURCE_PATH = "/api/mcp";

/** RFC 8414 Authorization Server Metadata document. */
export interface AuthorizationServerMetadata {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  /** DCR endpoint — owned by DEV-1148; advertised here for discovery. */
  readonly registration_endpoint: string;
  readonly response_types_supported: readonly string[];
  readonly grant_types_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported: readonly string[];
  readonly scopes_supported: readonly string[];
}

/** RFC 9728 Protected Resource Metadata document. */
export interface ProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly bearer_methods_supported: readonly string[];
}

/** Build the Authorization Server Metadata for a given origin. */
export function authorizationServerMetadata(
  origin: string,
): AuthorizationServerMetadata {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: [CODE_CHALLENGE_METHOD],
    // Public client + PKCE: no client authentication at the token endpoint.
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_OAUTH_SCOPE],
  };
}

/** Build the Protected Resource Metadata for a given origin. */
export function protectedResourceMetadata(
  origin: string,
): ProtectedResourceMetadata {
  return {
    resource: `${origin}${MCP_RESOURCE_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [MCP_OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
  };
}

/** Derive the public origin from an incoming request URL. */
export function originFromRequest(request: Request): string {
  return new URL(request.url).origin;
}
