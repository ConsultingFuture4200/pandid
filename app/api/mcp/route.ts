/**
 * MCP Streamable HTTP endpoint (DEV-1145, PRD §4 / FR-5).
 *
 * This is the public-internet HTTPS endpoint Claude Desktop's custom connector
 * calls — from Anthropic's cloud, NOT localhost (CLAUDE.md critical fact #3).
 * It owns HTTP framing only; the protocol lives in `lib/claude-transport/mcp`.
 *
 * Transport: Streamable HTTP, protocol 2025-11-25. A single POST accepts a
 * JSON-RPC request and returns a JSON-RPC response (or 202 for a notification).
 * SSE is deprecated and intentionally absent (CLAUDE.md stack constraints).
 *
 * Endpoints:
 *   - GET  /api/mcp        → health check: liveness + protocol version, no auth.
 *   - POST /api/mcp        → JSON-RPC message handling (initialize, ping,
 *                            tools/list, tools/call).
 *
 * Auth is NOT implemented here — the server ships a deny-by-default context
 * resolver, so `tools/call` is refused until the OAuth + DCR chain
 * (DEV-1147/1148) and active-diagram scoping (DEV-1149) land. The skeleton is
 * deliberately the transport + registry + handshake only; this is a 🔴
 * human-gated task whose final verification (a human adding the connector in
 * Claude Desktop) is documented in docs/HUMAN-VERIFY-DEV-1145.md.
 */
import {
  JSONRPC_VERSION,
  JsonRpcErrorCode,
  MCP_PROTOCOL_VERSION,
  getMcpServer,
  jsonRpcError,
  jsonRpcRequestSchema,
} from "@/lib/claude-transport/mcp";

/**
 * Custom connectors call this from Anthropic's cloud, so it must run on the
 * Node.js runtime (public HTTPS) and never be statically cached — every request
 * is a live JSON-RPC turn.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health check. Returns liveness, the server's role, and the MCP protocol
 * version — enough for an operator (or an uptime probe) to confirm the endpoint
 * is reachable and speaking the expected protocol revision, without performing
 * an MCP handshake. No auth: this is a public liveness signal, not a tool call.
 */
export function GET(): Response {
  return Response.json({
    status: "ok",
    service: "mcp",
    transport: "streamable-http",
    protocolVersion: MCP_PROTOCOL_VERSION,
  });
}

/**
 * Handle one JSON-RPC message over Streamable HTTP.
 *
 * Framing rules:
 *   - Body must be valid JSON (else JSON-RPC ParseError, HTTP 200 with error
 *     envelope — JSON-RPC carries failures in the body, not the HTTP status).
 *   - Body must be a valid JSON-RPC request object (else InvalidRequest).
 *   - A notification (no `id`) gets HTTP 202 with an empty body — no JSON-RPC
 *     response is defined for notifications.
 *   - Otherwise the response is the server's JSON-RPC response object.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Malformed JSON → JSON-RPC parse error. id is null per spec (we couldn't
    // read an id). HTTP 200: the error is reported in the JSON-RPC envelope.
    return jsonResponse(
      jsonRpcError(
        null,
        JsonRpcErrorCode.ParseError,
        "Request body is not valid JSON.",
      ),
    );
  }

  const parsed = jsonRpcRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      jsonRpcError(
        idFromUnknown(body),
        JsonRpcErrorCode.InvalidRequest,
        "Request is not a valid JSON-RPC 2.0 request object. Expected " +
          `{"jsonrpc": "${JSONRPC_VERSION}", "method": "...", ...}.`,
      ),
    );
  }

  const response = await getMcpServer().handle(parsed.data);
  if (response === null) {
    // Notification: acknowledged, no JSON-RPC response body.
    return new Response(null, { status: 202 });
  }
  return jsonResponse(response);
}

/** Serialize a JSON-RPC response as an HTTP 200 JSON body. */
function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Best-effort recovery of a JSON-RPC `id` from an unparsed body, so an
 * InvalidRequest error can echo the client's id when one is present. Returns
 * null when the body isn't an object or carries no usable id.
 */
function idFromUnknown(body: unknown): string | number | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const id = (body as Record<string, unknown>)["id"];
  return typeof id === "string" || typeof id === "number" ? id : null;
}
