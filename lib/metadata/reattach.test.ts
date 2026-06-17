import { describe, expect, it } from "vitest";
import type { ElementMetadata } from "@/lib/types";
import { InMemoryElementMetadataRepository } from "./in-memory-repository";
import { ElementMetadataStore } from "./store";
import {
  reattachMetadata,
  stripCustomData,
  type ElementLike,
} from "./reattach";

const VERSION = "33333333-3333-4333-8333-333333333333";

/**
 * Stand-in for `convertToExcalidrawElements`: it does many things, but the only
 * behaviour this task depends on (CLAUDE.md fact #1) is that it DROPS customData.
 * We model exactly that so the round-trip test is deterministic and needs no
 * `@excalidraw/excalidraw` dependency (the canvas mount is DEV-1137's task).
 */
function convertToExcalidrawElements<T extends ElementLike>(
  skeletons: readonly T[],
): Array<Omit<T, "customData">> {
  return stripCustomData(skeletons);
}

describe("stripCustomData", () => {
  it("removes customData and preserves every other property", () => {
    const [out] = stripCustomData([
      { id: "el-1", customData: { tag: "EC-101" }, x: 10 } as ElementLike & {
        x: number;
      },
    ]);
    expect(out).toEqual({ id: "el-1", x: 10 });
    expect("customData" in out).toBe(false);
  });
});

describe("reattachMetadata", () => {
  it("pairs each element with its metadata by id and null when absent", () => {
    const records: ElementMetadata[] = [
      {
        diagramVersionId: VERSION,
        elementId: "el-1",
        equipmentType: "pump",
        attributes: { tag: "P-101" },
      },
    ];
    const paired = reattachMetadata(
      [{ id: "el-1" }, { id: "el-2" }],
      records,
    );
    expect(paired[0]?.metadata?.attributes).toEqual({ tag: "P-101" });
    expect(paired[1]?.metadata).toBeNull();
  });
});

describe("metadata survives a convertToExcalidrawElements round-trip", () => {
  it("re-attaches via the store after customData is dropped", async () => {
    const store = new ElementMetadataStore(
      new InMemoryElementMetadataRepository(),
    );

    // Author-time skeleton carries equipment metadata on customData...
    const skeletons = [
      { id: "el-1", customData: { tag: "EC-101", equipmentType: "extraction-column" } },
      { id: "el-2", customData: { tag: "P-101", equipmentType: "pump" } },
    ];

    // ...which the store persists in the parallel, element-id-keyed store.
    await store.setMany(
      skeletons.map((s) => ({
        diagramVersionId: VERSION,
        elementId: s.id,
        equipmentType: String(s.customData.equipmentType),
        attributes: { tag: s.customData.tag },
      })),
    );

    // Conversion DROPS customData — metadata is gone from the elements.
    const converted = convertToExcalidrawElements(skeletons);
    for (const element of converted) {
      expect("customData" in element).toBe(false);
    }

    // Re-attach from the store proves the metadata survived the round-trip.
    const paired = await store.attachToElements(VERSION, converted);
    expect(paired).toHaveLength(2);
    expect(paired.find((p) => p.element.id === "el-1")?.metadata).toMatchObject({
      equipmentType: "extraction-column",
      attributes: { tag: "EC-101" },
    });
    expect(paired.find((p) => p.element.id === "el-2")?.metadata).toMatchObject({
      equipmentType: "pump",
      attributes: { tag: "P-101" },
    });
  });

  it("uses the store, not customData, as the source of truth", async () => {
    const store = new ElementMetadataStore(
      new InMemoryElementMetadataRepository(),
    );
    await store.set({
      diagramVersionId: VERSION,
      elementId: "el-1",
      equipmentType: "chiller",
      attributes: { tag: "CH-101" },
    });

    // Element arrives with NO customData (post-conversion) yet metadata resolves.
    const paired = await store.attachToElements(VERSION, [{ id: "el-1" }]);
    expect(paired[0]?.metadata?.attributes).toEqual({ tag: "CH-101" });
  });
});
