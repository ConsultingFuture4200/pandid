/**
 * OAuth Dynamic Client Registration endpoint (DEV-1148 / 15b, FR-21, PRD §5.6).
 *
 * RFC 7591 §3.1: a public `POST /oauth/register` that accepts client metadata
 * and returns issued client credentials. Claude Desktop's custom connector
 * calls this during connector add — from Anthropic's cloud, NOT localhost
 * (CLAUDE.md critical fact #3), so it must be public-internet HTTPS.
 *
 * This owns HTTP framing only; the registration logic + validation live in
 * `lib/oauth` (DcrService). The companion token endpoint (DEV-1147) consumes
 * `DcrService.assertClientValid` and returns 401 invalid_client to trigger
 * re-registration; that endpoint is not owned here.
 */
import { OAuthError, getDcrService } from "@/lib/oauth";

/**
 * Custom connectors call this from Anthropic's cloud, so it runs on the Node.js
 * runtime (public HTTPS) and is never statically cached — every registration is
 * a live credential-minting turn.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handle a Dynamic Client Registration request (RFC 7591 §3.1).
 *
 *   - Body must be a JSON object of client metadata (else invalid_client_metadata).
 *   - On success: HTTP 201 with the registration response (client_id, and
 *     client_secret for confidential clients — returned exactly once).
 *   - On invalid metadata: the RFC 7591 §3.2.2 error body, HTTP 400.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthErrorResponse(
      new OAuthError(
        "invalid_client_metadata",
        "Request body is not valid JSON. Send a JSON object of client " +
          "metadata (RFC 7591), including redirect_uris.",
        400,
      ),
    );
  }

  try {
    const registration = await getDcrService().register(body);
    // RFC 7591 §3.2.1: a successful registration returns 201 Created.
    return new Response(JSON.stringify(registration), {
      status: 201,
      headers: {
        "content-type": "application/json",
        // Registration responses carry credentials; never let a cache hold them.
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    });
  } catch (err) {
    if (err instanceof OAuthError) {
      return oauthErrorResponse(err);
    }
    throw err;
  }
}

/**
 * Render an {@link OAuthError} as an RFC-shaped JSON error body
 * (`{error, error_description}`) at its HTTP status. The 401 invalid_client case
 * additionally sets `WWW-Authenticate` per RFC 6749 §5.2 — the wire signal a
 * DCR client reads to decide to re-register.
 */
function oauthErrorResponse(err: OAuthError): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (err.code === "invalid_client") {
    headers["WWW-Authenticate"] =
      `Bearer error="invalid_client", error_description="${err.message}"`;
  }
  return new Response(
    JSON.stringify({ error: err.code, error_description: err.message }),
    { status: err.httpStatus, headers },
  );
}
