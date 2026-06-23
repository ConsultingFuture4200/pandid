// Drawing-sheet metadata (DEV-1201, Bucket B).
//
// The "furniture" around a P&ID — title block, revision history, general notes —
// captured as plain, JSON-safe data so it persists with the diagram (in the
// scene's `sheet` key, version-immutable like `pid`) and renders into exports.
// A pure type module: no I/O, no React.

import { z } from "zod";

/** One revision-table row (rev, date, what changed, who drew/checked it). */
export const sheetRevisionSchema = z.object({
  rev: z.string(),
  date: z.string(),
  description: z.string(),
  drawnBy: z.string(),
  checkedBy: z.string(),
});
export type SheetRevision = z.infer<typeof sheetRevisionSchema>;

/** Title-block + sheet metadata for a diagram. All strings (blank = unset). */
export const sheetMetadataSchema = z.object({
  title: z.string(),
  client: z.string(),
  drawingNo: z.string(),
  jobNo: z.string(),
  /** Drawing scale, e.g. "N.T.S". */
  scale: z.string(),
  /** Sheet position, e.g. "1 of 1". */
  sheet: z.string(),
  drawnBy: z.string(),
  checkedBy: z.string(),
  approvedBy: z.string(),
  /** General notes (each rendered as a numbered line). */
  notes: z.array(z.string()),
  revisions: z.array(sheetRevisionSchema),
});
export type SheetMetadata = z.infer<typeof sheetMetadataSchema>;

/** A new sheet's defaults: standard scale/sheet + the conventional dimensions
 * note, title seeded from the diagram name. Everything else blank for the human
 * to fill in the sheet panel. */
export function defaultSheetMetadata(title = ""): SheetMetadata {
  return {
    title,
    client: "",
    drawingNo: "",
    jobNo: "",
    scale: "N.T.S",
    sheet: "1 of 1",
    drawnBy: "",
    checkedBy: "",
    approvedBy: "",
    notes: ["ALL DIMENSIONS ARE IN MM UNLESS OTHERWISE SPECIFIED"],
    revisions: [],
  };
}

/** Parse an unknown value (e.g. a persisted scene's `sheet` key) into
 * SheetMetadata, falling back to defaults for an absent/legacy/malformed value. */
export function parseSheetMetadata(value: unknown, title = ""): SheetMetadata {
  const parsed = sheetMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultSheetMetadata(title);
}
