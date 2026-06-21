/**
 * Canvas route (DEV-1137, FR-1; wired to the real active diagram here).
 *
 * Server Component: resolves the signed-in account's ACTIVE diagram and loads its
 * latest committed version (scene + metadata) BEFORE rendering, so the canvas is
 * initialized from canonical state (server is the single source of truth). When
 * the account has no active diagram, it renders a clear empty state linking to
 * /diagrams to pick or create one.
 *
 * The interactive editor (canvas + palette + proposal overlay) is the client
 * {@link EditorShell}; Excalidraw inside it mounts via `dynamic(..., { ssr:false })`
 * (CLAUDE.md fact #2). `requireUser` (inside `loadActiveDiagram`) redirects an
 * unauthenticated visitor to /login.
 */
import Link from "next/link";
import { loadActiveDiagram } from "@/app/(canvas)/editor-actions";
import { EditorShell } from "@/components/canvas/editor-shell";

export default async function CanvasPage() {
  const result = await loadActiveDiagram();

  if (result.status === "no-active-diagram") {
    return (
      <main
        data-testid="editor-no-active-diagram"
        className="flex h-screen w-screen flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <h1 className="text-lg font-semibold">No active diagram</h1>
        <p className="max-w-md text-sm text-gray-600">
          You don&apos;t have an active diagram yet. Open or create one to start
          drawing — the diagram you open becomes the one Claude is scoped to.
        </p>
        <Link
          href="/diagrams"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
        >
          Go to your diagrams
        </Link>
      </main>
    );
  }

  const { diagram } = result;
  return (
    <EditorShell
      diagramId={diagram.diagramId}
      diagramName={diagram.name}
      initialModel={diagram.model}
    />
  );
}
