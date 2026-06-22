"use server";

/**
 * Pending-proposal canvas-UI server actions (DEV-1153, PRD §5.2 step 6, FR-10).
 *
 * The browser surface for propose-and-confirm: list the account's pending
 * proposals on its ACTIVE diagram, then Accept (commit) or Reject (discard) one.
 *
 * Architecture invariants (CLAUDE.md) upheld here:
 *   - One committer / proposals staged-never-applied. Accept routes through
 *     `ProposalService.accept`, which re-validates and commits through the SINGLE
 *     commit pipeline; Reject through `.reject`, which commits nothing. This action
 *     layer never persists a version itself — there is no second path.
 *   - Server is the single source of truth. The committed scene shown under the
 *     proposal (the diff's "committed" side) is read from the diagram's latest
 *     immutable version, never from the browser canvas.
 *   - Tenant isolation. The account is taken from the SESSION (`requireUser`),
 *     never from the request body; the lifecycle + diagram services enforce that
 *     a proposal/diagram belongs to that account before it is read or decided.
 *   - Account-scoped to the active diagram (PRD §3 step 2). Proposals are decided
 *     on whatever diagram is active for the account, mirroring the MCP connector.
 *
 * Thin adapter: resolve account + active diagram → call the lifecycle / diagram
 * services → revalidate the editor. All decision logic lives in the lifecycle.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { getDiagramService } from "@/lib/diagram";
import { getProposalService } from "@/lib/proposals";
import { DiagramServiceActiveSource } from "@/lib/mcp-tools";
import { createMaterializeEdit } from "@/lib/mcp-tools/propose-index";
import { getScopingService, ScopingError } from "@/lib/scoping";
import { ProposalError } from "@/lib/proposals";
import { CommitBlockedError } from "@/lib/diagram/commit";
import type { JsonObject } from "@/lib/types";
import {
  diffProposal,
  type CommittedSceneInput,
  type ProposalDiff,
  type StagedChangeInput,
} from "@/components/proposal-review/proposal-diff";

/** A pending proposal as the canvas UI needs it: id + the precomputed diff that
 * tells the overlay what to draw normally vs ghosted (FR-10). */
export interface PendingProposalView {
  readonly proposalId: string;
  readonly createdAt: string;
  readonly diff: ProposalDiff;
}

/** Result surfaced back to the proposal panel after a decision. */
export interface ProposalDecisionState {
  readonly error?: string;
  readonly accepted?: boolean;
  readonly rejected?: boolean;
}

/** The empty committed scene used before any version exists (a brand-new diagram
 * with a first proposal is "nothing committed yet", not an error). */
const EMPTY_COMMITTED: CommittedSceneInput = {
  scene: {},
  tagByElementId: new Map(),
};

/**
 * Resolve the signed-in account's active diagram and ITS pending proposals, each
 * paired with the committed-vs-proposed diff the overlay renders. Returns no
 * active diagram (`null`) when the account hasn't selected one yet.
 */
export async function listPendingProposals(): Promise<{
  activeDiagramId: string | null;
  proposals: PendingProposalView[];
}> {
  const user = await requireUser();
  const active = await getScopingService().getActiveDiagram(user.accountId);
  if (active === null) {
    return { activeDiagramId: null, proposals: [] };
  }

  const committed = await resolveCommittedScene(user.accountId, active.id);
  const pending = await getProposalService().listPending({
    accountId: user.accountId,
    diagramId: active.id,
  });

  const proposals = pending.map<PendingProposalView>((proposal) => ({
    proposalId: proposal.id,
    createdAt: proposal.createdAt,
    diff: diffProposal(committed, readStagedChange(proposal.stagedChange)),
  }));

  return { activeDiagramId: active.id, proposals };
}

/**
 * Accept a pending proposal (FR-10): re-validate + commit the staged edit through
 * the single commit pipeline. The proposal id comes from the form; the account +
 * active diagram from the session.
 */
export async function acceptProposalAction(
  _prev: ProposalDecisionState,
  formData: FormData,
): Promise<ProposalDecisionState> {
  const ctx = await resolveDecisionContext(formData);
  if ("error" in ctx) {
    return { error: ctx.error };
  }

  try {
    // Wire the accept-time materializer so the proposal's stored DELTA is re-applied
    // to CURRENT committed state on accept — accepting one proposal never clobbers
    // another already-committed one (the human is the committer here, so the
    // no-clobber path must be wired on THIS browser action, not just the MCP one).
    await acceptingProposalService().accept({
      accountId: ctx.accountId,
      diagramId: ctx.diagramId,
      proposalId: ctx.proposalId,
    });
  } catch (err) {
    return { error: decisionErrorMessage(err) };
  }

  revalidatePath("/editor");
  return { accepted: true };
}

