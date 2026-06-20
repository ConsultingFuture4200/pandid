/**
 * Account → active-diagram scoping service (DEV-1149, PRD §3, §4, FR-6).
 *
 * Two responsibilities, both automatable (no live Desktop needed — DEV-1149 🟢):
 *
 *   1. RESOLVE (MCP side): connector token → account → active diagram →
 *      `TransportContext`. This is what the MCP server's `ContextResolver`
 *      (DEV-1145) is wired to once the OAuth chain (DEV-1147/1148) supplies a
 *      real {@link AccountResolver}. A tool never names a diagram (PRD §3 step 2);
 *      the active one is resolved here from canonical state.
 *
 *   2. REBIND (web side): the user selects a diagram (by id, chosen by name in
 *      the UI) in the browser, which becomes the account's single active diagram
 *      (PRD §2.2). `setActiveDiagram` validates ownership and flips the flag;
 *      the very next MCP `tools/call` therefore targets the new diagram — the
 *      "switching active diagram redirects tool target" acceptance.
 *
 * Single active per account is enforced by the repository (one stored selection
 * per account, backed by the partial unique index); this service is the typed,
 * ownership-checked boundary over it.
 */
import {
  DiagramError,
  type DiagramService,
} from "@/lib/diagram";
import type { Diagram } from "@/lib/types";
import {
  ScopingError,
  type AccountResolver,
  type ScopingRepository,
  type TransportContext,
} from "./types";

/**
 * The deny-by-default {@link AccountResolver} the scoping service ships with,
 * mirroring the MCP server's `denyAllContextResolver`. Until DEV-1147/1148 wire
 * a real token→account resolver, every token is unknown ⇒ no account ⇒ tool
 * calls are refused as `unauthorized`. Swapping in the real resolver needs no
 * change to resolution logic.
 */
export const denyAllAccountResolver: AccountResolver = {
  async resolveAccount() {
    return null;
  },
};

export class ScopingService {
  constructor(
    private readonly scoping: ScopingRepository,
    private readonly diagrams: DiagramService,
    /** Token → account. Defaults to deny-all until the OAuth chain wires one. */
    private readonly accounts: AccountResolver = denyAllAccountResolver,
  ) {}

  /**
   * Resolve a connector token to the account-scoped `TransportContext` every MCP
   * tool acts within: `{ accountId, activeDiagramId }`.
   *
   * @throws {ScopingError}
   *   - `unauthorized` if the token resolves to no account (deny-by-default
   *     until DEV-1147/1148; or an expired/unknown token thereafter).
   *   - `no-active-diagram` if the account has no active diagram selected (the
   *     user must open/create one in the editor first).
   */
  async resolveContext(token: string): Promise<TransportContext> {
    const accountId = await this.accounts.resolveAccount(token);
    if (accountId === null) {
      throw new ScopingError(
        "unauthorized",
        "This connector is not signed in. Add the connector in Claude Desktop " +
          "and complete the OAuth sign-in, then try again.",
      );
    }

    const active = await this.scoping.getActiveDiagram(accountId);
    if (active === null) {
      throw new ScopingError(
        "no-active-diagram",
        "Your account has no active diagram. Open or create a diagram in the " +
          "editor — it becomes the active diagram — then ask Claude again.",
      );
    }

    return { accountId, activeDiagramId: active.id };
  }

  /** The account's active diagram, or null if none is selected (web read). */
  async getActiveDiagram(accountId: string): Promise<Diagram | null> {
    return this.scoping.getActiveDiagram(accountId);
  }

  /**
   * Make a diagram the account's single active diagram (web-side rebind, PRD
   * §2.2). Ownership is validated through the canonical `DiagramService` first,
   * so a diagram from another account can never be activated (tenant isolation).
   *
   * @throws {ScopingError} `diagram-not-found` if the diagram is absent or not
   *   owned by the account.
   */
  async setActiveDiagram(input: {
    accountId: string;
    diagramId: string;
  }): Promise<Diagram> {
    // Ownership check on the canonical store (also normalizes the not-found
    // message through one path). `open` throws `not_found` for a wrong-account
    // or missing diagram.
    try {
      await this.diagrams.open(input);
    } catch (error) {
      if (error instanceof DiagramError && error.code === "not_found") {
        throw this.notFound(input.diagramId);
      }
      throw error;
    }

    const activated = await this.scoping.setActiveDiagram(input);
    if (activated === null) {
      // Raced with a delete between the ownership check and the flag write.
      throw this.notFound(input.diagramId);
    }
    return activated;
  }

  /** Clear the account's active diagram (none active). Idempotent. */
  async clearActiveDiagram(accountId: string): Promise<void> {
    await this.scoping.clearActiveDiagram(accountId);
  }

  private notFound(diagramId: string): ScopingError {
    return new ScopingError(
      "diagram-not-found",
      `Diagram ${diagramId} was not found for your account. Pick a diagram you ` +
        "own from your diagram list, then make it active.",
    );
  }
}
