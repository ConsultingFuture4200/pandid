/**
 * Domain types + Zod schemas (DEV-1130).
 *
 * The contract every other module depends on. Schemas are the boundary
 * validators; types are derived from them. Re-exported here as the single
 * import surface: `import { diagramSchema, type Diagram } from "@/lib/types";`
 *
 * Types-only foundation: no persistence, no logic. `verbatimModuleSyntax` is
 * on (scaffold tsconfig), so type symbols are re-exported with `export type`.
 */
export {
  jsonValueSchema,
  jsonObjectSchema,
  uuidSchema,
  isoTimestampSchema,
} from "./common";
export type { JsonValue, JsonObject } from "./common";

export { accountSchema } from "./account";
export type { Account } from "./account";

export { diagramSchema, diagramVersionSchema } from "./diagram";
export type { Diagram, DiagramVersion } from "./diagram";

export { elementMetadataSchema } from "./element-metadata";
export type { ElementMetadata } from "./element-metadata";

export { proposalSchema, proposalStatusSchema } from "./proposal";
export type { Proposal, ProposalStatus } from "./proposal";

export { connectionSchema } from "./connection";
export type { Connection } from "./connection";
