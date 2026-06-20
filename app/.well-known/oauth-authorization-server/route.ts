/**
 * Authorization Server Metadata endpoint (DEV-1147, FR-21; RFC 8414).
 *
 * GET /.well-known/oauth-authorization-server — Claude Desktop reads this to
 * discover the authorize/token endpoints, the grant types, and the required
 * PKCE method before starting the connector OAuth flow. Public, cacheable
 * (it's static per origin), no auth.
 */
import {
  authorizationServerMetadata,
  originFromRequest,
} from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const metadata = authorizationServerMetadata(originFromRequest(request));
  return Response.json(metadata, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
