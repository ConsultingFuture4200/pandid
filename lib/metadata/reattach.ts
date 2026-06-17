/**
 * Re-attach element metadata after `convertToExcalidrawElements` (DEV-1136, FR-14).
 *
 * CLAUDE.md fact #1: `convertToExcalidrawElements` DROPS `customData`. Equipment
 * metadata therefore never survives on the Excalidraw element; it lives in the
 * parallel store keyed by element `id`. This module is the join: given the
 * converted elements (post-`customData`-drop) and the metadata records for the
 * version, it pairs each element with its metadata by `id`.
 *
 * It deliberately does NOT write metadata back onto the element's `customData`:
 * that would be dropped again on the next conversion and would create a second
 * copy of the truth. The store stays the single source of truth (CLAUDE.md
 * invariant); callers read the pairing, they never persist it back onto the scene.
 *
 * No dependency on `@excalidraw/excalidraw` here — the canvas mount (DEV-1137)
 * owns that. We model only the minimal element shape (`id`, optional `customData`)
 * the round-trip touches, so this primitive is testable without the canvas.
 */
import type { ElementMetadata } from "@/lib/types";

/**
 * Minimal view of an Excalidraw element this layer touches: a stable `id` and an
 * optional `customData` bag. The real element type (DEV-1137) is a superset.
 */
export interface ElementLike {
  readonly id: string;
  /** Present on inputs to conversion; ALWAYS dropped by conversion (fact #1). */
  readonly customData?: Record<string, unknown>;
}

/** An element paired with its metadata from the parallel store (null if none). */
export interface ElementWithMetadata<T extends ElementLike = ElementLike> {
  readonly element: T;
  readonly metadata: ElementMetadata | null;
}

/**
 * Simulate the lossy `convertToExcalidrawElements` behaviour for the one property
 * this task cares about: `customData` is stripped. Used by the round-trip test to
 * prove metadata survives via the store rather than via `customData`, and usable
 * by callers that need to model the drop deterministically.
 */
export function stripCustomData<T extends ElementLike>(
  elements: readonly T[],
): Array<Omit<T, "customData">> {
  return elements.map((element) => {
    // Structurally remove customData; everything else passes through unchanged.
    const copy = { ...element } as Record<string, unknown>;
    delete copy.customData;
    return copy as Omit<T, "customData">;
  });
}

/** Index metadata records by element id for O(1) re-attach lookups. */
export function indexByElementId(
  records: readonly ElementMetadata[],
): Map<string, ElementMetadata> {
  const byId = new Map<string, ElementMetadata>();
  for (const record of records) {
    byId.set(record.elementId, record);
  }
  return byId;
}

/**
 * Re-attach metadata to converted elements by `id`.
 *
 * @param elements converted Excalidraw elements (customData already dropped).
 * @param records  the version's metadata records from the parallel store.
 * @returns each element paired with its metadata (or null when none is stored).
 */
export function reattachMetadata<T extends ElementLike>(
  elements: readonly T[],
  records: readonly ElementMetadata[],
): Array<ElementWithMetadata<T>> {
  const byId = indexByElementId(records);
  return elements.map((element) => ({
    element,
    metadata: byId.get(element.id) ?? null,
  }));
}
