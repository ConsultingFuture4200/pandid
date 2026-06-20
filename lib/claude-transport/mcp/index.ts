/**
 * Public surface of the MCP server skeleton (DEV-1145, PRD §4 / FR-5).
 *
 * The Streamable HTTP MCP server core, its tool registry, and the wire-protocol
 * types. This is the import surface for:
 *   - the route handler (app/api/mcp/route.ts) — HTTP framing over `McpServer`
 *   - DEV-1146 (read tools) / DEV-1150 (propose tools) — register `McpTool`s
 *   - DEV-1147/1148 (OAuth/DCR) — inject a real `ContextResolver`
 *
 * Everything Claude-transport-specific stays under `lib/claude-transport/`
 * (CLAUDE.md critical fact #4): no MCP assumption leaks into app/canvas code, so
 * the §9 API-key fallback stays additive.
 */
export {
  MCP_PROTOCOL_VERSION,
  JSONRPC_VERSION,
  JsonRpcErrorCode,
  jsonRpcRequestSchema,
  jsonRpcSuccess,
  jsonRpcError,
} from "./protocol";
export type {
  InitializeResult,
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccess,
  ListToolsResult,
  ServerCapabilities,
  ServerInfo,
  ToolDescriptor,
} from "./protocol";

export { McpToolRegistry, McpToolError } from "./tool-registry";
export type { McpTool, McpToolResult } from "./tool-registry";

export {
  McpServer,
  denyAllContextResolver,
} from "./server";
export type {
  ContextResolver,
  McpServerOptions,
} from "./server";

import { McpServer } from "./server";
import { McpToolRegistry } from "./tool-registry";

let cachedRegistry: McpToolRegistry | null = null;
let cachedServer: McpServer | null = null;

/**
 * The process-wide MCP tool registry. Downstream tasks register their tools
 * into this singleton at module-init time (DEV-1146/1150) so the running server
 * exposes them. The skeleton leaves it empty.
 */
export function getMcpToolRegistry(): McpToolRegistry {
  cachedRegistry ??= new McpToolRegistry();
  return cachedRegistry;
}

/**
 * The process-wide MCP server the route handler drives. Built over the shared
 * registry with the skeleton's deny-by-default context resolver; the auth chain
 * (DEV-1147/1148/1149) swaps in a real resolver by constructing the server with
 * its own `resolveContext` once that lands.
 */
export function getMcpServer(): McpServer {
  cachedServer ??= new McpServer({ registry: getMcpToolRegistry() });
  return cachedServer;
}
