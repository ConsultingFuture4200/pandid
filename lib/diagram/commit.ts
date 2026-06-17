/**
 * Commit pipeline — the single path every mutation flows through
 * (DEV-1140, FR-4 / FR-11).
 *
 * A manual canvas edit (and, later, an accepted proposal — DEV-1144) arrives as
 * a source-agnostic {@link DiagramEdit}: the canonical Excalidraw scene, the
 * placed elements (id + type + ports + attributes), and the derived connection
 * edges. The pipeline:
 *
 *   1. validates the edit at the boundary (Zod + known-symbol check),
 *   2. runs the validator (DEV-1133) over a {@link DiagramSnapshot} built from it,
 *   3. on PASS, persists a new immutable version via {@link DiagramService.save},
 *   4. on FAIL, blocks the commit and surfaces the actionable report.
 *
 * Architecture invariants (CLAUDE.md):
 *   - One committer: this is the ONLY way state changes — manual edits and
 *     accepted proposals both call `commit`; there is no second persist path.
 *   - Validator behind an interface: the pipeline depends on the `Validator`
 *     interface, never on a concrete rule, so v2 domain rules need no change here.
 *   - Server is the single source of truth: persistence is delegated to the
 *     `DiagramService` over the canonical repository.
 *   - Versions are immutable: a pass appends a new version; nothing is mutated.
 *   - Metadata lives in the parallel element-id-keyed store, never on the
 *     Excalidraw element (`customData` is dropped — CLAUDE.md fact #1).
 */
import { z } from "zod";
import { isSymbolId, type SymbolId } from "@/lib/symbols";
import { connectionSchema, jsonObjectSchema } from "@/lib/types";
import type { Connection } from "@/lib/types";
import {
  createConnectivityValidator,
  type DiagramSnapshot,
  type ValidationReport,
  type Validator,
} from "@/lib/validator";
import type { DiagramService } from "./service";
import { getDiagramService } from "./index";
import {
  DiagramError,
  type SaveVersionInput,
  type VersionMetadataInput,
  type VersionSnapshot,
} from "./types";

/**
 * One placed element in an edit: the Excalidraw element id (join key to
 * connections + metadata), its equipment/connector type, the bind-point ids it
 * exposes (empty for connectors), and its parallel-store attributes.
 */
export const commitElementSchema = z.object({
  /** Excalidraw scene element id. */
  id: z.string().min(1),
  /** Equipment/connector type; validated against the symbol library below. */
  equipmentType: z.string().min(1),
  /** Bind-point ids a connection may attach to (empty for a connector line). */
  portIds: z.array(z.string().min(1)).readonly(),
  /** Element attributes (tag, capacity, …) for the parallel metadata store. */
  attributes: jsonObjectSchema,
});
export type CommitElement = z.infer<typeof commitElementSchema>;

/**
 * A source-agnostic diagram edit. Built by the canvas (manual) or the proposal
 * accept path; the pipeline does not care which produced it (one committer).
 */
export const diagramEditSchema = z.object({
  /** Canonical Excalidraw scene to persist as the new version. */
  scene: jsonObjectSchema,
  /** Placed elements, keyed by id. */
  elements: z.array(commitElementSchema),
  /** Derived connection edges between elements. */
  connections: z.array(connectionSchema),
});
export type DiagramEdit = z.infer<typeof diagramEditSchema>;

/** Full input to a commit: which diagram, on whose behalf, and the edit. */
export interface CommitInput {
  readonly accountId: string;
  readonly diagramId: string;
  readonly edit: DiagramEdit;
}

/** A successful commit: the validator report (valid) + the persisted version. */
export interface CommitResult {
  readonly report: ValidationReport;
  readonly snapshot: VersionSnapshot;
}

/**
 * Raised when validation fails: the commit is blocked and NOTHING is persisted.
 * Carries the full {@link ValidationReport} so the UI / Claude can point the
 * user at each offending element (FR-13). Distinct from {@link DiagramError}
 * (a persistence-boundary failure) so callers can branch on the reason.
 */
