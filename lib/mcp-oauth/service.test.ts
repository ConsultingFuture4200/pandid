/**
 * OAuth provider service tests (DEV-1147, FR-21).
 *
 * Covers the automatable half of this 🔴 human-gated task: authorization-code
 * issuance, PKCE-guarded token exchange, account-scoped token validation, and
 * refresh. The human-only half (Claude Desktop adding the connector and clicking
 * through the consent) is documented in docs/HUMAN-VERIFY-DEV-1147.md and cannot
 * be asserted here.
 */
import { describe, expect, it } from "vitest";
import { InMemoryOAuthRepository } from "./in-memory-repository";
import { OAuthService } from "./service";
import { computeS256Challenge } from "./tokens";
import { MCP_OAUTH_SCOPE, OAuthError, type AuthorizationRequest } from "./types";

const CLIENT_ID = "client-abc";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const CODE_VERIFIER = "a".repeat(64); // valid PKCE verifier (43..128 chars)

function baseAuthRequest(
  overrides: Partial<AuthorizationRequest> = {},
): AuthorizationRequest {
  return {
    responseType: "code",
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    codeChallenge: computeS256Challenge(CODE_VERIFIER),
    codeChallengeMethod: "S256",
    state: "xyz",
    scope: MCP_OAUTH_SCOPE,
    ...overrides,
  };
}

function newService(): { service: OAuthService; repo: InMemoryOAuthRepository } {
  const repo = new InMemoryOAuthRepository();
  repo.seedClient({
    clientId: CLIENT_ID,
    redirectUris: [REDIRECT_URI],
    createdAt: new Date().toISOString(),
  });
  return { service: new OAuthService(repo), repo };
}

describe("OAuthService.authorize", () => {
  it("issues an authorization code bound to the approving account", async () => {
    const { service } = newService();
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID);
    expect(code).toBeTypeOf("string");
    expect(code.length).toBeGreaterThan(0);
  });

  it("rejects an unknown client", async () => {
    const { service } = newService();
    await expect(
      service.authorize(baseAuthRequest({ clientId: "nope" }), ACCOUNT_ID),
    ).rejects.toMatchObject({ code: "invalid_client" });
  });

  it("rejects a redirect_uri not on the client allow-list", async () => {
    const { service } = newService();
    await expect(
      service.authorize(
        baseAuthRequest({ redirectUri: "https://evil.example/cb" }),
        ACCOUNT_ID,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects a scope other than the single mcp scope", async () => {
    const { service } = newService();
    await expect(
      service.authorize(baseAuthRequest({ scope: "admin" }), ACCOUNT_ID),
    ).rejects.toMatchObject({ code: "invalid_scope" });
  });
});

describe("OAuthService.exchangeToken (authorization_code + PKCE)", () => {
  it("exchanges a valid code+verifier for an account-scoped access token", async () => {
    const { service } = newService();
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID);

    const tokens = await service.exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: CODE_VERIFIER,
    });

    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.scope).toBe(MCP_OAUTH_SCOPE);
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.access_token).toBeTypeOf("string");
    expect(tokens.refresh_token).toBeTypeOf("string");

    const principal = await service.resolveAccessToken(tokens.access_token);
    expect(principal).not.toBeNull();
    expect(principal?.accountId).toBe(ACCOUNT_ID);
    expect(principal?.scope).toBe(MCP_OAUTH_SCOPE);
  });

  it("refuses the exchange when the PKCE verifier does not match", async () => {
    const { service } = newService();
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID);

    await expect(
      service.exchangeToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: "b".repeat(64), // wrong verifier
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("refuses a code redeemed against a different redirect_uri", async () => {
    const { service } = newService();
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID);

    await expect(
      service.exchangeToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://claude.ai/other",
        client_id: CLIENT_ID,
        code_verifier: CODE_VERIFIER,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("refuses a code redeemed by a different client_id", async () => {
    const { service, repo } = newService();
    repo.seedClient({
      clientId: "other-client",
      redirectUris: [REDIRECT_URI],
      createdAt: new Date().toISOString(),
    });
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID);

    await expect(
      service.exchangeToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: "other-client",
        code_verifier: CODE_VERIFIER,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("makes an authorization code single-use (replay fails)", async () => {
    const { service } = newService();
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID);
    const redeem = () =>
      service.exchangeToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: CODE_VERIFIER,
      });

    await redeem(); // first redemption succeeds
    await expect(redeem()).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects an expired authorization code", async () => {
    const { service } = newService();
    // Issue the code 10 minutes ago — past its 5-minute TTL.
    const past = new Date(Date.now() - 10 * 60_000);
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID, past);

    await expect(
      service.exchangeToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: CODE_VERIFIER,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

describe("OAuthService.resolveAccessToken (validation + account scoping)", () => {
  it("returns null for an unknown token", async () => {
    const { service } = newService();
    expect(await service.resolveAccessToken("not-a-real-token")).toBeNull();
  });

  it("returns null for an empty/absent token", async () => {
    const { service } = newService();
    expect(await service.resolveAccessToken(undefined)).toBeNull();
    expect(await service.resolveAccessToken("")).toBeNull();
  });

  it("returns null for an expired access token and prunes it", async () => {
    const { service, repo } = newService();
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID);
    const tokens = await service.exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: CODE_VERIFIER,
    });

    const future = new Date(Date.now() + ACCESS_TOKEN_TTL_PLUS);
    expect(await service.resolveAccessToken(tokens.access_token, future)).toBeNull();
    // pruned
    expect(await service.resolveAccessToken(tokens.access_token)).toBeNull();
    void repo;
  });

  it("refuses to resolve a refresh token as an access token", async () => {
    const { service } = newService();
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID);
    const tokens = await service.exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: CODE_VERIFIER,
    });
    // A refresh token must not authorize MCP tool calls.
    expect(await service.resolveAccessToken(tokens.refresh_token)).toBeNull();
  });

  it("scopes tokens per account — two accounts get distinct principals", async () => {
    const { service } = newService();
    const a = await issueAccessToken(service, ACCOUNT_ID);
    const b = await issueAccessToken(service, OTHER_ACCOUNT_ID);

    expect((await service.resolveAccessToken(a))?.accountId).toBe(ACCOUNT_ID);
    expect((await service.resolveAccessToken(b))?.accountId).toBe(OTHER_ACCOUNT_ID);
  });
});

