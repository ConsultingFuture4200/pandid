import { beforeEach, describe, expect, it } from "vitest";
import type { JsonObject } from "@/lib/types";
import { InMemoryDiagramRepository } from "./in-memory-repository";
import { DiagramService } from "./service";
import { DiagramError, type VersionMetadataInput } from "./types";

const ACCOUNT = crypto.randomUUID();
const OTHER_ACCOUNT = crypto.randomUUID();

describe("DiagramService", () => {
  let repo: InMemoryDiagramRepository;
  let service: DiagramService;

  beforeEach(() => {
    repo = new InMemoryDiagramRepository();
    service = new DiagramService(repo);
  });

  describe("CRUD", () => {
    it("creates, lists, opens, renames, and deletes diagrams per account", async () => {
      const created = await service.create({ accountId: ACCOUNT, name: "Rig A" });
      expect(created.accountId).toBe(ACCOUNT);
      expect(created.name).toBe("Rig A");
      expect(created.active).toBe(false);

      const list = await service.list(ACCOUNT);
      expect(list.map((d) => d.id)).toContain(created.id);

      const opened = await service.open({ accountId: ACCOUNT, diagramId: created.id });
      expect(opened.diagram.id).toBe(created.id);
      expect(opened.versions).toEqual([]);

      const renamed = await service.rename({
        accountId: ACCOUNT,
        diagramId: created.id,
        name: "Rig B",
      });
      expect(renamed.name).toBe("Rig B");

      await service.delete({ accountId: ACCOUNT, diagramId: created.id });
      expect((await service.list(ACCOUNT)).map((d) => d.id)).not.toContain(created.id);
    });

    it("lists newest diagram first", async () => {
      const a = await service.create({ accountId: ACCOUNT, name: "first" });
      const b = await service.create({ accountId: ACCOUNT, name: "second" });
      const list = await service.list(ACCOUNT);
      expect(list[0].id).toBe(b.id);
      expect(list[1].id).toBe(a.id);
    });

    it("trims and rejects an empty name", async () => {
      const created = await service.create({ accountId: ACCOUNT, name: "  Padded  " });
      expect(created.name).toBe("Padded");
      await expect(
        service.create({ accountId: ACCOUNT, name: "   " }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("throws not_found opening/renaming/deleting an unknown diagram", async () => {
      const id = crypto.randomUUID();
      await expect(
        service.open({ accountId: ACCOUNT, diagramId: id }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        service.rename({ accountId: ACCOUNT, diagramId: id, name: "x" }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        service.delete({ accountId: ACCOUNT, diagramId: id }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("throws DiagramError, not a generic Error", async () => {
      const err = await service
        .open({ accountId: ACCOUNT, diagramId: crypto.randomUUID() })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DiagramError);
    });
  });

  describe("tenant isolation", () => {
    it("hides another account's diagram from list/open/rename/delete", async () => {
      const created = await service.create({ accountId: ACCOUNT, name: "private" });

      expect(await service.list(OTHER_ACCOUNT)).toEqual([]);
      await expect(
        service.open({ accountId: OTHER_ACCOUNT, diagramId: created.id }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        service.rename({ accountId: OTHER_ACCOUNT, diagramId: created.id, name: "hijack" }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        service.delete({ accountId: OTHER_ACCOUNT, diagramId: created.id }),
      ).rejects.toMatchObject({ code: "not_found" });

      // Still intact + unrenamed for the real owner.
      const opened = await service.open({ accountId: ACCOUNT, diagramId: created.id });
      expect(opened.diagram.name).toBe("private");
    });
  });

  describe("immutable versioning", () => {
    it("each save appends a new version row; prior versions are unchanged", async () => {
      const d = await service.create({ accountId: ACCOUNT, name: "versioned" });

      const v1 = await service.save({
        accountId: ACCOUNT,
        diagramId: d.id,
        save: { excalidrawScene: { elements: [{ id: "a" }] }, metadata: [] },
      });
      const v2 = await service.save({
        accountId: ACCOUNT,
        diagramId: d.id,
        save: { excalidrawScene: { elements: [{ id: "a" }, { id: "b" }] }, metadata: [] },
      });

      expect(v1.version.id).not.toBe(v2.version.id);

      const versions = await service.listVersions({ accountId: ACCOUNT, diagramId: d.id });
      expect(versions).toHaveLength(2);
      // newest first
      expect(versions[0].id).toBe(v2.version.id);
      expect(versions[1].id).toBe(v1.version.id);

      // v1's snapshot is unchanged by v2's save.
      const restoredV1 = await service.restoreVersion({
        accountId: ACCOUNT,
        diagramId: d.id,
        versionId: v1.version.id,
      });
      expect(restoredV1.version.excalidrawScene).toEqual({ elements: [{ id: "a" }] });
    });

    it("mutating a returned scene does not mutate the stored version", async () => {
      const d = await service.create({ accountId: ACCOUNT, name: "iso" });
      const saved = await service.save({
        accountId: ACCOUNT,
        diagramId: d.id,
        save: { excalidrawScene: { elements: [] }, metadata: [] },
      });

      // Attempt to mutate the returned snapshot's scene.
      (saved.version.excalidrawScene as { elements: unknown[] }).elements.push("tampered");

      const restored = await service.restoreVersion({
        accountId: ACCOUNT,
        diagramId: d.id,
        versionId: saved.version.id,
      });
      expect(restored.version.excalidrawScene).toEqual({ elements: [] });
    });

    it("rejects a malformed save payload with invalid_input", async () => {
      const d = await service.create({ accountId: ACCOUNT, name: "bad" });
      await expect(
        service.save({
          accountId: ACCOUNT,
          diagramId: d.id,
          // scene must be an object, not an array
          save: { excalidrawScene: [] as unknown as Record<string, never>, metadata: [] },
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("throws not_found saving/listing/restoring on an unknown diagram", async () => {
      const id = crypto.randomUUID();
      await expect(
        service.save({
          accountId: ACCOUNT,
          diagramId: id,
          save: { excalidrawScene: {}, metadata: [] },
        }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        service.listVersions({ accountId: ACCOUNT, diagramId: id }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        service.restoreVersion({
          accountId: ACCOUNT,
          diagramId: id,
          versionId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("restore returns exact prior scene + metadata (SC-6)", () => {
    it("round-trips scene and element metadata intact", async () => {
      const d = await service.create({ accountId: ACCOUNT, name: "sc6" });
      const scene: JsonObject = {
        elements: [
          { id: "ex-1", type: "rectangle", x: 10, y: 20 },
          { id: "line-1", type: "arrow", points: [[0, 0], [1, 1]] },
        ],
        appState: { viewBackgroundColor: "#fff" },
      };
      const metadata: VersionMetadataInput[] = [
        {
          elementId: "ex-1",
          equipmentType: "extraction_column",
          attributes: { tag: "EX-101", capacity: "5L", orientation: "vertical" },
        },
        {
          elementId: "line-1",
          equipmentType: "process_line",
          attributes: { lineId: "L-1", service: "ethanol" },
        },
      ];

      const saved = await service.save({
        accountId: ACCOUNT,
        diagramId: d.id,
        save: { excalidrawScene: scene, metadata },
      });

      // Save a second version so the first must be fetched by id, not "latest".
      await service.save({
        accountId: ACCOUNT,
        diagramId: d.id,
        save: { excalidrawScene: { elements: [] }, metadata: [] },
      });

      const restored = await service.restoreVersion({
        accountId: ACCOUNT,
        diagramId: d.id,
        versionId: saved.version.id,
      });

      expect(restored.version.excalidrawScene).toEqual(scene);
      expect(restored.metadata).toHaveLength(2);
      expect(restored.metadata).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            diagramVersionId: saved.version.id,
            elementId: "ex-1",
            equipmentType: "extraction_column",
            attributes: { tag: "EX-101", capacity: "5L", orientation: "vertical" },
          }),
          expect.objectContaining({
            diagramVersionId: saved.version.id,
            elementId: "line-1",
            equipmentType: "process_line",
            attributes: { lineId: "L-1", service: "ethanol" },
          }),
        ]),
      );
    });

    it("cannot restore a version through another account", async () => {
      const d = await service.create({ accountId: ACCOUNT, name: "scoped" });
      const saved = await service.save({
        accountId: ACCOUNT,
        diagramId: d.id,
        save: { excalidrawScene: { elements: [] }, metadata: [] },
      });
      await expect(
        service.restoreVersion({
          accountId: OTHER_ACCOUNT,
          diagramId: d.id,
          versionId: saved.version.id,
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });
});
