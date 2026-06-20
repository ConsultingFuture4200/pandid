/**
 * OAuth authorization endpoint (DEV-1147, FR-21).
 *
 * GET /api/mcp/oauth/authorize — the browser endpoint Claude Desktop's custom
 * connector sends the human to (from Anthropic's cloud, via the user's browser)
 * to start the OAuth 2.0 authorization-code + PKCE flow whose authorization
 * server is this app.
 *
 * Flow:
 *   1. Parse + validate the authorization request (response_type=code, S256
 *      PKCE, registered client + redirect_uri).
 *   2. Require a logged-in WEB session (DEV-1134). If absent, redirect to
 *      /login?next=<this url> so the human signs in, then returns here. This is
 *      what makes the connector **account-scoped**: the code is bound to the
 *      account that completed web login (PRD §4).
 *   3. Mint a single-use code and 302 back to the connector's redirect_uri with
 *      `code` (+ echoed `state`).
 *
 * Consent in v1 is implicit on being the logged-in account owner: this is a
 * single-human-per-account product (PRD §1 "One human + Claude advisor per
 * diagram"), so there is no separate scope-grant screen. A richer consent UI is
 * additive and does not change this endpoint's contract.
 *
 * Errors that cannot be safely redirected (unknown client / bad redirect_uri)
 * are returned as JSON per RFC 6749 §4.1.2.1; errors that can be (e.g.
 * unsupported params for a known, allow-listed redirect) redirect with `error`.
 */
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  authorizationRequestSchema,
  getOAuthService,
  OAuthError,
  type AuthorizationRequest,
} from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Map the wire query (snake_case) onto the validated request shape.
  const parsed = authorizationRequestSchema.safeParse({
    responseType: params.get("response_type"),
    clientId: params.get("client_id"),
    redirectUri: params.get("redirect_uri"),
    codeChallenge: params.get("code_challenge"),
    codeChallengeMethod: params.get("code_challenge_method"),
    state: params.get("state") ?? undefined,
    scope: params.get("scope") ?? undefined,
  });
  if (!parsed.success) {
    // We cannot trust the redirect_uri until the client is validated, so a
    // malformed request is reported directly rather than redirected.
    return errorJson(
      "invalid_request",
      "The authorization request is missing or has invalid parameters. It must " +
        "be response_type=code with a registered client_id, redirect_uri, and " +
        "an S256 code_challenge.",
      400,
    );
  }
  const authRequest: AuthorizationRequest = parsed.data;

  const service = getOAuthService();

  // Require a logged-in web session. If absent, send the human to log in and
  // come back to this exact authorize URL (account-scoped pairing).
  const user = await getCurrentUser();
  if (user === null) {
    const next = `${url.pathname}${url.search}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  try {
    const result = await service.authorize(authRequest, user.accountId);
    const location = new URL(result.redirectUri);
    location.searchParams.set("code", result.code);
    if (result.state !== undefined) {
      location.searchParams.set("state", result.state);
    }
    return Response.redirect(location.toString(), 302);
  } catch (err) {
    if (err instanceof OAuthError) {
      // invalid_client / bad redirect_uri must NOT redirect (RFC 6749 §4.1.2.1)
      // — returning them to an unverified URI would be an open redirect.
      const status = err.code === "invalid_client" ? 401 : 400;
      return errorJson(err.code, err.message, status);
    }
    throw err;
  }
}

/** RFC 6749 §5.2-shaped error body (also used for §4.1.2.1 direct errors). */
function errorJson(error: string, description: string, status: number): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "cache-control": "no-store" } },
  );
}