describe("OAuthService.exchangeToken (refresh_token)", () => {
  it("issues a fresh access token from a refresh token, same account", async () => {
    const { service } = newService();
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID);
    const first = await service.exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: CODE_VERIFIER,
    });

    const refreshed = await service.exchangeToken({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: CLIENT_ID,
    });

    expect(refreshed.access_token).not.toBe(first.access_token);
    const principal = await service.resolveAccessToken(refreshed.access_token);
    expect(principal?.accountId).toBe(ACCOUNT_ID);
  });

  it("rejects a refresh token presented by a different client", async () => {
    const { service, repo } = newService();
    repo.seedClient({
      clientId: "other-client",
      redirectUris: [REDIRECT_URI],
      createdAt: new Date().toISOString(),
    });
    const { code } = await service.authorize(baseAuthRequest(), ACCOUNT_ID);
    const first = await service.exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: CODE_VERIFIER,
    });

    await expect(
      service.exchangeToken({
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
        client_id: "other-client",
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects an unknown refresh token", async () => {
    const { service } = newService();
    await expect(
      service.exchangeToken({
        grant_type: "refresh_token",
        refresh_token: "garbage",
        client_id: CLIENT_ID,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

// --- helpers ---------------------------------------------------------------

const ACCESS_TOKEN_TTL_PLUS = 1000 * 60 * 60 + 1000; // > access TTL

async function issueAccessToken(
  service: OAuthService,
  accountId: string,
): Promise<string> {
  const verifier = "z".repeat(64);
  const req: AuthorizationRequest = {
    responseType: "code",
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    codeChallenge: computeS256Challenge(verifier),
    codeChallengeMethod: "S256",
    scope: MCP_OAUTH_SCOPE,
  };
  const { code } = await service.authorize(req, accountId);
  const tokens = await service.exchangeToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  return tokens.access_token;
}

it("OAuthError carries the RFC error code", () => {
  const err = new OAuthError("invalid_grant", "bad");
  expect(err.code).toBe("invalid_grant");
  expect(err).toBeInstanceOf(Error);
});
