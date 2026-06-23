"use client";

/**
 * Drawing-sheet settings panel (DEV-1201). Edits the title-block / sheet metadata
 * for the diagram — title, client, drawing/job no, scale, sheet, drawn/checked by,
 * and general notes. Presentational + a callback: on edit it calls `onChange` with
 * the next {@link SheetMetadata}; the editor shell folds it into the pending model
 * so Save persists it (version-immutable, alongside the structural projection).
 */
import { defaultSheetMetadata, type SheetMetadata } from "@/lib/sheet/types";

interface SheetPanelProps {
  /** Current sheet metadata, or undefined to start from defaults. */
  readonly sheet: SheetMetadata | undefined;
  readonly onChange: (sheet: SheetMetadata) => void;
}

const FIELDS: ReadonlyArray<{
  readonly key: keyof Omit<SheetMetadata, "notes" | "revisions">;
  readonly label: string;
}> = [
  { key: "title", label: "Title" },
  { key: "client", label: "Client" },
  { key: "drawingNo", label: "Drawing no" },
  { key: "jobNo", label: "Job no" },
  { key: "scale", label: "Scale" },
  { key: "sheet", label: "Sheet" },
  { key: "drawnBy", label: "Drawn by" },
  { key: "checkedBy", label: "Checked by" },
];

export function SheetPanel({ sheet, onChange }: SheetPanelProps) {
  const value = sheet ?? defaultSheetMetadata();

  const setField = (
    key: keyof Omit<SheetMetadata, "notes" | "revisions">,
    fieldValue: string,
  ) => {
    onChange({ ...value, [key]: fieldValue });
  };

  return (
    <section
      aria-label="Sheet settings"
      data-testid="sheet-panel"
      className="flex flex-col gap-2 border-t p-3"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Drawing sheet
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-gray-600">{field.label}</span>
            <input
              data-testid={`sheet-${field.key}`}
              value={value[field.key]}
              onChange={(e) => setField(field.key, e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-0.5 text-xs">
        <span className="font-medium text-gray-600">Notes (one per line)</span>
        <textarea
          data-testid="sheet-notes"
          rows={3}
          value={value.notes.join("\n")}
          onChange={(e) =>
            onChange({
              ...value,
              notes: e.target.value.split("\n").filter((n) => n.length > 0),
            })
          }
          className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>
    </section>
  );
}
