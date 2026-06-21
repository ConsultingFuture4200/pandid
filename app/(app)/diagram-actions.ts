"use server";

/**
 * Create-diagram server action (PRD §2.2 / §3, FR-17–19).
 *
 * A new account has no diagrams, so it has no active diagram — the MCP connector
 * and the editor both have nothing to act on. This is the surface that unblocks
 * that: a signed-in user names a diagram, it is persisted (with an initial empty
 * immutable version) through `DiagramService`, and it is set as the account's
 * single ACTIVE diagram through `ScopingService` so the editor and connector
 * immediately target it.
 *
 * Thin adapter, same shape as `scoping-actions.ts`: it resolves the account from
 * the SESSION (never trusts a client-supplied account id — tenant isolation),
 * validates the name with Zod, drives the canonical libs (no duplicated CRUD /
 * versioning / active-flag logic), and revalidates the page.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import {
  DiagramError,
  getDiagramService,
  type DiagramService,
} from "@/lib/diagram";
import {
  ScopingError,
  getScopingService,
  type ScopingService,
} from "@/lib/scoping";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { JsonObject } from "@/lib/types";

/** Result surfaced back to the new-diagram form. */
export interface CreateDiagramFormState {
  readonly error?: string;
}

const nameSchema = z.string().trim().min(1, {
  message: "Enter a name for the diagram.",
});

/** The empty scene a brand-new diagram's initial version is saved with. */
function emptyScene(): JsonObject {
  return { elements: [] };
}

/**
 * Collaborators a create needs. Exposed so the action's logic is unit-testable
 * with in-memory services + a fixed user, without touching the session cookie.
 * The exported server action injects the real session + singleton services.
 */
export interface CreateDiagramDeps {
  readonly user: AuthenticatedUser;
  readonly diagrams: DiagramService;
  readonly scoping: ScopingService;
}

/**
 * Core create logic: validate the name, create the diagram + its initial empty
 * version, and make it the account's active diagram. The account always comes
 * from `deps.user` (the session), never from `formData`.
 */
export async function createDiagramWith(
  deps: CreateDiagramDeps,
  name: string,
): Promise<CreateDiagramFormState> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a diagram name." };
  }

  const { user, diagrams, scoping } = deps;
  try {
    const diagram = await diagrams.create({
      accountId: user.accountId,
      name: parsed.data,
    });
    // Seed an initial immutable version so the diagram is openable/renderable
    // from the moment it exists (versions are immutable; this is the first one).
    await diagrams.save({
      accountId: user.accountId,
      diagramId: diagram.id,
      save: { excalidrawScene: emptyScene(), metadata: [] },
    });
    // Newly-created diagram becomes the account's single active diagram, so the
    // editor and the MCP connector both target it next.
    await scoping.setActiveDiagram({
      accountId: user.accountId,
      diagramId: diagram.id,
    });
  } catch (err) {
    if (err instanceof DiagramError || err instanceof ScopingError) {
      return { error: err.message };
    }
    throw err;
  }

  return {};
}

/**
 * Server action bound by the new-diagram form. Resolves the account from the
 * session and the canonical singleton services, then delegates to
 * {@link createDiagramWith} and revalidates `/diagrams`.
 */
export async function createDiagramAction(
  _prev: CreateDiagramFormState,
  formData: FormData,
): Promise<CreateDiagramFormState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "");

  const result = await createDiagramWith(
    { user, diagrams: getDiagramService(), scoping: getScopingService() },
    name,
  );

  if (result.error === undefined) {
    revalidatePath("/diagrams");
  }
  return result;
}
