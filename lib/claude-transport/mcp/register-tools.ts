/**
 * Register the v1 MCP tool catalog into the server's registry (DEV-1146 read
 * tools + DEV-1150 propose tools).
 *
 * This is the wiring point the registry comment (tool-registry.ts) describes:
 * the read- and propose-tool catalogs each own their descriptors + dispatch in
 * `lib/mcp-tools`; this module ADAPTS each catalog descriptor to the registry's
 * `McpTool` shape and registers it. It imports `lib/mcp-tools` and never edits
 * it (CLAUDE.md: "No two tasks edit the same file") — adding a tool is a change
 * in that catalog alone, picked up here without edits.
 *
 * Adaptation per catalog entry:
 *   - `descriptor` ← the catalog entry's `{ name, description, inputSchema }`.
 *     Read tools take no arguments, so they get an empty-object input schema;
 *     propose tools carry their own JSON-Schema.
 *   - `execute(params, context)` ← calls the catalog entry's `call`, passing the
 *     account-scoped `TransportContext` (and, for propose tools, the raw params
 *     as the tool's `arguments`). The catalog's JSON output is wrapped into the
 *     MCP `content` block shape. A propose tool's `rejected` result (FR-8 — the
 *     validator refused) is surfaced with `isError: true`, not thrown, so Claude
 *     reads the report as a tool result rather than a transport error.
 *
 * One committer (CLAUDE.md): every registered tool either READS canonical state
 * or STAGES a validated proposal. Nothing here grants a commit/accept path —
 * the propose catalog stages only, and there is no commit tool to register.
 */
import {
  buildReadToolDescriptors,
  DiagramServiceActiveSource,
  getMcpReadTools,
  type ReadToolDescriptor,
} from "@/lib/mcp-tools";
import {
  buildProposeToolDescriptors,
  createMaterializeEdit,
  getMcpProposeTools,
  type ProposeToolDescriptor,
} from "@/lib/mcp-tools/propose-index";
import { getDiagramService } from "@/lib/diagram";
import { getProposalService } from "@/lib/proposals";
import type { JsonObject } from "@/lib/types";
import type { TransportContext } from "../types";
import type { McpToolResult } from "./tool-registry";
import type { McpToolRegistry } from "./tool-registry";

/** Empty-object JSON Schema for the read tools, which take no arguments. */
const NO_ARGUMENTS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

/** Wrap a tool's JSON output into the single MCP text content block v1 uses. */
function toToolResult(
  output: JsonObject,
  isError: boolean,
): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Adapt a DEV-1146 read-tool descriptor to the registry's `McpTool`. Read tools
 * never mutate and never fail at the validator, so the result is never an error
 * block; arguments are ignored (the tool takes none).
 */
function adaptReadTool(descriptor: ReadToolDescriptor) {
  return {
    descriptor: {
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: NO_ARGUMENTS_SCHEMA,
    },
    async execute(
      _params: Record<string, unknown>,
      context: TransportContext,
    ): Promise<McpToolResult> {
      return toToolResult(await descriptor.call(context), false);
    },
  };
}

/**
 * Adapt a DEV-1150 propose-tool descriptor to the registry's `McpTool`. The raw
 * `params` are the tool's `arguments` (the tool parses them with Zod). A
 * `rejected` outcome (the validator refused at staging, FR-8) is returned as an
 * `isError` result so Claude reads the report, not a transport error.
 */
function adaptProposeTool(descriptor: ProposeToolDescriptor) {
  return {
    descriptor: {
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
    },
    async execute(
      params: Record<string, unknown>,
      context: TransportContext,
    ): Promise<McpToolResult> {
      const output = await descriptor.call(context, params);
      const rejected = (output as { status?: unknown }).status === "rejected";
      return toToolResult(output, rejected);
    },
  };
}

/**
 * Register the full v1 tool catalog (4 read + 5 propose = 9 tools) into
 * `registry`. Idempotent per registry instance is NOT assumed: the registry
 * throws on a duplicate name, so call this exactly once per registry (the
 * process-wide singleton is built once in `getMcpToolRegistry`).
 */
export function registerMcpTools(registry: McpToolRegistry): McpToolRegistry {
  // Share ONE active-diagram source + proposal service across read and propose
  // tools so: (a) the accept materializer reads the same canonical source it
  // stages against, and (b) read tools see the same pending proposals the propose
  // tools stage (the no-clobber + effective-state design hinges on one shared
  // pending set). The proposal service carries the accept-time materializer.
  const source = new DiagramServiceActiveSource(getDiagramService());
  const proposals = getProposalService(createMaterializeEdit(source));

  for (const descriptor of buildReadToolDescriptors(
    getMcpReadTools(source, proposals),
  )) {
    registry.register(adaptReadTool(descriptor));
  }
  for (const descriptor of buildProposeToolDescriptors(
    getMcpProposeTools(source, proposals),
  )) {
    registry.register(adaptProposeTool(descriptor));
  }
  return registry;
}