export class CommitBlockedError extends Error {
  readonly report: ValidationReport;
  constructor(report: ValidationReport) {
    const count = report.errors.length;
    super(
      `Commit blocked: the diagram has ${count} validation ${
        count === 1 ? "error" : "errors"
      } that must be fixed before it can be saved. ` +
        "Resolve the reported issues, then commit again.",
    );
    this.name = "CommitBlockedError";
    this.report = report;
  }
}

/** Sentinel version id used only to satisfy the snapshot's metadata shape during
 * pre-persist validation. The validator never reads `diagramVersionId`, and this
 * value is never persisted — the real version id is assigned by `save`. */
const PRE_PERSIST_VERSION_ID = "00000000-0000-0000-0000-000000000000";

/**
 * The commit pipeline. Composes the validator (gate) and the diagram service
 * (persistence). One instance per request is fine; it holds no mutable state.
 */
export class DiagramCommitPipeline {
  constructor(
    private readonly diagrams: DiagramService,
    private readonly validator: Validator,
  ) {}

  /**
   * Run the single commit path: validate → on pass, persist a new version.
   *
   * @throws {DiagramError} `invalid_input` for a malformed edit or an unknown
   *   equipment type; `not_found` if the diagram is absent or not owned by the
   *   account (delegated from the service).
   * @throws {CommitBlockedError} if the validator reports any error — the commit
   *   is blocked and nothing is persisted.
   */
  async commit(input: CommitInput): Promise<CommitResult> {
    const edit = this.parseEdit(input.edit);
    const elementTypes = this.resolveSymbolTypes(edit.elements);

    const snapshot: DiagramSnapshot = {
      elements: edit.elements.map((el, i) => ({
        id: el.id,
        equipmentType: elementTypes[i],
        portIds: el.portIds,
      })),
      connections: edit.connections satisfies readonly Connection[],
      metadata: edit.elements.map((el, i) => ({
        diagramVersionId: PRE_PERSIST_VERSION_ID,
        elementId: el.id,
        equipmentType: elementTypes[i],
        attributes: el.attributes,
      })),
    };

    const report = this.validator.validate(snapshot);
    if (!report.valid) {
      // Gate: a failed validation blocks the commit. No persist runs.
      throw new CommitBlockedError(report);
    }

    const save: SaveVersionInput = {
      excalidrawScene: edit.scene,
      metadata: edit.elements.map<VersionMetadataInput>((el, i) => ({
        elementId: el.id,
        equipmentType: elementTypes[i],
        attributes: el.attributes,
      })),
    };

    const snapshotOut = await this.diagrams.save({
      accountId: input.accountId,
      diagramId: input.diagramId,
      save,
    });

    return { report, snapshot: snapshotOut };
  }

  /** Validate the edit payload shape at the boundary (Zod). */
  private parseEdit(edit: DiagramEdit): DiagramEdit {
    const parsed = diagramEditSchema.safeParse(edit);
    if (!parsed.success) {
      throw new DiagramError(
        "invalid_input",
        "The edit could not be committed: the scene, elements, or connections " +
          "payload is malformed. Re-send a valid edit.",
      );
    }
    return parsed.data;
  }

  /**
   * Narrow each element's open-string `equipmentType` to a known `SymbolId`.
   * Fail loud at the boundary on an unknown type — never feed a bad type into
   * the validator (whose symbol lookups assume a known id).
   */
  private resolveSymbolTypes(elements: readonly CommitElement[]): SymbolId[] {
    return elements.map((el) => {
      if (!isSymbolId(el.equipmentType)) {
        throw new DiagramError(
          "invalid_input",
          `Element "${el.id}" has unknown equipment type "${el.equipmentType}". ` +
            "Use a type from the equipment palette.",
        );
      }
      return el.equipmentType;
    });
  }
}

/**
 * Convenience: the process-wide commit pipeline over the resolved diagram
 * service and the default v1 connectivity validator. Server actions and the
 * accepted-proposal path (DEV-1144) call this so they share one committer.
 */
export function getCommitPipeline(): DiagramCommitPipeline {
  return new DiagramCommitPipeline(
    getDiagramService(),
    createConnectivityValidator(),
  );
}
