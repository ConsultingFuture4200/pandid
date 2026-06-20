/**
 * Account → active-diagram scoping types (DEV-1149, PRD §3, §4, FR-6).
 *
 * The MCP connector is **account-scoped**: a connector token resolves to an
 * account, the account has **at most one active diagram**, and every MCP tool
 * acts on that diagram (PRD §3 step 2; §2.2 "one active diagram at a time").
 * This module owns that resolution and the single-active-per-session rule; it
 * is the seam the MCP server's `ContextResolver` (DEV-1145) is wired through
 * once the OAuth chain (DEV-1147/1148) lands.
 *
 * Boundaries this module deliberately does NOT cross:
 *   - It does NOT issue or verify OAuth tokens — that is DEV-1147/1148. It
 *     depends on an injected {@link AccountResolver} (token → accountId); the
 *     skeleton default denies all, mirroring the MCP server's deny-by-default
 *     posture, so this part is automatable and testable without a live Desktop.
 *   - It does NOT own diagram CRUD/versioning — that is DEV-1135. It composes
 *     `DiagramService` for ownership checks and reads/writes only the per-account
 *     `active` flag through its own narrow {@link ScopingRepository}.
 *
 * Architecture invariants (CLAUDE.md) upheld here:
 *   - Server is the single source of truth: "which diagram is active" is a
 *     persisted per-account fact (the `diagram.active` column), never inferred
 *     from a browser or an MCP request.
 *   - Tenant isolation: every operation is scoped by `accountId`; a diagram
 *     owned by another account can never be made active or resolved.
 */
import type { TransportContext } from "@/lib/claude-transport";
import type { Diagram } from "@/lib/types";

/** Typed failure modes at the scoping boundary. */
export type ScopingErrorCode =
  | "unauthorized" // the connector token resolves to no account
  | "no-active-diagram" // the account has no active diagram selected
  | "diagram-not-found"; // the named diagram is absent / not owned by the account

/**
 * Boundary error for the scoping layer. Messages say what happened + how to fix
 * (CLAUDE.md). A resolver throws this for operational failures so the MCP server
 * can map it to the right deny/refusal response for Claude.
 */
export class ScopingError extends Error {
  readonly code: ScopingErrorCode;
  constructor(code: ScopingErrorCode, message: string) {
    super(message);
    this.name = "ScopingError";
    this.code = code;
  }
}

/**
 * Resolves an opaque connector token to the account it is bound to.
 *
 * This is the seam to the MCP OAuth chain (DEV-1147/1148): the token issuer owns
 * the implementation; scoping depends only on this interface so the automatable
 * account→active-diagram logic is decoupled from the human-gated OAuth flow
 * (why DEV-1149 is 🟢 while its blocker DEV-1148 is 🔴).
 *
 * @returns the bound `accountId`, or `null` if the token is unknown/expired
 *   (a `null` here surfaces as `unauthorized`, never as a thrown error).
 */
export interface AccountResolver {
  resolveAccount(token: string): Promise<string | null>;
}

/**
 * Persistence surface for the per-account active-diagram flag.
 *
 * Narrow on purpose: it owns only the `diagram.active` selection, NOT diagram
 * CRUD/versioning (DEV-1135's `DiagramRepository`). `setActiveDiagram` enforces
 * the single-active-per-account rule atomically (the schema backs this with a
 * partial unique index, migration 0001).
 */
export interface ScopingRepository {
  /** The account's active diagram, or null if none is selected. */
  getActiveDiagram(accountId: string): Promise<Diagram | null>;

  /**
   * Make `diagramId` the account's single active diagram, atomically clearing
   * any prior active diagram for that account (the rebind in PRD §2.2). The
   * diagram must already be owned by the account (the caller checks ownership).
   * @returns the now-active diagram, or null if absent / not owned.
   */
  setActiveDiagram(input: {
    accountId: string;
    diagramId: string;
  }): Promise<Diagram | null>;

  /** Clear the account's active diagram (none active). Idempotent. */
  clearActiveDiagram(accountId: string): Promise<void>;
}

/** Re-export the transport context this module produces, for callers. */
export type { TransportContext };
