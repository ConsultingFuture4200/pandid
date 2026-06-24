/**
 * Active-diagram selection page (DEV-1149, PRD §2.2 / §3).
 *
 * Protected page where the signed-in user chooses which diagram is the
 * account's ACTIVE diagram — the target of the account-scoped MCP connector.
 * Switching here rebinds the session (PRD §2.2): the next Claude tool call acts
 * on the newly-activated diagram.
 *
 * Server Component: resolves the account from the session via the scoping
 * actions (account never comes from the client), then renders the switcher.
 */
import { requireUser } from "@/lib/auth/current-user";
import { listTemplateSummaries } from "@/lib/templates";
import {
  createDiagramAction,
  createDiagramFromTemplateAction,
} from "../diagram-actions";
import {
  listScopableDiagrams,
  setActiveDiagramAction,
} from "../scoping-actions";
import { DiagramSwitcher } from "./diagram-switcher";
import { NewDiagramForm } from "./new-diagram-form";
import { TemplateGallery } from "./template-gallery";

export default async function DiagramsPage() {
  await requireUser();
  const { diagrams, activeDiagramId } = await listScopableDiagrams();
  const hasDiagrams = diagrams.length > 0;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Diagrams</h1>
      <p className="max-w-md text-center text-sm text-gray-500">
        Your active diagram is the one Claude acts on through the connector and
        the one the editor opens. Only one diagram is active at a time.
      </p>
      {hasDiagrams ? (
        <DiagramSwitcher
          action={setActiveDiagramAction}
          diagrams={diagrams}
          activeDiagramId={activeDiagramId}
        />
      ) : (
        <p className="text-sm text-gray-500">
          No diagrams yet — create one below. It becomes your active diagram.
        </p>
      )}
      <TemplateGallery
        templates={listTemplateSummaries()}
        action={createDiagramFromTemplateAction}
      />
      <NewDiagramForm action={createDiagramAction} />
    </main>
  );
}
