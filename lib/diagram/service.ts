/**
 * Diagram persistence service (DEV-1135, FR-17–19, SC-6).
 *
 * Orchestrates diagram CRUD + immutable versioning over a `DiagramRepository`.
 * All input validation (Zod-at-boundaries) and typed-error mapping happens here;
 * callers (server actions, MCP scoping in DEV-1149) are thin adapters.
 *
 * Architecture invariants upheld:
 *   - Server is the single source of truth: every read/write goes through the repo.
 *   - Versions are immutable: `save` only ever appends; there is no version edit.
 *   - One committer: this is the persistence step a commit pipeline (DEV-1140)
 *     and accepted proposals (DEV-1144) both fan into — not a second write path.
 */
import { z } from "zod";
import type { Diagram, DiagramVersion } from "@/lib/types";
import type { DiagramRepository } from "./repository";
import {
  DiagramError,
  saveVersionInputSchema,
  type DiagramWithVersions,
  type SaveVersionInput,
  type VersionSnapshot,
} from "./types";

const diagramNameSchema = z.string().trim().min(1).max(200);

export class DiagramService {
  constructor(private readonly repo: DiagramRepository) {}

  /**
   * Create a diagram for an account.
   * @throws {DiagramError} `invalid_input` for an empty/oversized name.
   */
  async create(input: { accountId: string; name: string }): Promise<Diagram> {
    const name = this.parseName(input.name);
    return this.repo.createDiagram({ accountId: input.accountId, name });
  }

  /** List an account's diagrams, newest first. */
  async list(accountId: string): Promise<Diagram[]> {
    return this.repo.listDiagrams(accountId);
  }

  /**
   * Open a diagram together with its full version history.
   * @throws {DiagramError} `not_found` if absent or owned by another account.
   */
  async open(input: {
    accountId: string;
    diagramId: string;
  }): Promise<DiagramWithVersions> {
    const diagram = await this.repo.getDiagram(input);
    if (diagram === null) {
      throw this.notFound(input.diagramId);
    }
    const versions = await this.repo.listVersions(input);
    return { diagram, versions: versions ?? [] };
  }

  /**
   * Rename a diagram.
   * @throws {DiagramError} `invalid_input` for a bad name, `not_found` if absent
   *   or not owned by the account.
   */
  async rename(input: {
    accountId: string;
    diagramId: string;
    name: string;
  }): Promise<Diagram> {
    const name = this.parseName(input.name);
    const updated = await this.repo.renameDiagram({
      accountId: input.accountId,
      diagramId: input.diagramId,
      name,
    });
    if (updated === null) {
      throw this.notFound(input.diagramId);
    }
    return updated;
  }

  /**
   * Delete a diagram and all its versions/metadata.
   * @throws {DiagramError} `not_found` if absent or not owned by the account.
   */
  async delete(input: { accountId: string; diagramId: string }): Promise<void> {
    const deleted = await this.repo.deleteDiagram(input);
    if (!deleted) {
      throw this.notFound(input.diagramId);
    }
  }

  /**
   * Save a new immutable version (scene + metadata) of a diagram.
   * @throws {DiagramError} `invalid_input` for a malformed save payload,
   *   `not_found` if the diagram is absent or not owned by the account.
   */
  async save(input: {
    accountId: string;
    diagramId: string;
    save: SaveVersionInput;
  }): Promise<VersionSnapshot> {
    const parsed = saveVersionInputSchema.safeParse(input.save);
    if (!parsed.success) {
      throw new DiagramError(
        "invalid_input",
        "The diagram could not be saved: the scene or metadata payload is malformed. " +
          "Re-send a valid scene object and metadata list.",
      );
    }
    const snapshot = await this.repo.saveVersion({
      accountId: input.accountId,
      diagramId: input.diagramId,
      save: parsed.data,
    });
    if (snapshot === null) {
      throw this.notFound(input.diagramId);
    }
    return snapshot;
  }

  /** List a diagram's versions, newest first. */
  async listVersions(input: {
    accountId: string;
    diagramId: string;
  }): Promise<DiagramVersion[]> {
    const versions = await this.repo.listVersions(input);
    if (versions === null) {
      throw this.notFound(input.diagramId);
    }
    return versions;
  }

  /**
   * Restore a prior version: return its exact scene + metadata (SC-6).
   *
   * "Restore" is a read of an immutable snapshot — it does not mutate or roll
   * back the prior version. A caller that wants to make a restored version
   * current re-`save`s its scene as a new version, preserving immutability.
   *
   * @throws {DiagramError} `not_found` if the diagram or version is absent or
   *   not owned by the account.
   */
  async restoreVersion(input: {
    accountId: string;
    diagramId: string;
    versionId: string;
  }): Promise<VersionSnapshot> {
    const snapshot = await this.repo.getVersion(input);
    if (snapshot === null) {
      throw new DiagramError(
        "not_found",
        `Version ${input.versionId} was not found for this diagram. ` +
          "Check the version id, or list versions to see what is available.",
      );
    }
    return snapshot;
  }

  private parseName(name: string): string {
    const parsed = diagramNameSchema.safeParse(name);
    if (!parsed.success) {
      throw new DiagramError(
        "invalid_input",
        "A diagram name must be 1–200 characters. Enter a non-empty name.",
      );
    }
    return parsed.data;
  }

  private notFound(diagramId: string): DiagramError {
    return new DiagramError(
      "not_found",
      `Diagram ${diagramId} was not found for this account. ` +
        "Check the id, or list your diagrams to see what is available.",
    );
  }
}
