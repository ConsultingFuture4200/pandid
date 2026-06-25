// The catalog of prebuilt templates. Add a template's definition here to make it
// instantiable from the gallery; the instantiate action looks it up by id.

import type { DiagramTemplate, TemplateSummary } from "./types";
import { ETHANOL_EXTRACTION_TEMPLATE } from "./ethanol-extraction";
import { BIZZYBEE_MULTI_RACK_TEMPLATE } from "./bizzybee-multi-rack";
import { HYDROCARBON_EXTRACTOR_TEMPLATE } from "./hydrocarbon-extractor";

/** All templates, in gallery display order. */
export const TEMPLATES: readonly DiagramTemplate[] = [
  ETHANOL_EXTRACTION_TEMPLATE,
  BIZZYBEE_MULTI_RACK_TEMPLATE,
  HYDROCARBON_EXTRACTOR_TEMPLATE,
];

/** Look up a template by id, or `null` if there is no such template. */
export function getTemplate(id: string): DiagramTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Client-safe summaries (no `buildModel`) for the gallery UI. */
export function listTemplateSummaries(): readonly TemplateSummary[] {
  return TEMPLATES.map(({ id, name, description }) => ({ id, name, description }));
}
