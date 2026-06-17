// Connect — rebind on move/delete (DEV-1139 / task 10b, FR-3).
//
// DEV-1138 (connection-binding.ts) computes the INITIAL bound arrow when a
// connection is drawn. This module owns what happens to that bound connection
// afterwards, when an endpoint element is MOVED or DELETED. Like its sibling it
// is a pure, deterministic, browser-free adapter: no Excalidraw runtime, no I/O,
// no state. The live binding on a real mount belongs to Playwright once the
// editor exposes connection-drawing UI; these functions own the geometry +
// cascade decisions that the canvas and the commit pipeline (DEV-1140) apply.
//
// Two operations, matching the two acceptance criteria:
//
//   1. rebindOnMove — FR-3 "connections ... follow them when moved". When an
//      endpoint element's placement changes, the connection's geometry must
//      track it. We re-derive the bound arrow from the element's NEW placement
//      by returning an updated ConnectionRequest; passing it back through
//      buildBoundConnection yields the re-anchored, re-pointed arrow. The
//      binding (start.id / end.id) is unchanged — the arrow stays bound to the
//      same elements; only the port coordinates move. This is why "follow" is
//      correct rather than "re-bind to a different element".
//
//   2. rebindOnDelete — deleting an element must not leave a half-bound
//      connection. The validator's endpoint-binding rule (DEV-1133) fails any
//      connection whose endpoint no longer references a real element, so the
//      only validator-clean resolution is to CASCADE: remove every connection
//      bound to the deleted element on either end. We return the kept
//      connections plus the removed ids so the caller (commit pipeline) can drop
//      the corresponding arrows + metadata in the same commit.
//
// IMPORTANT (CLAUDE.md fact #1): no equipment metadata rides on the arrow; that
// lives in the parallel metadata store (DEV-1136). This layer touches only the
// geometric edge and the cascade decision.

import type { Connection } from "@/lib/types/connection";
import type { ConnectionEndpoint, ConnectionRequest } from "./connection-binding";

/** A new placement for an element that has moved (its top-left scene anchor). */
export interface ElementMove {
  /** Excalidraw scene element id that moved. */
  readonly elementId: string;
  /** New scene-space x of the placement box top-left. */
  readonly x: number;
  /** New scene-space y of the placement box top-left. */
  readonly y: number;
}

/** Outcome of resolving a delete against a set of connections. */
export interface DeleteResolution {
  /** Connections that survive the delete (both endpoints still real). */
  readonly keptConnections: readonly Connection[];
  /** Ids of connections cascaded out because they bound the deleted element. */
  readonly removedConnectionIds: readonly string[];
}

/** Apply a move to one endpoint if it references the moved element. */
function moveEndpoint(
  endpoint: ConnectionEndpoint,
  move: ElementMove,
): ConnectionEndpoint {
  if (endpoint.element.elementId !== move.elementId) {
    return endpoint;
  }
  return {
    ...endpoint,
    element: { ...endpoint.element, x: move.x, y: move.y },
  };
}

/**
 * Re-derive a bound connection after one of its endpoint elements has moved.
 *
 * Returns an updated `ConnectionRequest` reflecting the element's new placement;
 * pass it back through `buildBoundConnection` to get the re-anchored, re-pointed
 * arrow. The binding stays on the same elements (FR-3: the connection FOLLOWS
 * the element, it does not rebind to a different one). If the move targets an
 * element this connection is not bound to, the request is returned unchanged.
 *
 * Pure: never mutates the input request.
 */
export function rebindOnMove(
  request: ConnectionRequest,
  move: ElementMove,
): ConnectionRequest {
  const source = moveEndpoint(request.source, move);
  const target = moveEndpoint(request.target, move);
  if (source === request.source && target === request.target) {
    // Nothing on this connection references the moved element — no-op.
    return request;
  }
  return { ...request, source, target };
}

/**
 * Resolve the deletion of an element against a set of connections.
 *
 * Cascades: any connection with the deleted element as its source OR target is
 * removed, because a half-bound connection is an orphan the validator rejects
 * (DEV-1133 endpoint-binding rule). Returns the kept connections (input order
 * preserved) and the ids of the removed ones so the caller can drop matching
 * arrows + metadata in the same commit.
 *
 * Pure: never mutates the input list.
 */
export function rebindOnDelete(
  connections: readonly Connection[],
  deletedElementId: string,
): DeleteResolution {
  const keptConnections: Connection[] = [];
  const removedConnectionIds: string[] = [];

  for (const connection of connections) {
    const bindsDeleted =
      connection.sourceElementId === deletedElementId ||
      connection.targetElementId === deletedElementId;
    if (bindsDeleted) {
      removedConnectionIds.push(connection.elementId);
    } else {
      keptConnections.push(connection);
    }
  }

  return { keptConnections, removedConnectionIds };
}
