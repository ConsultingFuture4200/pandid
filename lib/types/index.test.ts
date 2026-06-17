import { describe, expect, it } from "vitest";
import {
  accountSchema,
  connectionSchema,
  diagramSchema,
  diagramVersionSchema,
  elementMetadataSchema,
  proposalSchema,
  proposalStatusSchema,
} from "./index";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-16T00:00:00.000Z";

describe("accountSchema", () => {
  it("accepts a valid account", () => {
    expect(
      accountSchema.parse({ id: UUID, email: "op@example.com", createdAt: TS }),
    ).toEqual({ id: UUID, email: "op@example.com", createdAt: TS });
  });

  it("rejects a non-uuid id and a bad email", () => {
    expect(accountSchema.safeParse({ id: "x", email: "op@example.com", createdAt: TS }).success).toBe(false);
    expect(accountSchema.safeParse({ id: UUID, email: "nope", createdAt: TS }).success).toBe(false);
  });
});

describe("diagramSchema", () => {
  it("accepts a valid diagram", () => {
    const d = { id: UUID, accountId: UUID2, name: "Skid A", active: true };
    expect(diagramSchema.parse(d)).toEqual(d);
  });

  it("rejects an empty name", () => {
    expect(
      diagramSchema.safeParse({ id: UUID, accountId: UUID2, name: "", active: false }).success,
    ).toBe(false);
  });
});

describe("diagramVersionSchema", () => {
  it("accepts an opaque scene object", () => {
    const v = {
      id: UUID,
      diagramId: UUID2,
      excalidrawScene: { elements: [], appState: { foo: 1 } },
      createdAt: TS,
    };
    expect(diagramVersionSchema.parse(v)).toEqual(v);
  });

  it("rejects a non-object scene", () => {
    expect(
      diagramVersionSchema.safeParse({
        id: UUID,
        diagramId: UUID2,
        excalidrawScene: "not-an-object",
        createdAt: TS,
      }).success,
    ).toBe(false);
  });
});

describe("elementMetadataSchema", () => {
  it("is keyed by element id, not customData", () => {
    const m = {
      diagramVersionId: UUID,
      elementId: "excalidraw-el-1",
      equipmentType: "extractor",
      attributes: { tag: "EX-101" },
    };
    const parsed = elementMetadataSchema.parse(m);
    expect(parsed.elementId).toBe("excalidraw-el-1");
    expect("customData" in parsed).toBe(false);
  });

  it("rejects an empty elementId", () => {
    expect(
      elementMetadataSchema.safeParse({
        diagramVersionId: UUID,
        elementId: "",
        equipmentType: "extractor",
        attributes: {},
      }).success,
    ).toBe(false);
  });
});

describe("proposalSchema", () => {
  it("accepts pending/accepted/rejected statuses", () => {
    expect(proposalStatusSchema.options).toEqual(["pending", "accepted", "rejected"]);
    const p = {
      id: UUID,
      diagramId: UUID2,
      stagedChange: { op: "add" },
      validatorReport: { ok: true },
      status: "pending",
      createdAt: TS,
    };
    expect(proposalSchema.parse(p).status).toBe("pending");
  });

  it("rejects an unknown status", () => {
    expect(
      proposalSchema.safeParse({
        id: UUID,
        diagramId: UUID2,
        stagedChange: {},
        validatorReport: {},
        status: "applied",
        createdAt: TS,
      }).success,
    ).toBe(false);
  });
});

describe("connectionSchema", () => {
  it("accepts bound endpoints", () => {
    const c = { elementId: "arrow-1", sourceElementId: "a", targetElementId: "b" };
    expect(connectionSchema.parse(c)).toEqual(c);
  });

  it("accepts a null (orphan) endpoint", () => {
    const c = { elementId: "arrow-1", sourceElementId: "a", targetElementId: null };
    expect(connectionSchema.parse(c).targetElementId).toBeNull();
  });
});
