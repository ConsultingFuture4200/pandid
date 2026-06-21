/**
 * MCP propose-tool registry (DEV-1150, PRD §5.2).
 *
 * Declarative descriptors for the five MUTATING tools, mirroring the read-tool
 * registry (DEV-1146) so the MCP server skeleton (DEV-1145) registers them by
 * iterating a list instead of hard-wiring call sites. Each descriptor carries the
 * MCP tool name, a description, a JSON-Schema for its arguments, `readOnly: false`
 * (it stages a proposal), and a `call(context, args)` that runs the tool and
 * returns JSON-safe output the MCP layer serializes.
 *
 * Architecture invariant (CLAUDE.md): a propose tool STAGES a validated proposal;
 * it never commits. The descriptor surface only exposes staging — there is no
 * commit/accept descriptor here (that is the human's act on a different path).
 */
import type { TransportContext } from "@/lib/claude-transport";
import type { JsonObject } from "@/lib/types";
import type { McpProposeTools } from "./propose-tools";

/**
 * A registered propose (mutating) tool. `requiresActiveDiagram` is always true —
 * every propose tool edits the account's active diagram (PRD §3 step 2).
 * `readOnly` is always false, distinguishing these from the read tools at the
 * registry level so the MCP layer can advertise/guard them differently.
 */
export interface ProposeToolDescriptor {
  /** MCP tool name exposed to Claude Desktop. */
  readonly name: string;
  /** One-line description for the tool catalog. */
  readonly description: string;
  /** JSON-Schema for the tool's arguments (the MCP `inputSchema`). */
  readonly inputSchema: Record<string, unknown>;
  /** Always false — these tools stage a proposal (they mutate via the human). */
  readonly readOnly: false;
  /** Always true — every propose tool targets the account's active diagram. */
  readonly requiresActiveDiagram: true;
  /** Run the tool for a resolved context + raw args; returns JSON-safe output. */
  call(context: TransportContext, args: unknown): Promise<JsonObject>;
}

/** As a JsonObject so the MCP layer serializes tool output without a transform. */
function asJson<T>(value: T): JsonObject {
  return value as unknown as JsonObject;
}

const ADD_EQUIPMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["equipmentType", "x", "y"],
  properties: {
    equipmentType: {
      type: "string",
      description: "A symbol id from list_equipment_types (e.g. \"pump\").",
    },
    x: { type: "number", description: "Canvas x position (px)." },
    y: { type: "number", description: "Canvas y position (px)." },
    size: { type: "number", description: "Optional footprint (px). Defaults to 100." },
    attributes: {
      type: "object",
      description:
        "Element attributes, including the equipment tag and any required " +
        "type-specific fields (see list_equipment_types).",
    },
  },
  additionalProperties: false,
};

const CONNECT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["sourceElementId", "sourcePort", "targetElementId", "targetPort"],
  properties: {
    sourceElementId: { type: "string" },
    sourcePort: { type: "string", description: "A port id exposed by the source element." },
    targetElementId: { type: "string" },
    targetPort: { type: "string", description: "A port id exposed by the target element." },
    signal: { type: "boolean", description: "True for a dashed signal line; default process line." },
    lineId: { type: "string", description: "Optional line id for the connector's metadata." },
    attributes: {
      type: "object",
      description:
        "Connector attributes. A process line (the default — `signal` false or " +
        'omitted) REQUIRES a "service" value (e.g. "product", "solvent", ' +
        '"feed"); the proposal is refused without it. Signal lines have no ' +
        "required attributes.",
    },
  },
  additionalProperties: false,
};

const SET_METADATA_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["elementId", "attributes"],
  properties: {
    elementId: { type: "string" },
    attributes: {
      type: "object",
      description: "Attributes to merge onto the element (existing keys are kept).",
    },
  },
  additionalProperties: false,
};

const DELETE_ELEMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["elementId"],
  properties: {
    elementId: {
      type: "string",
      description:
        "The element to remove. Deleting equipment also removes connections " +
        "incident on it.",
    },
  },
  additionalProperties: false,
};

const MOVE_OR_RELABEL_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["elementId"],
  properties: {
    elementId: { type: "string" },
    x: { type: "number", description: "New x position (px). Provide x and/or y to move." },
    y: { type: "number", description: "New y position (px)." },
    tag: { type: "string", description: "New equipment tag (relabel)." },
  },
  additionalProperties: false,
};

/**
 * Build the propose-tool descriptors over a constructed `McpProposeTools`. The
 * MCP skeleton registers each descriptor's `name` and dispatches to `call`.
 */
export function buildProposeToolDescriptors(
  tools: McpProposeTools,
): readonly ProposeToolDescriptor[] {
  return [
    {
      name: "add_equipment",
      description:
        "Stage a proposal that places a new equipment symbol with its metadata. " +
        "Validated before staging; never commits.",
      inputSchema: ADD_EQUIPMENT_SCHEMA,
      readOnly: false,
      requiresActiveDiagram: true,
      call: async (context, args) =>
        asJson(await tools.addEquipment(context, args)),
    },
    {
      name: "connect",
      description:
        "Stage a proposal that connects two element ports with a process or " +
        "signal line. Validated before staging; never commits.",
      inputSchema: CONNECT_SCHEMA,
      readOnly: false,
      requiresActiveDiagram: true,
      call: async (context, args) => asJson(await tools.connect(context, args)),
    },
    {
      name: "set_metadata",
      description:
        "Stage a proposal that merges attributes onto an existing element " +
        "(e.g. set a tag or required field). Validated before staging; never commits.",
      inputSchema: SET_METADATA_SCHEMA,
      readOnly: false,
      requiresActiveDiagram: true,
      call: async (context, args) =>
        asJson(await tools.setMetadata(context, args)),
    },
    {
      name: "delete_element",
      description:
        "Stage a proposal that removes an element (and any connections incident " +
        "on it). Validated before staging; never commits.",
      inputSchema: DELETE_ELEMENT_SCHEMA,
      readOnly: false,
      requiresActiveDiagram: true,
      call: async (context, args) =>
        asJson(await tools.deleteElement(context, args)),
    },
    {
      name: "move_or_relabel",
      description:
        "Stage a proposal that repositions an element and/or changes its tag. " +
        "Validated before staging; never commits.",
      inputSchema: MOVE_OR_RELABEL_SCHEMA,
      readOnly: false,
      requiresActiveDiagram: true,
      call: async (context, args) =>
        asJson(await tools.moveOrRelabel(context, args)),
    },
  ];
}
