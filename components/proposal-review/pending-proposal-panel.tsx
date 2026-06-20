"use client";

/**
 * Pending-proposal canvas UI (DEV-1153, PRD §5.2 step 6, FR-10).
 *
 * When Claude stages a proposal, the browser shows it "visually distinct" from
 * committed elements with Accept/Reject controls. This panel renders, for each
 * pending proposal, the overlay preview (committed diagram + the proposal's
 * additions ghosted) and the two decision buttons.
 *
 *   - Accept → `acceptProposalAction`: re-validate + commit via the single commit
 *     pipeline (the human is the sole committer — CLAUDE.md).
 *   - Reject → `rejectProposalAction`: discard; nothing commits.
 *
 * The overlay SVG is produced ON THE SERVER-equivalent pure renderer
 * (`renderProposalOverlay`) from the precomputed diff — deterministic, no
 * Excalidraw runtime — so what the human sees here matches the golden fixtures and
 * (on accept) the committed canvas. This component injects the SVG markup it owns
 * (built from validated canonical state, not user free-text), never arbitrary HTML.
 *
 * Client component: drives the accept/reject server actions via `useActionState`
 * and surfaces typed errors. All decision logic lives server-side in the proposal
 * lifecycle; this is the surface only.
 */
import { useActionState } from "react";
import { renderProposalOverlay } from "./proposal-overlay";
import type { ProposalDiff } from "./proposal-diff";

/** One pending proposal to render: its id and the committed-vs-proposed diff. */
export interface PendingProposalItem {
  readonly proposalId: string;
  readonly createdAt: string;
  readonly diff: ProposalDiff;
}

/** The accept/reject server-action signature (state in, state out). */
export interface ProposalDecisionState {
  readonly error?: string;
  readonly accepted?: boolean;
  readonly rejected?: boolean;
}

type DecisionAction = (
  prev: ProposalDecisionState,
  formData: FormData,
) => Promise<ProposalDecisionState>;

interface PendingProposalPanelProps {
  readonly proposals: readonly PendingProposalItem[];
  readonly acceptAction: DecisionAction;
  readonly rejectAction: DecisionAction;
}

const INITIAL: ProposalDecisionState = {};

export function PendingProposalPanel({
  proposals,
  acceptAction,
  rejectAction,
}: PendingProposalPanelProps) {
  if (proposals.length === 0) {
    return (
      <section
        aria-label="Pending proposals"
        data-testid="pending-proposals-empty"
        className="border-t p-4 text-sm text-gray-500"
      >
        No pending proposals. When Claude proposes a change, it appears here for
        you to accept or reject.
      </section>
    );
  }

  return (
    <section
      aria-label="Pending proposals"
      data-testid="pending-proposals"
      className="flex flex-col gap-4 border-t p-4"
    >
      <h2 className="text-sm font-semibold">
        Pending proposal{proposals.length > 1 ? "s" : ""} ({proposals.length})
      </h2>
      {proposals.map((proposal) => (
        <PendingProposalCard
          key={proposal.proposalId}
          proposal={proposal}
          acceptAction={acceptAction}
          rejectAction={rejectAction}
        />
      ))}
    </section>
  );
}

function PendingProposalCard({
  proposal,
  acceptAction,
  rejectAction,
}: {
  readonly proposal: PendingProposalItem;
  readonly acceptAction: DecisionAction;
  readonly rejectAction: DecisionAction;
}) {
  const [acceptState, accept, accepting] = useActionState(acceptAction, INITIAL);
  const [rejectState, reject, rejecting] = useActionState(rejectAction, INITIAL);
  const busy = accepting || rejecting;
  const error = acceptState.error ?? rejectState.error;

  // The proposal's count of new elements, for a one-line human summary.
  const addedCount =
    proposal.diff.proposedEquipment.length +
    proposal.diff.proposedConnections.length;

  // Preview the proposal in "pending" mode: committed normal + additions ghosted.
  const previewSvg = renderProposalOverlay(proposal.diff, "pending");

  return (
    <article
      data-testid="pending-proposal"
      data-proposal-id={proposal.proposalId}
      className="rounded border border-blue-300 bg-blue-50/40 p-3"
    >
      <p className="mb-2 text-xs text-blue-800">
        Claude proposes adding {addedCount} element{addedCount === 1 ? "" : "s"}.
        Review the highlighted change, then accept or reject.
      </p>
      <div
        className="mb-3 overflow-hidden rounded border bg-white"
        // Owned, validated SVG markup (canonical state + the staged edit), not
        // user free-text; the renderer XML-escapes tag labels.
        dangerouslySetInnerHTML={{ __html: previewSvg }}
      />
      {error !== undefined ? (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <form action={accept}>
          <input type="hidden" name="proposalId" value={proposal.proposalId} />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {accepting ? "Accepting…" : "Accept"}
          </button>
        </form>
        <form action={reject}>
          <input type="hidden" name="proposalId" value={proposal.proposalId} />
          <button
            type="submit"
            disabled={busy}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
          >
            {rejecting ? "Rejecting…" : "Reject"}
          </button>
        </form>
      </div>
    </article>
  );
}
