// Validator interface + report types (DEV-1133, PRD §5.3 / FR-11..13).
//
// Architecture invariant (CLAUDE.md): the validator lives behind a STABLE
// interface. v1 implements CONNECTIVITY/structural rules only (FR-11); v2 domain
// rules slot in WITHOUT caller changes (FR-12) by registering additional
// `ValidationRule`s. Callers depend on this interface and the report shape only —
// never on a concrete rule.
//
// Everything commits through this (manual edit → DEV-1140; accepted proposal →
// DEV-1144). The report is the same regardless of source, so the single commit
// pipeline and the propose-tools share one contract.

import type { Connection, ElementMetadata } from "@/lib/types";
import type { SymbolId } from "@/lib/symbols";

/**
 * Canonical, source-agnostic snapshot the validator inspects. The commit
 * pipeline (DEV-1140) and the propose tools (DEV-1150) both build this from the
 * canonical scene + parallel metadata store; the validator never reads the DB or
 * the Excalidraw scene directly. Keeping the validator pure over this snapshot is
 * what lets one validator gate both commit paths (CLAUDE.md "one committer").
 */
export interface DiagramSnapshot {
  /**
   * Placed elements in the diagram, reduced to the keyed-by-id facts the
   * connectivity rules need: the element id, its equipment/connector type, and
   * the bind point ids (ports) connectors may attach to.
   */
  readonly elements: readonly DiagramElement[];
  /**
   * Derived connection edges (binding arrows). Endpoints are nullable to model
   * an in-progress / dangling arrow — detecting that is rule (b)'s job.
   */
  readonly connections: readonly Connection[];
  /**
   * Parallel element-id-keyed metadata (tag + type-specific attributes). The
   * validator reads `tag` (rule c, uniqueness) and required attributes (rule d)
   * from here, never from Excalidraw `customData` (which is dropped — CLAUDE.md).
   */
  readonly metadata: readonly ElementMetadata[];
}

/** One placed element, reduced to the facts connectivity validation needs. */
export interface DiagramElement {
  /** Excalidraw element id — the join key to connections and metadata. */
  readonly id: string;
  /** Equipment/connector type; drives the required-attribute lookup (rule d). */
  readonly equipmentType: SymbolId;
  /**
   * The bind-point ids a connection endpoint may target on this element. An
   * endpoint naming a port id outside this set fails rule (a).
   */
  readonly portIds: readonly string[];
}

/** Which FR-11 rule produced an error. Stable codes for actionable messaging. */
export type ValidationRuleCode =
  | "endpoint-unbound" // (b) orphan/dangling connection endpoint
  | "endpoint-missing-element" // (a) endpoint references an element that does not exist
  | "endpoint-missing-port" // (a) endpoint binds to a port the element does not expose
  | "duplicate-tag" // (c) equipment tag not unique within the diagram
  | "missing-required-attribute"; // (d) a required metadata field is absent/empty

/**
 * A single, actionable validation error (FR-13: which element, which rule).
 * `elementId` is the offending element (or the connection's element id for
 * connectivity rules) so the UI/Claude can point the user at it.
 */
export interface ValidationError {
  readonly code: ValidationRuleCode;
  /** The element the error is about (connection arrow id for rules a/b). */
  readonly elementId: string;
  /** Human-readable: what happened + how to fix (CLAUDE.md error guidance). */
  readonly message: string;
}

/**
 * Validator output. `valid` is true iff there are no errors. Composed of
 * JSON-safe primitives so it can be persisted as a `Proposal.validatorReport`
 * (DEV-1144) without a transform.
 */
export interface ValidationReport {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

/**
 * A single validation rule. v1 rules are connectivity/structural; v2 domain
 * rules implement this same interface and are registered alongside them — no
 * caller change (FR-12). A rule is a pure function of the snapshot returning the
 * errors it found (empty = passed).
 */
export interface ValidationRule {
  /** Stable identifier for the rule (diagnostics; not surfaced to end users). */
  readonly code: string;
  validate(snapshot: DiagramSnapshot): readonly ValidationError[];
}

/** The stable surface every caller depends on. Concrete rules stay hidden. */
export interface Validator {
  validate(snapshot: DiagramSnapshot): ValidationReport;
}
