/**
 * Protected Resource Metadata endpoint (DEV-1147, FR-21; RFC 9728).
 *
 * GET /.well-known/oauth-protected-resource — names the authorization server
 * that protects the MCP resource (/api/mcp). The MCP authorization discovery
 * flow follows this pointer from the resource's 401 to the auth server's own
 * metadata. Public, cacheable, no auth.
 */
import {
  originFromRequest,
  protectedResourceMetadata,
} from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const metadata = protectedResourceMetadata(originFromRequest(request));
  return Response.json(metadata, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