/**
 * Reject a pending proposal (FR-10): discard it. Commits nothing — canonical
 * state is untouched.
 */
export async function rejectProposalAction(
  _prev: ProposalDecisionState,
  formData: FormData,
): Promise<ProposalDecisionState> {
  const ctx = await resolveDecisionContext(formData);
  if ("error" in ctx) {
    return { error: ctx.error };
  }

  try {
    await getProposalService().reject({
      accountId: ctx.accountId,
      diagramId: ctx.diagramId,
      proposalId: ctx.proposalId,
    });
  } catch (err) {
    return { error: decisionErrorMessage(err) };
  }

  revalidatePath("/editor");
  return { rejected: true };
}

// ── internals ────────────────────────────────────────────────────────────────

/** The proposal service for the ACCEPT path: wired with the no-clobber accept
 * materializer (re-apply the stored op to current committed state). Read/list/reject
 * use the plain `getProposalService()` — only accept needs the materializer. */
function acceptingProposalService(): ReturnType<typeof getProposalService> {
  const source = new DiagramServiceActiveSource(getDiagramService());
  return getProposalService(createMaterializeEdit(source));
}

/** Resolved decision context (account from session + active diagram + proposal id),
 * or a user-facing error string when the request can't be scoped. */
type DecisionContext =
  | { readonly accountId: string; readonly diagramId: string; readonly proposalId: string }
  | { readonly error: string };

async function resolveDecisionContext(
  formData: FormData,
): Promise<DecisionContext> {
  const user = await requireUser();
  const proposalId = String(formData.get("proposalId") ?? "");
  if (proposalId.length === 0) {
    return { error: "No proposal was specified to decide." };
  }
  const active = await getScopingService().getActiveDiagram(user.accountId);
  if (active === null) {
    return {
      error:
        "No active diagram. Open or select a diagram in the editor before " +
        "accepting or rejecting a proposal.",
    };
  }
  return { accountId: user.accountId, diagramId: active.id, proposalId };
}

/** Map a lifecycle/commit failure to a user-facing message (what happened + how
 * to fix — CLAUDE.md). Re-throws anything unexpected. */
function decisionErrorMessage(err: unknown): string {
  if (err instanceof CommitBlockedError) {
    // The canonical diagram drifted since staging and the edit no longer
    // validates; the proposal is now decided and nothing was committed.
    return err.message;
  }
  if (err instanceof ProposalError || err instanceof ScopingError) {
    return err.message;
  }
  throw err;
}

/**
 * Read the committed scene (the diff's "already on canvas" side) from the
 * diagram's latest immutable version: the scene JSON + an element-id→tag map from
 * the parallel metadata store. An unsaved diagram projects to the empty committed
 * scene.
 */
async function resolveCommittedScene(
  accountId: string,
  diagramId: string,
): Promise<CommittedSceneInput> {
  const { versions } = await getDiagramService().open({ accountId, diagramId });
  const latest = versions[0];
  if (latest === undefined) {
    return EMPTY_COMMITTED;
  }
  const snapshot = await getDiagramService().restoreVersion({
    accountId,
    diagramId,
    versionId: latest.id,
  });
  const tagByElementId = new Map<string, string>();
  for (const meta of snapshot.metadata) {
    const tag = meta.attributes.tag;
    if (typeof tag === "string" && tag.trim().length > 0) {
      tagByElementId.set(meta.elementId, tag.trim());
    }
  }
  return { scene: snapshot.version.excalidrawScene, tagByElementId };
}

/** Read a proposal's `staged_change` JSON into the diff's staged input shape. The
 * row was written from a validated edit (`{ edit: DiagramEdit }`); a malformed row
 * projects to an empty staged change (nothing proposed) rather than throwing. */
function readStagedChange(stagedChange: JsonObject): StagedChangeInput {
  const edit = (stagedChange as { edit?: unknown }).edit;
  if (edit === null || typeof edit !== "object") {
    return { scene: {}, elements: [] };
  }
  const e = edit as { scene?: unknown; elements?: unknown };
  const scene =
    e.scene !== null && typeof e.scene === "object" ? (e.scene as JsonObject) : {};
  const elements = Array.isArray(e.elements)
    ? e.elements.flatMap((el) =>
        el !== null &&
        typeof el === "object" &&
        typeof (el as { id?: unknown }).id === "string"
          ? [
              {
                id: (el as { id: string }).id,
                attributes:
                  (el as { attributes?: unknown }).attributes !== null &&
                  typeof (el as { attributes?: unknown }).attributes === "object"
                    ? ((el as { attributes: JsonObject }).attributes)
                    : {},
              },
            ]
          : [],
      )
    : [];
  return { scene, elements };
}
