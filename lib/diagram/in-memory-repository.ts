/**
 * In-memory DiagramRepository (DEV-1135).
 *
 * Test double for the diagram service and a stand-in for local development
 * before Postgres is reachable. NOT the production store — `getDiagramRepository`
 * (see `index.ts`) refuses to hand this out in production so canonical state is
 * never an in-memory map.
 *
 * Snapshots are deep-cloned on write and on read so a stored version is
 * immutable from the caller's perspective (mirrors Postgres append-only +
 * row-copy semantics): mutating a returned scene never reaches back into the
 * store. This is what makes SC-6 ("exact prior scene + metadata") hold here too.
 */
import type { Diagram, DiagramVersion, ElementMetadata } from "@/lib/types";
import type { DiagramRepository } from "./repository";
import type { SaveVersionInput, VersionSnapshot } from "./types";

interface StoredVersion {
  readonly version: DiagramVersion;
  readonly metadata: ElementMetadata[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryDiagramRepository implements DiagramRepository {
  private readonly diagrams = new Map<string, Diagram>();
  private readonly createdAt = new Map<string, number>(); // diagramId -> insert order
  private readonly versions = new Map<string, StoredVersion[]>(); // diagramId -> versions (oldest first)
  private seq = 0;

  async createDiagram(input: { accountId: string; name: string }): Promise<Diagram> {
    const diagram: Diagram = {
      id: crypto.randomUUID(),
      accountId: input.accountId,
      name: input.name,
      active: false,
    };
    this.diagrams.set(diagram.id, diagram);
    this.createdAt.set(diagram.id, this.seq++);
    this.versions.set(diagram.id, []);
    return clone(diagram);
  }

  async listDiagrams(accountId: string): Promise<Diagram[]> {
    return [...this.diagrams.values()]
      .filter((d) => d.accountId === accountId)
      .sort((a, b) => (this.createdAt.get(b.id) ?? 0) - (this.createdAt.get(a.id) ?? 0))
      .map(clone);
  }

  async getDiagram(input: {
    accountId: string;
    diagramId: string;
  }): Promise<Diagram | null> {
    const diagram = this.diagrams.get(input.diagramId);
    if (diagram === undefined || diagram.accountId !== input.accountId) {
      return null;
    }
    return clone(diagram);
  }

  async renameDiagram(input: {
    accountId: string;
    diagramId: string;
    name: string;
  }): Promise<Diagram | null> {
    const diagram = this.diagrams.get(input.diagramId);
    if (diagram === undefined || diagram.accountId !== input.accountId) {
      return null;
    }
    const updated: Diagram = { ...diagram, name: input.name };
    this.diagrams.set(updated.id, updated);
    return clone(updated);
  }

  async deleteDiagram(input: {
    accountId: string;
    diagramId: string;
  }): Promise<boolean> {
    const diagram = this.diagrams.get(input.diagramId);
    if (diagram === undefined || diagram.accountId !== input.accountId) {
      return false;
    }
    this.diagrams.delete(input.diagramId);
    this.createdAt.delete(input.diagramId);
    this.versions.delete(input.diagramId);
    return true;
  }

  async saveVersion(input: {
    accountId: string;
    diagramId: string;
    save: SaveVersionInput;
  }): Promise<VersionSnapshot | null> {
    const diagram = this.diagrams.get(input.diagramId);
    if (diagram === undefined || diagram.accountId !== input.accountId) {
      return null;
    }
    const version: DiagramVersion = {
      id: crypto.randomUUID(),
      diagramId: input.diagramId,
      excalidrawScene: clone(input.save.excalidrawScene),
      createdAt: new Date().toISOString(),
    };
    const metadata: ElementMetadata[] = input.save.metadata.map((m) => ({
      diagramVersionId: version.id,
      elementId: m.elementId,
      equipmentType: m.equipmentType,
      attributes: clone(m.attributes),
    }));
    const list = this.versions.get(input.diagramId) ?? [];
    list.push({ version, metadata });
    this.versions.set(input.diagramId, list);
    return clone({ version, metadata });
  }

  async listVersions(input: {
    accountId: string;
    diagramId: string;
  }): Promise<DiagramVersion[] | null> {
    const diagram = this.diagrams.get(input.diagramId);
    if (diagram === undefined || diagram.accountId !== input.accountId) {
      return null;
    }
    const list = this.versions.get(input.diagramId) ?? [];
    return [...list]
      .reverse() // newest first
      .map((v) => clone(v.version));
  }

  async getVersion(input: {
    accountId: string;
    diagramId: string;
    versionId: string;
  }): Promise<VersionSnapshot | null> {
    const diagram = this.diagrams.get(input.diagramId);
    if (diagram === undefined || diagram.accountId !== input.accountId) {
      return null;
    }
    const stored = (this.versions.get(input.diagramId) ?? []).find(
      (v) => v.version.id === input.versionId,
    );
    if (stored === undefined) {
      return null;
    }
    return clone({ version: stored.version, metadata: stored.metadata });
  }
}
