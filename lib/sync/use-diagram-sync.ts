"use client";

/**
 * Browser-side sync hook (DEV-1151 [12a], PRD §4).
 *
 * The thin React/WebSocket adapter over the pure {@link applyBroadcast} reducer.
 * It opens a WebSocket subscribed to one diagram, validates each inbound frame at
 * the boundary (Zod), reduces it onto local {@link SyncState}, and exposes the
 * applied canonical scene so the canvas can `updateScene` when it changes. All
 * convergence/idempotency logic lives in the (tested, DOM-free) reducer; this
 * hook is just transport + React state, so it carries no logic worth a unit test
 * that the reducer does not already cover.
 *
 * Server-authoritative: the hook never sends scene mutations up this socket — it
 * only receives whole-scene broadcasts (the server is the single source of
 * truth). Manual edits commit via the commit pipeline / server actions and come
 * back as a broadcast like any other change. The in-progress-edit guard (do not
 * clobber a session mid-edit) is DEV-1152 and wraps the `onScene` callback; this
 * hook deliberately applies every newer broadcast so that guard is additive.
 */
import { useEffect, useRef, useState } from "react";
import { applyBroadcast } from "./apply";
import { sceneBroadcastSchema, EMPTY_SYNC_STATE, type SyncState } from "./types";
import type { JsonObject } from "@/lib/types";

/** Options for {@link useDiagramSync}. */
export interface UseDiagramSyncOptions {
  /** The diagram to subscribe to (the broadcast channel). */
  readonly diagramId: string;
  /** WebSocket URL serving this diagram's broadcasts. */
  readonly url: string;
  /**
   * Called with the new canonical scene whenever an applied broadcast changes
   * it. The canvas wires this to `updateScene`. Not called for duplicate or
   * off-channel frames.
   */
  readonly onScene?: (scene: JsonObject) => void;
}

/** What {@link useDiagramSync} exposes to the canvas. */
export interface DiagramSync {
  /** The version id of the currently-applied scene (null until first apply). */
  readonly versionId: string | null;
  /** The currently-applied canonical scene (null until first apply). */
  readonly scene: JsonObject | null;
}

/**
 * Subscribe to a diagram's whole-scene broadcasts and apply them locally.
 *
 * Returns the applied scene/version as React state. Reconnect/backoff is left to
 * the platform WebSocket and DEV-1152's transport hardening; this hook keeps the
 * apply contract minimal and correct.
 */
export function useDiagramSync(options: UseDiagramSyncOptions): DiagramSync {
  const { diagramId, url, onScene } = options;
  const [state, setState] = useState<SyncState>(EMPTY_SYNC_STATE);
  // Keep the latest onScene without re-opening the socket when it changes.
  const onSceneRef = useRef(onScene);
  useEffect(() => {
    onSceneRef.current = onScene;
  }, [onScene]);

  useEffect(() => {
    const socket = new WebSocket(url);
    socket.addEventListener("message", (event) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return; // ignore non-JSON noise on the socket
      }
      const parsed = sceneBroadcastSchema.safeParse(frame);
      if (!parsed.success) {
        return; // ignore frames that are not whole-scene broadcasts
      }
      setState((prior) => {
        const result = applyBroadcast(diagramId, prior, parsed.data);
        if (result.applied) {
          onSceneRef.current?.(parsed.data.scene);
        }
        return result.state;
      });
    });
    return () => {
      socket.close();
    };
  }, [diagramId, url]);

  return { versionId: state.versionId, scene: state.scene };
}
