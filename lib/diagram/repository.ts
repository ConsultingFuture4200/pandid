/**
 * Diagram persistence interface (DEV-1135, FR-17–19, SC-6).
 *
 * The service layer depends on this interface, never on a concrete driver, so
 * persistence logic is unit-testable with an in-memory implementation and the
 * Postgres-backed implementation is a drop-in (mirrors the auth task's
 * repository/service split).
 *
 * Server is the single source of truth (CLAUDE.md invariant): every diagram and
 * version read/write goes through this one surface. Versions are immutable —
 * the interface has no update/delete for a version, only append (`saveVersion`)
 * and read (`getVersion`, `listVersions`).
 */
import type { Diagram, DiagramVersion } from "@/lib/types";
import type { SaveVersionInput, VersionSnapshot } from "./types";

export interface DiagramRepository {
  /** Create a new diagram for an account. Returns the created row. */
  createDiagram(input: { accountId: string; name: string }): Promise<Diagram>;

  /** List an account's diagrams, newest first. */
  listDiagrams(accountId: string): Promise<Diagram[]>;

  /**
   * Fetch a single diagram scoped to its owning account, or null if it does
   * not exist or belongs to another account (tenant isolation).
   */
  getDiagram(input: { accountId: string; diagramId: string }): Promise<Diagram | null>;

  /**
   * Rename a diagram. Returns the updated row, or null if absent / not owned.
   */
  renameDiagram(input: {
    accountId: string;
    diagramId: string;
    name: string;
  }): Promise<Diagram | null>;

  /**
   * Delete a diagram (cascades to its versions + metadata). Returns true if a
   * row was deleted, false if absent / not owned. Idempotent.
   */
  deleteDiagram(input: { accountId: string; diagramId: string }): Promise<boolean>;

  /**
   * Append a new immutable version (scene + element metadata) to a diagram.
   * Each call creates a new version row; prior versions are never mutated.
   * @returns the new version snapshot, or null if the diagram is absent / not owned.
   */
  saveVersion(input: {
    accountId: string;
    diagramId: string;
    save: SaveVersionInput;
  }): Promise<VersionSnapshot | null>;

  /** List a diagram's versions newest-first (metadata excluded for listing). */
  listVersions(input: {
    accountId: string;
    diagramId: string;
  }): Promise<DiagramVersion[] | null>;

  /**
   * Fetch one version's full snapshot (scene + metadata) for restore (SC-6),
   * scoped to the owning account. Null if the version / diagram is absent or
   * not owned.
   */
  getVersion(input: {
    accountId: string;
    diagramId: string;
    versionId: string;
  }): Promise<VersionSnapshot | null>;
}
