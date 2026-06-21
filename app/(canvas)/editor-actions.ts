"use server";

/**
 * Editor server actions — wire /editor to the account's real ACTIVE diagram
 * (this task: load canonical state, save manual edits, poll pending proposals).
 *
 * The browser canvas is a CLIENT of canonical Postgres state, never a second
 * source of truth (CLAUDE.md architecture invariants). These actions are the only
 * bridge between the canvas and that state:
 *
 *   loadActiveDiagram   → resolve the account's active diagram (scoping) and load
 *                         its latest immutable version's scene + metadata as a
 *                         placement model. No active diagram → a typed empty state.
 *   commitDiagramEdit   → run the current canvas model through the SINGLE commit
 *                         pipeline (lib/diagram/commit: validate → persist a new
 *                         immutable version). The human is the sole committer.
 *   listPendingEdits    → the account's PENDING proposals on the active diagram,
 *                         shaped for the overlay; the client polls this (no WS).
 *
 * Invariants upheld here:
 *   - One committer: saves route through `getCommitPipeline().commit`; there is no
 *     second persist path. Accepted proposals share that same pipeline.
 *   - Account from the SESSION (`requireUser`), never from the request body —
 *     tenant isolation. The diagram + proposal services re-check ownership.
 *   - Server is the single source of truth: every read/write goes through the
 *     diagram / scoping / proposal services over canonical Postgres state.
 *
 * Thin adapters: resolve account + active diagram → call lib services → return a
 * typed result. All decision/validation logic lives in lib (imported, never
 * edited).
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { getDiagramService, DiagramError } from "@/lib/diagram";
import {
  getCommitPipeline,
  CommitBlockedError,
} from "@/lib/diagram/commit";
import { getScopingService } from "@/lib/scoping";
import {
  EMPTY_PLACEMENT_MODEL,
  placementModelToEdit,
  snapshotToPlacementModel,
  type PlacementModel,
} from "@/components/canvas/placement-model";

/** What `/editor` needs to render the canvas: the active diagram's identity and
 * its latest committed model, or `null` when the account has no active diagram. */
export interface ActiveDiagramView {
  readonly diagramId: string;
  readonly name: string;
  /** Latest committed version id, or null for a diagram with no saved version. */
  readonly versionId: string | null;
  /** Committed placement model rebuilt from canonical state. */
  readonly model: PlacementModel;
}

/** Result of loading the active diagram: the view, or no-active-diagram. */
export type LoadActiveDiagramResult =
  | { readonly status: "ok"; readonly diagram: ActiveDiagramView }
  | { readonly status: "no-active-diagram" };

/** Result of committing a manual edit through the single pipeline. */
export type CommitEditResult =
  | { readonly status: "ok"; readonly versionId: string }
  | { readonly status: "no-active-diagram" }
  | {
      readonly status: "error";
      /** What happened + how to fix (CLAUDE.md). */
      readonly message: string;
      /** Per-element validation messages, when the commit was gate-blocked. */
      readonly validationErrors?: readonly string[];
    };

/**
 * Resolve the signed-in account's ACTIVE diagram and load its latest immutable
 * version's canonical scene + metadata as a placement model (metadata re-attached
 * by element id — `customData` is dropped, CLAUDE.md fact #1). Returns
 * `no-active-diagram` when the account hasn't selected one — the editor renders an
 * empty state linking to /diagrams.
 */
export async function loadActiveDiagram(): Promise<LoadActiveDiagramResult> {
  const user = await requireUser();
  const active = await getScopingService().getActiveDiagram(user.accountId);
  if (active === null) {
    return { status: "no-active-diagram" };
  }

  const { versions } = await getDiagramService().open({
    accountId: user.accountId,
    diagramId: active.id,
  });
  const latest = versions[0];

  if (latest === undefined) {
    return {
      status: "ok",
      diagram: {
        diagramId: active.id,
        name: active.name,
        versionId: null,
        model: EMPTY_PLACEMENT_MODEL,
      },
    };
  }

  const snapshot = await getDiagramService().restoreVersion({
    accountId: user.accountId,
    diagramId: active.id,
    versionId: latest.id,
  });

  return {
    status: "ok",
    diagram: {
      diagramId: active.id,
      name: active.name,
      versionId: snapshot.version.id,
      model: snapshotToPlacementModel(snapshot),
    },
  };
}

/**
 * Commit the current canvas model as a new immutable version of the account's
 * active diagram, through the SINGLE commit pipeline (validate → persist). The
 * model comes from the browser; the account + active diagram from the session.
 *
 * Validation failures are surfaced to the user (what failed + how to fix) rather
 * than thrown — a blocked commit persists nothing (architecture invariant).
 */
export async function commitDiagramEdit(
  model: PlacementModel,
): Promise<CommitEditResult> {
  const user = await requireUser();
  const active = await getScopingService().getActiveDiagram(user.accountId);
  if (active === null) {
    return { status: "no-active-diagram" };
  }

  try {
    const { snapshot } = await getCommitPipeline().commit({
      accountId: user.accountId,
      diagramId: active.id,
      edit: placementModelToEdit(model),
    });
    // The new committed version is canonical; the editor re-reads from it.
    revalidatePath("/editor");
    return { status: "ok", versionId: snapshot.version.id };
  } catch (err) {
    return commitErrorResult(err);
  }
}

/** Map a commit failure to a user-facing result (what happened + how to fix). */
function commitErrorResult(err: unknown): CommitEditResult {
  if (err instanceof CommitBlockedError) {
    return {
      status: "error",
      message: err.message,
      validationErrors: err.report.errors.map((e) => e.message),
    };
  }
  if (err instanceof DiagramError) {
    return { status: "error", message: err.message };
  }
  throw err;
}
