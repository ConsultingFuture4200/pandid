/**
 * Bearer-token resolution tests (DEV-1147, FR-21).
 *
 * The header-parsing + principal-resolution seam DEV-1145/1149 consume. The
 * issuance path is covered by service.test.ts; here we assert the header
 * parsing and the deny-by-default behavior for malformed/absent credentials.
 */
import { describe, expect, it } from "vitest";
import { InMemoryOAuthRepository } from "./in-memory-repository";
import { bearerTokenFromHeader, resolveOAuthPrincipal } from "./resolve-principal";
import { OAuthService } from "./service";
import { computeS256Challenge } from "./tokens";
import { MCP_OAUTH_SCOPE } from "./types";

describe("bearerTokenFromHeader", () => {
  it("extracts the token from a well-formed Bearer header", () => {
    expect(bearerTokenFromHeader("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive on the scheme", () => {
    expect(bearerTokenFromHeader("bearer abc123")).toBe("abc123");
    expect(bearerTokenFromHeader("BEARER abc123")).toBe("abc123");
  });

  it("returns null for absent or non-Bearer headers", () => {
    expect(bearerTokenFromHeader(null)).toBeNull();
    expect(bearerTokenFromHeader(undefined)).toBeNull();
    expect(bearerTokenFromHeader("")).toBeNull();
    expect(bearerTokenFromHeader("Basic abc123")).toBeNull();
    expect(bearerTokenFromHeader("Bearer ")).toBeNull();
    expect(bearerTokenFromHeader("Bearer    ")).toBeNull();
  });
});

describe("resolveOAuthPrincipal", () => {
  const CLIENT_ID = "client-abc";
  const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
  const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
  const VERIFIER = "v".repeat(64);

  async function issuedAccessToken(): Promise<{
    service: OAuthService;
    token: string;
  }> {
    const repo = new InMemoryOAuthRepository();
    repo.seedClient({
      clientId: CLIENT_ID,
      redirectUris: [REDIRECT_URI],
      createdAt: new Date().toISOString(),
    });
    const service = new OAuthService(repo);
    const { code } = await service.authorize(
      {
        responseType: "code",
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        codeChallenge: computeS256Challenge(VERIFIER),
        codeChallengeMethod: "S256",
        scope: MCP_OAUTH_SCOPE,
      },
      ACCOUNT_ID,
    );
    const tokens = await service.exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: VERIFIER,
    });
    return { service, token: tokens.access_token };
  }

  it("resolves a valid bearer header to the account principal", async () => {
    const { service, token } = await issuedAccessToken();
    const principal = await resolveOAuthPrincipal(service, `Bearer ${token}`);
    expect(principal?.accountId).toBe(ACCOUNT_ID);
  });

  it("denies a missing or malformed header", async () => {
    const { service } = await issuedAccessToken();
    expect(await resolveOAuthPrincipal(service, null)).toBeNull();
    expect(await resolveOAuthPrincipal(service, "Bearer not-a-token")).toBeNull();
  });
});
