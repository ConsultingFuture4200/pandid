"use client";

/**
 * Equipment attribute editor (this task: let the human fill a placed symbol's
 * REQUIRED attributes so a manual Save clears the validator).
 *
 * Given the selected {@link PlacedNode}, the panel renders one labeled input per
 * required field. The field list — and which fields use a constrained <select> —
 * is DERIVED from the symbol library via {@link nodeAttributeFields}, never
 * hardcoded per type, so it stays in lockstep with the validator's
 * `requiredAttributesRule`. Missing required fields are flagged inline so the
 * human can see exactly what still blocks a Save.
 *
 * Presentational + a callback: it owns no model state. On edit it calls
 * `onAttributeChange(key, value)`; the editor shell applies that to the
 * in-progress model and marks it dirty. The human is still the sole committer —
 * this only edits the pending edit; Save still runs the one commit pipeline.
 */
import { getSymbol } from "@/lib/symbols";
import { nodeAttributeFields } from "./attribute-fields";
import type { PlacedNode } from "./placement-model";

interface AttributePanelProps {
  /** The single selected equipment node whose attributes are being edited. */
  readonly node: PlacedNode;
  /** Called when a field's value changes (machine key + new string value). */
  readonly onAttributeChange: (key: string, value: string) => void;
}

export function AttributePanel({ node, onAttributeChange }: AttributePanelProps) {
  const fields = nodeAttributeFields(node);
  const label = getSymbol(node.symbolId).label;
  const missingCount = fields.filter((f) => f.missing).length;

  return (
    <section
      aria-label="Equipment attributes"
      data-testid="attribute-panel"
      className="flex flex-col gap-3 border-b p-3"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </h2>
        {missingCount > 0 ? (
          <span
            data-testid="attribute-missing-count"
            className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700"
          >
            {missingCount} required missing
          </span>
        ) : (
          <span className="text-xs text-green-600">All required set</span>
        )}
      </header>

      <div className="flex flex-col gap-2">
        {fields.map((field) => {
          const fieldId = `attr-${field.key}`;
          return (
            <label
              key={field.key}
              htmlFor={fieldId}
              className="flex flex-col gap-1 text-sm"
            >
              <span className="flex items-center gap-1 text-xs font-medium text-gray-600">
                {field.label}
                {field.missing ? (
                  <span
                    data-testid={`attribute-missing-${field.key}`}
                    className="text-amber-600"
                    title="Required — fill this in to allow Save"
                  >
                    *
                  </span>
                ) : null}
              </span>
              {field.type === "enum" && field.options !== undefined ? (
                <select
                  id={fieldId}
                  data-testid={`attribute-input-${field.key}`}
                  value={field.value}
                  onChange={(e) => onAttributeChange(field.key, e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select…</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={fieldId}
                  data-testid={`attribute-input-${field.key}`}
                  type={field.type === "number" ? "number" : "text"}
                  value={field.value}
                  onChange={(e) => onAttributeChange(field.key, e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                />
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}
