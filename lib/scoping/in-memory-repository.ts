/**
 * In-memory ScopingRepository (DEV-1149).
 *
 * Test double + local-dev stand-in for the per-account active-diagram flag. NOT
 * the production store — `getScopingRepository` (index.ts) refuses to serve this
 * in production so "which diagram is active" is never an in-process map.
 *
 * It composes the diagram `DiagramRepository` for ownership/lookup (so the test
 * double shares one canonical set of diagrams with the diagram service) and
 * keeps only the active-selection state (one active diagram id per account) of
 * its own. The single-active-per-account rule is enforced by storing exactly one
 * id per account in `activeByAccount`.
 */
import type { Diagram } from "@/lib/types";
import type { DiagramRepository } from "@/lib/diagram";
import type { ScopingRepository } from "./types";

export class InMemoryScopingRepository implements ScopingRepository {
  /** accountId → the account's single active diagram id. */
  private readonly activeByAccount = new Map<string, string>();

  constructor(private readonly diagrams: DiagramRepository) {}

  async getActiveDiagram(accountId: string): Promise<Diagram | null> {
    const diagramId = this.activeByAccount.get(accountId);
    if (diagramId === undefined) {
      return null;
    }
    // Re-fetch through the diagram repo so a deleted/transferred diagram is not
    // returned as active (and so we never hand back a stale row).
    const diagram = await this.diagrams.getDiagram({ accountId, diagramId });
    if (diagram === null) {
      // The selected diagram is gone / no longer owned — drop the stale pointer.
      this.activeByAccount.delete(accountId);
      return null;
    }
    return { ...diagram, active: true };
  }

  async setActiveDiagram(input: {
    accountId: string;
    diagramId: string;
  }): Promise<Diagram | null> {
    const diagram = await this.diagrams.getDiagram(input);
    if (diagram === null) {
      return null;
    }
    // Single active per account: overwrite the one stored id (rebind, PRD §2.2).
    this.activeByAccount.set(input.accountId, input.diagramId);
    return { ...diagram, active: true };
  }

  async clearActiveDiagram(accountId: string): Promise<void> {
    this.activeByAccount.delete(accountId);
  }
}
