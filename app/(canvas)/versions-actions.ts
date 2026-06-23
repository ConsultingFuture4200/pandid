"use server";

/**
 * Version-history server actions (DEV-1159 / SC-6).
 *
 * The editor's Versions panel lists a diagram's immutable versions and restores a
 * prior one. "Restore" follows the DiagramService contract: it reads the chosen
 * snapshot's EXACT scene + metadata and re-saves it as a NEW version — prior
 * versions stay immutable, and the restored one becomes current (SC-6).
 *
 * Account from the session (tenant isolation); the active diagram from scoping —
 * never from the request body.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { getDiagramService } from "@/lib/diagram";
import { getScopingService } from "@/lib/scoping";
import { publishDiagramChange } from "@/lib/realtime/publish";

/** One version row for the panel. */
export interface VersionRow {
  readonly id: string;
  readonly createdAt: string;
}

/** List the active diagram's versions, newest first. Empty when no active diagram. */
export async function listVersionsAction(): Promise<{
  readonly versions: VersionRow[];
}> {
  const user = await requireUser();
  const active = await getScopingService().getActiveDiagram(user.accountId);
  if (active === null) {
    return { versions: [] };
  }
  const versions = await getDiagramService().listVersions({
    accountId: user.accountId,
    diagramId: active.id,
  });
  return {
    versions: versions.map((v) => ({ id: v.id, createdAt: v.createdAt })),
  };
}

/** Result of a restore. */
export interface RestoreResult {
  readonly status: "ok" | "no-active-diagram" | "error";
  readonly message?: string;
}

/**
 * Restore a prior version: re-save its exact scene + metadata as a new current
 * version (SC-6). The prior versions are untouched (immutable).
 */
export async function restoreVersionAction(
  versionId: string,
): Promise<RestoreResult> {
  const user = await requireUser();
  const active = await getScopingService().getActiveDiagram(user.accountId);
  if (active === null) {
    return { status: "no-active-diagram" };
  }
  try {
    const svc = getDiagramService();
    const snapshot = await svc.restoreVersion({
      accountId: user.accountId,
      diagramId: active.id,
      versionId,
    });
    await svc.save({
      accountId: user.accountId,
      diagramId: active.id,
      save: {
        excalidrawScene: snapshot.version.excalidrawScene,
        // Re-persist the exact metadata (drop the prior version id; a new one is
        // assigned to the new version).
        metadata: snapshot.metadata.map((m) => ({
          elementId: m.elementId,
          equipmentType: m.equipmentType,
          attributes: m.attributes,
        })),
      },
    });
    await publishDiagramChange(active.id);
    revalidatePath("/editor");
    return { status: "ok" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Restore failed.",
    };
  }
}
