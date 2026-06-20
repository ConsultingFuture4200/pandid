/**
 * Active-diagram source for the MCP read tools (DEV-1146).
 *
 * A read tool acts on whatever diagram is ACTIVE for the calling account (PRD §3
 * step 2: the connector is account-scoped; Claude never names a diagram). This
 * seam resolves `{ accountId, activeDiagramId }` (from the transport context) to
 * the diagram row + its latest immutable version snapshot — the canonical state
 * the read tools project.
 *
 * It is intentionally narrow and read-only: `getActiveDiagram` and nothing else.
 * The account→active-diagram RESOLUTION (which diagram is "active") is DEV-1149's
 * job; this source consumes the already-resolved id off the context and is the
 * only place the read tools touch the persistence layer, so when DEV-1149 lands
 * its resolver simply supplies the context — no read-tool change.
 *
 * Server is the single source of truth (CLAUDE.md): the snapshot is read from the
 * diagram service over the canonical repository, never from the browser canvas.
 */
import type { TransportContext } from "@/lib/claude-transport";
import type { Diagram } from "@/lib/types";
import {
  DiagramError,
  type DiagramService,
  type VersionSnapshot,
} from "@/lib/diagram";

/** The active diagram plus its latest immutable version (null if never saved). */
export interface ActiveDiagram {
  readonly diagram: Diagram;
  /** Latest version's scene + metadata, or null for a diagram with no version. */
  readonly snapshot: VersionSnapshot | null;
}

/** Resolves the calling account's active diagram + its latest version snapshot. */
export interface ActiveDiagramSource {
  getActiveDiagram(context: TransportContext): Promise<ActiveDiagram>;
}

/** Typed read-side failures surfaced to the MCP tool layer. */
export type McpReadErrorCode = "no-active-diagram" | "unauthorized";

/**
 * Boundary error for the read-tool data source. Messages say what happened + how
 * to fix (CLAUDE.md). Distinct from `DiagramError` so the MCP layer can map it to
 * the right tool-error response for Claude.
 */
export class McpReadError extends Error {
  readonly code: McpReadErrorCode;
  constructor(code: McpReadErrorCode, message: string) {
    super(message);
    this.name = "McpReadError";
    this.code = code;
  }
}

/**
 * Default `ActiveDiagramSource` over the canonical `DiagramService`.
 *
 * Resolves the diagram named by `context.activeDiagramId`, scoped to
 * `context.accountId` (tenant isolation — a diagram owned by another account
 * resolves as not found), then loads its newest version snapshot.
 */
export class DiagramServiceActiveSource implements ActiveDiagramSource {
  constructor(private readonly diagrams: DiagramService) {}

  async getActiveDiagram(context: TransportContext): Promise<ActiveDiagram> {
    const accountId = context.accountId;
    const diagramId = context.activeDiagramId;
    if (diagramId.length === 0) {
      throw new McpReadError(
        "no-active-diagram",
        "This account has no active diagram. Open or create a diagram in the " +
          "editor, then ask Claude again.",
      );
    }

    let diagram: Diagram;
    let versions;
    try {
      // `open` is account-scoped: a diagram not owned by the account throws
      // `not_found`, which we surface as unauthorized (do not leak existence).
      const opened = await this.diagrams.open({ accountId, diagramId });
      diagram = opened.diagram;
      versions = opened.versions;
    } catch (error) {
      if (error instanceof DiagramError && error.code === "not_found") {
        throw new McpReadError(
          "unauthorized",
          "The active diagram could not be read for this account. Re-open the " +
            "diagram in the editor and try again.",
        );
      }
      throw error;
    }

    // `open` returns versions newest-first; the latest is the current state.
    const latest = versions[0];
    if (latest === undefined) {
      return { diagram, snapshot: null };
    }

    const snapshot = await this.diagrams.restoreVersion({
      accountId,
      diagramId,
      versionId: latest.id,
    });
    return { diagram, snapshot };
  }
}
