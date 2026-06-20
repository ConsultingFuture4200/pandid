/**
 * MCP wire-protocol primitives (DEV-1145, PRD §4 / FR-5).
 *
 * The Model Context Protocol speaks JSON-RPC 2.0 over a Streamable HTTP
 * transport (protocol revision 2025-11-25). This module models *only* the wire
 * shapes and the framing rules — the JSON-RPC envelope, the protocol version,
 * the handshake/capability objects, and the error codes. It carries no app
 * logic and no knowledge of diagrams, proposals, or auth: those live behind the
 * `ClaudeTransport` seam (DEV-1143) and in downstream tasks (read tools
 * DEV-1146, propose tools DEV-1150, OAuth DEV-1147/1148).
 *
 * SSE is deprecated and deliberately NOT modeled here (CLAUDE.md stack
 * constraints). The skeleton speaks Streamable HTTP: a single POST endpoint
 * that accepts a JSON-RPC request and returns a JSON-RPC response.
 *
 * Zod-at-all-boundaries (CLAUDE.md): every inbound message is parsed by
 * `jsonRpcRequestSchema` before the server acts on it, so a malformed body is a
 * typed protocol error, never an unchecked access.
 */
import { z } from "zod";

/**
 * The MCP protocol revision this server implements. Streamable HTTP transport,
 * 2025-11-25 (CLAUDE.md). Returned to the client in the `initialize` result so
 * it can confirm a compatible version; a client may request an older revision,
 * which we echo back per the MCP version-negotiation rule.
 */
export const MCP_PROTOCOL_VERSION = "2025-11-25" as const;

/** JSON-RPC 2.0 version tag — the only value the `jsonrpc` field may hold. */
export const JSONRPC_VERSION = "2.0" as const;

/**
 * JSON-RPC 2.0 error codes the skeleton can emit. The negative codes are the
 * reserved JSON-RPC set (spec §5.1); they are what the server returns for
 * framing/dispatch failures before any tool runs.
 */
export const JsonRpcErrorCode = {
  /** Invalid JSON was received (body did not parse). */
  ParseError: -32700,
  /** The JSON sent is not a valid JSON-RPC request object. */
  InvalidRequest: -32600,
  /** The requested method does not exist / is not handled. */
  MethodNotFound: -32601,
  /** Invalid method parameters. */
  InvalidParams: -32602,
  /** Internal JSON-RPC / server error. */
  InternalError: -32603,
} as const;

export type JsonRpcErrorCodeValue =
  (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

/**
 * A JSON-RPC id: string, number, or null. Notifications carry no id; we model
 * presence/absence at the request level rather than encoding it here.
 */
export const jsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);
export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;

/**
 * An inbound JSON-RPC request (or notification, when `id` is absent). `params`
 * is left as an opaque object/array — each method handler validates its own
 * params with its own schema (InvalidParams on mismatch), keeping this envelope
 * method-agnostic.
 */
export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  /** Absent ⇒ this is a notification (no response is sent). */
  id: jsonRpcIdSchema.optional(),
  method: z.string().min(1),
  params: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
});
export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;

/** A successful JSON-RPC response. `result` shape is method-specific. */
export interface JsonRpcSuccess {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId;
  readonly result: unknown;
}

/** The `error` member of a JSON-RPC error response. */
export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** A JSON-RPC error response. */
export interface JsonRpcFailure {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId;
  readonly error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** Build a JSON-RPC success response for a given id. */
export function jsonRpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

/** Build a JSON-RPC error response for a given id. */
export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  const error: JsonRpcErrorObject =
    data === undefined ? { code, message } : { code, message, data };
  return { jsonrpc: JSONRPC_VERSION, id, error };
}

/**
 * The capabilities this server advertises in the `initialize` handshake. v1 is
 * a tools-only server (PRD §5.2 MCP tool surface); resources/prompts/sampling
 * are not offered. `listChanged: false` — the tool set is static within a
 * session in v1 (no dynamic tool registration over the wire).
 */
export interface ServerCapabilities {
  readonly tools: { readonly listChanged: boolean };
}

/** Server identity returned in the `initialize` result (`serverInfo`). */
export interface ServerInfo {
  readonly name: string;
  readonly version: string;
}

/**
 * Result of the `initialize` method — protocol version, capabilities, and
 * server identity. The client uses `protocolVersion` to confirm compatibility.
 */
export interface InitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: ServerCapabilities;
  readonly serverInfo: ServerInfo;
}

/**
 * One entry in a `tools/list` result. `inputSchema` is a JSON Schema object
 * describing the tool's params (MCP requires JSON Schema on the wire). Concrete
 * tools (DEV-1146/1150) supply these; the skeleton only defines the shape and
 * the listing envelope.
 */
export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** Result of the `tools/list` method. */
export interface ListToolsResult {
  readonly tools: readonly ToolDescriptor[];
}
