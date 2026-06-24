// Prebuilt diagram templates (this task).
//
// A template is a ready-made diagram a user can load as a starting point instead
// of placing every symbol by hand. It is pure data: a function that builds a
// `PlacementModel` (the same in-memory model the canvas maintains), which is
// instantiated through the EXISTING create→save→activate path
// (app/(app)/diagram-actions). No new persistence — a template seeds the first
// immutable version of a brand-new diagram, exactly like an empty create does.

import type { PlacementModel } from "@/components/canvas/placement-model";

/** A loadable prebuilt diagram. */
export interface DiagramTemplate {
  /** Stable kebab-case id used by the instantiate action. */
  readonly id: string;
  /** Gallery card title. */
  readonly name: string;
  /** One-line gallery card description. */
  readonly description: string;
  /** Name given to the diagram this template creates. */
  readonly diagramName: string;
  /** Build the structural model (nodes + edges + viewport + sheet). Pure. */
  buildModel(): PlacementModel;
}

/** The subset of a template that is safe to hand to a client component (no
 * `buildModel` function — model construction stays server-side). */
export interface TemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}
