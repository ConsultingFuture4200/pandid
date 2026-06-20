"use client";

/**
 * Active-diagram switcher (DEV-1149, PRD §2.2).
 *
 * Lets the signed-in user pick which of their diagrams is the account's ACTIVE
 * diagram — the one the MCP connector acts on. Selecting another and submitting
 * "rebinds the session" (PRD §2.2); the next Claude tool call targets it.
 *
 * Client component: drives the `setActiveDiagramAction` server action via
 * `useActionState` and surfaces the typed error on failure. All ownership /
 * single-active enforcement lives server-side in `ScopingService`.
 */
import { useActionState } from "react";
import type { Diagram } from "@/lib/types";
import type { ScopingFormState } from "../scoping-actions";

type SetActiveAction = (
  prev: ScopingFormState,
  formData: FormData,
) => Promise<ScopingFormState>;

interface DiagramSwitcherProps {
  readonly action: SetActiveAction;
  readonly diagrams: readonly Diagram[];
  readonly activeDiagramId: string | null;
}

const INITIAL: ScopingFormState = {};

export function DiagramSwitcher({
  action,
  diagrams,
  activeDiagramId,
}: DiagramSwitcherProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  if (diagrams.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        You have no diagrams yet. Create one in the editor — it becomes your
        active diagram.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Active diagram</legend>
        {diagrams.map((diagram) => (
          <label key={diagram.id} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="diagramId"
              value={diagram.id}
              defaultChecked={diagram.id === activeDiagramId}
            />
            <span>{diagram.name}</span>
            {diagram.id === activeDiagramId ? (
              <span className="text-xs text-green-700">(active)</span>
            ) : null}
          </label>
        ))}
      </fieldset>
      {state.error !== undefined ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Switching…" : "Make active"}
      </button>
    </form>
  );
}
