/**
 * Token endpoint route test — the DEV-1147/DEV-1148 integration seam (FR-21).
 *
 * Proves the 401 re-registration contract wired into the token route: the route
 * calls DCR's `assertClientValid` before issuing tokens, and surfaces an
 * unknown/revoked client as RFC 6749 §5.2 `invalid_client` (HTTP 401 +
 * `WWW-Authenticate`) — the signal Claude Desktop reacts to by re-registering.
 * It also confirms a registered client with a valid PKCE code still gets tokens.
 */
import { describe, expect, it } from "vitest";
import { getDcrService, getOAuthClientRepository } from "@/lib/oauth";
import {
  getOAuthRepository,
  getOAuthService,
  type InMemoryOAuthRepository,
} from "@/lib/mcp-oauth";
import { POST } from "./route";

const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const CODE_VERIFIER = "a".repeat(64); // valid PKCE verifier (43..128 chars)
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

function form(fields: Record<string, string>): Request {
  return new Request("https://app.example/api/mcp/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** Register a client via DCR and mint a provider auth code for it. */
async function registerAndAuthorize(): Promise<{ clientId: string; code: string }> {
  const reg = await getDcrService().register({
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
  });
  const clientId = reg.client_id;

  // The provider validates the code against its own repo; seed the same client
  // and mint a code bound to it (mirrors what /authorize does post web-login).
  const providerRepo = getOAuthRepository() as InMemoryOAuthRepository;
  providerRepo.seedClient({
    clientId,
    redirectUris: [REDIRECT_URI],
    createdAt: new Date().toISOString(),
  });
  const { code } = await getOAuthService().authorize(
    {
      responseType: "code",
      clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: await s256(CODE_VERIFIER),
      codeChallengeMethod: "S256",
    },
    ACCOUNT_ID,
  );
  return { clientId, code };
}

/** base64url(SHA-256(verifier)) — the PKCE challenge for CODE_VERIFIER. */
async function s256(verifier: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("POST /api/mcp/oauth/token — 401 invalid_client contract", () => {
  it("issues tokens for a registered client with a valid PKCE code", async () => {
    const { clientId, code } = await registerAndAuthorize();
    const res = await POST(
      form({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: CODE_VERIFIER,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; token_type: string };
    expect(body.token_type).toBe("Bearer");
    expect(body.access_token.length).toBeGreaterThan(0);
  });

  it("returns 401 invalid_client + WWW-Authenticate for an unregistered client", async () => {
    const res = await POST(
      form({
        grant_type: "authorization_code",
        code: "irrelevant-code",
        redirect_uri: REDIRECT_URI,
        client_id: "never-registered",
        code_verifier: CODE_VERIFIER,
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("invalid_client");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_client");
  });

  it("returns 401 invalid_client after the client is revoked (re-registration trigger)", async () => {
    const { clientId, code } = await registerAndAuthorize();
    await getDcrService().deleteClient(clientId);

    const res = await POST(
      form({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: CODE_VERIFIER,
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("invalid_client");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_client");
  });

  it("does not leak the in-memory client repo into a production guard", () => {
    // Sanity: dev/test resolve a repo; production would throw (covered elsewhere).
    expect(getOAuthClientRepository()).toBeTruthy();
  });
});
