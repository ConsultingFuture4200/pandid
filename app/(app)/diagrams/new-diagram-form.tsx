"use client";

/**
 * New-diagram form (PRD §2.2 / §3).
 *
 * Lets the signed-in user create a diagram by name. On submit it drives the
 * `createDiagramAction` server action; on success the page revalidates and the
 * new diagram shows as the account's active diagram in the switcher above. All
 * persistence, initial-versioning, and active-flag logic lives server-side.
 */
import { useActionState } from "react";
import type { CreateDiagramFormState } from "../diagram-actions";

type CreateAction = (
  prev: CreateDiagramFormState,
  formData: FormData,
) => Promise<CreateDiagramFormState>;

interface NewDiagramFormProps {
  readonly action: CreateAction;
}

const INITIAL: CreateDiagramFormState = {};

export function NewDiagramForm({ action }: NewDiagramFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-3">
      <label htmlFor="diagram-name" className="text-sm font-medium">
        New diagram
      </label>
      <div className="flex gap-2">
        <input
          id="diagram-name"
          name="name"
          type="text"
          required
          placeholder="e.g. Rig A"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create"}
        </button>
      </div>
      {state.error !== undefined ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
