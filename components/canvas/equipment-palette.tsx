"use client";

/**
 * Equipment palette (DEV-1137, FR-2). Lists the extraction-equipment symbols
 * from the symbol library (DEV-1131) and emits a place request when one is
 * clicked. Pure presentational + a callback — it owns no canvas state and does
 * not touch Excalidraw; the canvas wrapper decides where/how to place.
 */
import { SYMBOL_DEFINITIONS, SYMBOL_IDS, type SymbolId } from "@/lib/symbols";

interface EquipmentPaletteProps {
  /** Invoked with the chosen symbol id when a palette entry is activated. */
  readonly onPlace: (id: SymbolId) => void;
}

export function EquipmentPalette({ onPlace }: EquipmentPaletteProps) {
  return (
    <aside
      aria-label="Equipment palette"
      className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-gray-200 bg-gray-50 p-2"
    >
      <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Symbols
      </h2>
      <ul className="flex flex-col gap-1">
        {SYMBOL_IDS.map((id) => {
          const def = SYMBOL_DEFINITIONS[id];
          return (
            <li key={id}>
              <button
                type="button"
                data-symbol-id={id}
                onClick={() => onPlace(id)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-gray-200"
              >
                <span>{def.label}</span>
                <span className="text-xs text-gray-400">{def.kind}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
