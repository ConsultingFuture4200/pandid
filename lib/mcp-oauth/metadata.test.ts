/**
 * Discovery metadata tests (DEV-1147, FR-21).
 *
 * Asserts the RFC 8414 / RFC 9728 documents advertise the right endpoints,
 * the required PKCE method, and the single mcp scope — the contract Claude
 * Desktop's discovery reads.
 */
import { describe, expect, it } from "vitest";
import {
  authorizationServerMetadata,
  originFromRequest,
  protectedResourceMetadata,
} from "./metadata";
import { CODE_CHALLENGE_METHOD, MCP_OAUTH_SCOPE } from "./types";

const ORIGIN = "https://pid.example.com";

describe("authorizationServerMetadata", () => {
  it("advertises authorize/token/register endpoints under the origin", () => {
    const m = authorizationServerMetadata(ORIGIN);
    expect(m.issuer).toBe(ORIGIN);
    expect(m.authorization_endpoint).toBe(`${ORIGIN}/api/mcp/oauth/authorize`);
    expect(m.token_endpoint).toBe(`${ORIGIN}/api/mcp/oauth/token`);
    // DCR endpoint advertised here; implemented by DEV-1148.
    expect(m.registration_endpoint).toBe(`${ORIGIN}/api/mcp/oauth/register`);
  });

  it("requires S256 PKCE and supports the auth-code + refresh grants", () => {
    const m = authorizationServerMetadata(ORIGIN);
    expect(m.code_challenge_methods_supported).toEqual([CODE_CHALLENGE_METHOD]);
    expect(m.grant_types_supported).toContain("authorization_code");
    expect(m.grant_types_supported).toContain("refresh_token");
    expect(m.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(m.scopes_supported).toEqual([MCP_OAUTH_SCOPE]);
  });
});

describe("protectedResourceMetadata", () => {
  it("points the MCP resource at this origin's auth server", () => {
    const m = protectedResourceMetadata(ORIGIN);
    expect(m.resource).toBe(`${ORIGIN}/api/mcp`);
    expect(m.authorization_servers).toEqual([ORIGIN]);
    expect(m.bearer_methods_supported).toEqual(["header"]);
  });
});

describe("originFromRequest", () => {
  it("derives the origin from a request URL", () => {
    const req = new Request("https://host.example/api/mcp/oauth/token?x=1");
    expect(originFromRequest(req)).toBe("https://host.example");
  });
});
