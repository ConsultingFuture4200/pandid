/**
 * Claude-transport seam (DEV-1143, PRD §9 kill/fallback criterion).
 *
 * THE single interface every Claude-driven editing path implements. Path C (the
 * remote Streamable HTTP MCP server — DEV-1145) is the v1 implementation; the
 * §9 fallback (a built-in API-key chat panel — "Path B") is an additive second
 * implementation, NOT a rewrite. Because both sit behind this interface, the
 * rest of the app (canvas, commit pipeline, proposal UI) never imports MCP-
 * specific code and carries no MCP-specific assumptions.
 *
 * Architecture invariants encoded HERE, at the seam (CLAUDE.md):
 *   - One committer. A transport can READ canonical state and STAGE a proposal;
 *     it can NEVER commit. There is deliberately no `commit`/`apply` method on
 *     this interface — committing is the human's act, through the diagram commit
 *     pipeline (DEV-1140), and lives on a different code path entirely.
 *   - Proposals are staged, never applied. `propose` returns a staged
 *     `Proposal` (status `pending`) or the validator's refusal — never a
 *     mutation of canonical state.
 *   - Server is the single source of truth. A transport is a CLIENT of canonical
 *     Postgres state; it does not hold its own copy.
 *
 * Payload shapes that belong to other layers (the rendered diagram state, the
 * SVG snapshot, the staged change, the validator report) are kept opaque /
 * delegated here so this seam does not couple to Excalidraw, the validator's
 * concrete report, or the MCP wire format. Concrete transports own those.
 */
import { z } from "zod";
import {
  jsonObjectSchema,
  proposalSchema,
  type JsonObject,
  type Proposal,
} from "@/lib/types";

/** Re-exported so this seam is a single import surface for transport callers. */
export type { JsonObject, Proposal } from "@/lib/types";

/**
 * Identifies which Claude-transport mechanism is in use. `mcp` is Path C (v1);
 * `api-key-chat` is the §9 fallback (Path B), added without touching callers.
 * A discriminant (not a boolean) so a third mechanism slots in cleanly.
 */
export const transportKindSchema = z.enum(["mcp", "api-key-chat"]);
export type TransportKind = z.infer<typeof transportKindSchema>;

/**
 * The account-scoped context a transport acts within. A transport never picks
 * the diagram itself — it acts on whatever diagram is active for the account
 * (PRD §3 step 2: the connector is account-scoped). DEV-1149 resolves
 * account → active diagram; the transport receives the resolved ids.
 */
export interface TransportContext {
  /** The authenticated account the Claude session is bound to. */
  readonly accountId: string;
  /** The account's currently-active diagram, the target of all operations. */
  readonly activeDiagramId: string;
}

/**
 * The diagram state a transport returns to Claude for reasoning: structured
 * state plus a server-rendered SVG snapshot (PRD §4 "Tool return payload",
 * FR-9). Both are opaque at this seam — the SVG renderer (DEV-1142) and the
 * state shape are owned elsewhere; the seam only guarantees Claude gets both.
 */
export interface DiagramView {
  /** Structured diagram state for Claude's reasoning. Opaque JSON here. */
  readonly state: JsonObject;
  /** Server-rendered SVG snapshot of the same state (FR-9), for verification. */
  readonly svg: string;
}

export const diagramViewSchema = z.object({
  state: jsonObjectSchema,
  svg: z.string(),
});

/**
 * A change Claude asks to make. Opaque JSON at this seam — its concrete shape
 * (add element, connect, relabel, …) is defined by the propose tools (DEV-1150)
 * and validated by the validator (DEV-1133); the seam only carries it through.
 */
export type ProposedChange = JsonObject;
export const proposedChangeSchema = jsonObjectSchema;

/**
 * Outcome of a `propose` call — a discriminated union so a refusal is a
 * first-class result, not an exception. FR-8: a mutating tool runs the
 * validator and REFUSES to stage an invalid proposal, returning the validation
 * errors to Claude instead of committing anything.
 *
 *   - `staged`   → a pending `Proposal` row was created (awaiting human accept).
 *   - `rejected` → the validator refused; `validatorReport` carries the reasons.
 *                  No proposal row, no mutation.
 */
export type ProposeResult =
  | { readonly status: "staged"; readonly proposal: Proposal }
  | { readonly status: "rejected"; readonly validatorReport: JsonObject };

export const proposeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("staged"), proposal: proposalSchema }),
  z.object({ status: z.literal("rejected"), validatorReport: jsonObjectSchema }),
]);

/**
 * THE seam. Every Claude-transport mechanism implements exactly this. Callers
 * (the propose-tool layer, future chat panel) depend on this interface and the
 * payload shapes above — never on a concrete transport.
 *
 * Note the surface is deliberately propose-only: read the active diagram, and
 * stage a (validated) proposal. There is no commit/accept/reject here — those
 * are the human's acts on the canonical commit path, not the transport's.
 */
export interface ClaudeTransport {
  /** Which mechanism this is (diagnostics, onboarding copy, capability gating). */
  readonly kind: TransportKind;

  /**
   * Read the account's active diagram as structured state + SVG (FR-6, FR-9).
   * Read-only: never mutates canonical state.
   */
  getActiveDiagram(context: TransportContext): Promise<DiagramView>;

  /**
   * Stage a proposed change as a validated, pending `Proposal` (FR-7, FR-8).
   * Runs the validator; on failure returns `{ status: "rejected" }` with the
   * report and stages nothing. On success returns `{ status: "staged" }` with a
   * pending proposal — it does NOT commit. Committing is the human's act.
   */
  propose(
    context: TransportContext,
    change: ProposedChange,
  ): Promise<ProposeResult>;
}

/** Typed failure modes at the transport boundary. */
export type TransportErrorCode =
  | "unauthorized" // the session is not authenticated / not bound to an account
  | "no-active-diagram" // the account has no active diagram to act on
  | "transport-unavailable"; // the underlying mechanism (connector/API) is down

/**
 * Boundary error for the transport seam. Messages say what happened + how to
 * fix (CLAUDE.md). A transport throws this for operational failures; a refused
 * proposal is NOT an error — it is a `ProposeResult` of status `rejected`.
 */
export class TransportError extends Error {
  readonly code: TransportErrorCode;
  constructor(code: TransportErrorCode, message: string) {
    super(message);
    this.name = "TransportError";
    this.code = code;
  }
}
