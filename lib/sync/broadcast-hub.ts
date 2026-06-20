/**
 * Server-side broadcast hub for whole-scene sync (DEV-1151 [12a], PRD §4).
 *
 * The sending half of server-authoritative sync. The server is the single
 * source of truth; the hub is the per-diagram fan-out that, on every committed
 * change, pushes the new canonical scene to every session subscribed to that
 * diagram. Both kinds of commit broadcast through here — a manual edit
 * (DEV-1140) and an accepted proposal (DEV-1144) — because both flow through the
 * one commit pipeline (CLAUDE.md: one committer), and the pipeline's caller
 * publishes the resulting version's scene to the hub. There is no second
 * broadcast path.
 *
 * Transport-agnostic by design: a subscriber is just a `(SceneBroadcast) => void`
 * sink. The WebSocket route (app/api/ws — DEV-1152's transport) registers a sink
 * that serializes the frame onto a socket; this module knows nothing about
 * sockets, so the fan-out logic is unit-testable without a live connection.
 *
 * Concurrency model: this matches the Node single-threaded event loop. `publish`
 * snapshots the subscriber set before delivering, so a sink that subscribes or
 * unsubscribes during delivery does not perturb the in-flight fan-out. A sink
 * that throws is isolated: it is dropped and the remaining sinks still receive
 * the frame (one dead socket must not stall the others).
 *
 * Scope note: this is whole-scene broadcast only. The in-progress-edit guard
 * (suppress applying a broadcast while a session is mid-edit) is DEV-1152 and
 * sits in front of the per-session sink, not inside the hub.
 */
import { sceneBroadcastSchema, type SceneBroadcast } from "./types";

/** A transport sink: receives a frame and delivers it to one session's socket. */
export type BroadcastSink = (broadcast: SceneBroadcast) => void;

/** Unsubscribe handle returned by {@link BroadcastHub.subscribe}. Idempotent. */
export type Unsubscribe = () => void;

/**
 * Per-diagram publish/subscribe of whole-scene broadcasts. One hub instance is
 * shared process-wide (see {@link getBroadcastHub}); diagrams are isolated by
 * key, so a publish to diagram A never reaches a subscriber on diagram B
 * (tenant/diagram isolation at the transport layer).
 */
export class BroadcastHub {
  /** diagramId → set of session sinks subscribed to that diagram. */
  private readonly channels = new Map<string, Set<BroadcastSink>>();

  /**
   * Subscribe a session sink to a diagram's broadcasts. Returns an idempotent
   * unsubscribe; calling it more than once is safe and removes the sink once.
   */
  subscribe(diagramId: string, sink: BroadcastSink): Unsubscribe {
    let sinks = this.channels.get(diagramId);
    if (sinks === undefined) {
      sinks = new Set<BroadcastSink>();
      this.channels.set(diagramId, sinks);
    }
    sinks.add(sink);
    return () => {
      const current = this.channels.get(diagramId);
      if (current === undefined) {
        return;
      }
      current.delete(sink);
      if (current.size === 0) {
        this.channels.delete(diagramId);
      }
    };
  }

  /**
   * Broadcast a canonical scene to every session on its diagram. Validates the
   * frame at the boundary (Zod) so a malformed scene never reaches a socket, and
   * delivers to a snapshot of the subscriber set so concurrent (un)subscribes
   * during delivery are safe. A throwing sink is dropped, not propagated.
   *
   * @returns the number of sinks the frame was delivered to (0 if no session is
   *   currently viewing this diagram — a normal, non-error case).
   */
  publish(broadcast: SceneBroadcast): number {
    const frame = sceneBroadcastSchema.parse(broadcast);
    const sinks = this.channels.get(frame.diagramId);
    if (sinks === undefined || sinks.size === 0) {
      return 0;
    }
    // Snapshot so a sink that (un)subscribes mid-delivery can't mutate the loop.
    let delivered = 0;
    for (const sink of [...sinks]) {
      try {
        sink(frame);
        delivered += 1;
      } catch {
        // A dead/throwing socket is isolated: drop it, keep delivering. Its own
        // close handler will unsubscribe it; we defensively remove it here too.
        sinks.delete(sink);
      }
    }
    return delivered;
  }

  /** Number of sessions currently subscribed to a diagram (for diagnostics/tests). */
  subscriberCount(diagramId: string): number {
    return this.channels.get(diagramId)?.size ?? 0;
  }
}

let cachedHub: BroadcastHub | null = null;

/**
 * The process-wide broadcast hub. The commit publisher and the WebSocket route
 * resolve the same instance so a commit's scene reaches the live subscribers.
 */
export function getBroadcastHub(): BroadcastHub {
  cachedHub ??= new BroadcastHub();
  return cachedHub;
}
