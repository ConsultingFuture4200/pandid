import { beforeEach, describe, expect, it } from "vitest";
import type { ElementMetadata } from "@/lib/types";
import { InMemoryElementMetadataRepository } from "./in-memory-repository";
import { ElementMetadataStore } from "./store";

const VERSION_A = "11111111-1111-4111-8111-111111111111";
const VERSION_B = "22222222-2222-4222-8222-222222222222";

function meta(overrides: Partial<ElementMetadata> = {}): ElementMetadata {
  return {
    diagramVersionId: VERSION_A,
    elementId: "el-1",
    equipmentType: "extraction-column",
    attributes: { tag: "EC-101" },
    ...overrides,
  };
}

describe("ElementMetadataStore CRUD", () => {
  let store: ElementMetadataStore;

  beforeEach(() => {
    store = new ElementMetadataStore(new InMemoryElementMetadataRepository());
  });

  it("creates and reads a record by (version, elementId)", async () => {
    await store.set(meta());
    const found = await store.get(VERSION_A, "el-1");
    expect(found).toEqual(meta());
  });

  it("returns null for an absent key", async () => {
    expect(await store.get(VERSION_A, "missing")).toBeNull();
  });

  it("replaces a record on upsert of the same key", async () => {
    await store.set(meta({ attributes: { tag: "EC-101" } }));
    await store.set(meta({ attributes: { tag: "EC-102" } }));
    const found = await store.get(VERSION_A, "el-1");
    expect(found?.attributes).toEqual({ tag: "EC-102" });
    expect(await store.list(VERSION_A)).toHaveLength(1);
  });

  it("isolates records across versions sharing an elementId", async () => {
    await store.set(meta({ diagramVersionId: VERSION_A, attributes: { tag: "A" } }));
    await store.set(meta({ diagramVersionId: VERSION_B, attributes: { tag: "B" } }));
    expect((await store.get(VERSION_A, "el-1"))?.attributes).toEqual({ tag: "A" });
    expect((await store.get(VERSION_B, "el-1"))?.attributes).toEqual({ tag: "B" });
  });

  it("lists only the requested version's records", async () => {
    await store.setMany([
      meta({ elementId: "el-1" }),
      meta({ elementId: "el-2" }),
      meta({ diagramVersionId: VERSION_B, elementId: "el-3" }),
    ]);
    const listed = await store.list(VERSION_A);
    expect(listed.map((r) => r.elementId).sort()).toEqual(["el-1", "el-2"]);
  });

  it("deletes idempotently and reports whether a record existed", async () => {
    await store.set(meta());
    expect(await store.remove(VERSION_A, "el-1")).toBe(true);
    expect(await store.get(VERSION_A, "el-1")).toBeNull();
    expect(await store.remove(VERSION_A, "el-1")).toBe(false);
  });

  it("rejects an invalid record at the boundary", async () => {
    await expect(
      // empty elementId violates elementMetadataSchema (min length 1)
      store.set(meta({ elementId: "" })),
    ).rejects.toThrow();
  });
});
