"use client";

/**
 * Pending-proposal polling hook (this task: proposals via POLLING, not WebSocket).
 *
 * WebSocket is not available on Vercel serverless, so the browser POLLS the
 * `listPendingProposals` server action on a fixed interval to surface Claude's
 * staged proposals (CLAUDE.md: server is the single source of truth — the client
 * never invents proposal state, it re-reads canonical state). The poll is a thin
 * loop around the server action; all listing/scoping logic lives server-side.
 *
 * The hook owns only the polling lifecycle + the latest fetched list; it does not
 * decide proposals (Accept/Reject route through `proposal-actions.ts`). A manual
 * `refresh()` is exposed so a decision can immediately re-pull canonical state
 * instead of waiting for the next tick.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingProposalView } from "@/app/(canvas)/proposal-actions";

/** What the editor needs from the poll: the current pending list + a refresher. */
export interface UsePendingProposalsResult {
  readonly proposals: readonly PendingProposalView[];
  /** Re-pull immediately (e.g. right after an accept/reject decision). */
  readonly refresh: () => Promise<void>;
}

/** The server action the hook polls (injected so the hook stays testable). */
export type ListPendingProposals = () => Promise<{
  activeDiagramId: string | null;
  proposals: PendingProposalView[];
}>;

/** Default poll cadence (ms): inside the 3–5s window this task calls for. */
const DEFAULT_INTERVAL_MS = 4000;

export function usePendingProposals(
  listPending: ListPendingProposals,
  options: { readonly intervalMs?: number; readonly enabled?: boolean } = {},
): UsePendingProposalsResult {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = options;
  const [proposals, setProposals] = useState<readonly PendingProposalView[]>([]);

  // Keep the latest action in a ref so the polling effect does not re-subscribe
  // when the (server-action) function identity changes between renders. Sync in
  // an effect (never during render).
  const listRef = useRef(listPending);
  useEffect(() => {
    listRef.current = listPending;
  }, [listPending]);

  const refresh = useCallback(async () => {
    const result = await listRef.current();
    setProposals(result.proposals);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const result = await listRef.current();
        if (!cancelled) {
          setProposals(result.proposals);
        }
      } catch {
        // A transient poll failure must not crash the editor; the next tick
        // retries. (The known Ubuntu/Vercel stream-timeout class — retry, not
        // re-plan.) Keep the last good list on screen meanwhile.
      }
    };

    void tick();
    const handle = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [enabled, intervalMs]);

  return { proposals, refresh };
}
