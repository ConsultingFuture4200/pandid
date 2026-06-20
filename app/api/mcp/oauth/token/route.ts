/**
 * OAuth token endpoint (DEV-1147, FR-21).
 *
 * POST /api/mcp/oauth/token — the back-channel endpoint Claude Desktop's
 * connector calls (from Anthropic's cloud) to redeem an authorization code for
 * an account-scoped access + refresh token, and later to refresh it. RFC 6749
 * §4.1.3 (authorization_code) and §6 (refresh_token).
 *
 * Public client (no client secret): security comes from PKCE on the code
 * exchange (OAuth 2.1 / MCP 2025-11-25), not a shared secret. The body is
 * `application/x-www-form-urlencoded` per the spec.
 *
 * Returns the RFC 6749 §5.1 token response on success, or a §5.2 error body
 * (with the right status) on failure. `no-store` on every response — tokens
 * must never be cached.
 */
import {
  getOAuthService,
  OAuthError,
  tokenRequestSchema,
} from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const form = await readForm(request);
  if (form === null) {
    return errorJson(
      "invalid_request",
      "The token request body must be application/x-www-form-urlencoded.",
      400,
    );
  }

  const parsed = tokenRequestSchema.safeParse(form);
  if (!parsed.success) {
    // Distinguish an unknown grant_type (RFC 6749 §5.2 unsupported_grant_type)
    // from a malformed body of a supported grant.
    const grant = form["grant_type"];
    const isKnownGrant =
      grant === "authorization_code" || grant === "refresh_token";
    return errorJson(
      isKnownGrant ? "invalid_request" : "unsupported_grant_type",
      isKnownGrant
        ? "The token request is missing required fields for its grant_type."
        : "Unsupported grant_type. This server supports authorization_code and " +
            "refresh_token.",
      400,
    );
  }

  try {
    const tokens = await getOAuthService().exchangeToken(parsed.data);
    return Response.json(tokens, {
      status: 200,
      headers: { "cache-control": "no-store", pragma: "no-cache" },
    });
  } catch (err) {
    if (err instanceof OAuthError) {
      const status = err.code === "invalid_client" ? 401 : 400;
      return errorJson(err.code, err.message, status);
    }
    throw err;
  }
}

/** Parse the form-encoded body into a flat string map, or null if not a form. */
async function readForm(
  request: Request,
): Promise<Record<string, string> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return null;
  }
  const body = await request.text();
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    out[key] = value;
  }
  return out;
}

/** RFC 6749 §5.2 error response. */
function errorJson(error: string, description: string, status: number): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "cache-control": "no-store", pragma: "no-cache" } },
  );
}
