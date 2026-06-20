"use server";

/**
 * Active-diagram scoping server actions (DEV-1149, PRD §2.2 / §3).
 *
 * The web surface that lets a signed-in user pick which of their diagrams is the
 * account's ACTIVE diagram — the one the account-scoped MCP connector acts on.
 * Selecting another diagram here is the "rebind the session" of PRD §2.2: the
 * next MCP `tools/call` resolves to the newly-activated diagram (DEV-1145's
 * `ContextResolver` reads the same canonical `active` flag this action writes).
 *
 * Thin adapter over `ScopingService`: it resolves the authenticated account from
 * the session (never trusts a client-supplied account id — tenant isolation),
 * validates the diagram id, calls the service, and revalidates the page.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { getDiagramService } from "@/lib/diagram";
import { ScopingError, getScopingService } from "@/lib/scoping";
import type { Diagram } from "@/lib/types";

/** Result surfaced back to the diagram-switcher page. */
export interface ScopingFormState {
  readonly error?: string;
}

/**
 * The signed-in account's diagrams plus which one is active — the data the
 * switcher renders. Account is taken from the session, not the request body.
 */
export async function listScopableDiagrams(): Promise<{
  diagrams: Diagram[];
  activeDiagramId: string | null;
}> {
  const user = await requireUser();
  const diagrams = await getDiagramService().list(user.accountId);
  const active = await getScopingService().getActiveDiagram(user.accountId);
  return { diagrams, activeDiagramId: active?.id ?? null };
}

/**
 * Make the chosen diagram the account's single active diagram (rebind). The
 * account comes from the session; the diagram id comes from the form. Ownership
 * is enforced by the service, so a forged id for another account's diagram is
 * rejected.
 */
export async function setActiveDiagramAction(
  _prev: ScopingFormState,
  formData: FormData,
): Promise<ScopingFormState> {
  const user = await requireUser();
  const diagramId = String(formData.get("diagramId") ?? "");
  if (diagramId.length === 0) {
    return { error: "Choose a diagram to make active." };
  }

  try {
    await getScopingService().setActiveDiagram({
      accountId: user.accountId,
      diagramId,
    });
  } catch (err) {
    if (err instanceof ScopingError) {
      return { error: err.message };
    }
    throw err;
  }

  revalidatePath("/diagrams");
  return {};
}
