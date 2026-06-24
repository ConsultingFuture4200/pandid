"use client";

/**
 * Template gallery (this task).
 *
 * Lets the signed-in user start a new diagram from a prebuilt template instead of
 * an empty canvas. Each card posts its `templateId` to the
 * `createDiagramFromTemplateAction` server action; on success the instantiated
 * diagram becomes the account's active diagram (the page revalidates and it shows
 * in the switcher above), ready to open in the editor. All instantiation —
 * create, seed the version, set active — lives server-side.
 */
import { useActionState } from "react";
import type { CreateDiagramFormState } from "../diagram-actions";
import type { TemplateSummary } from "@/lib/templates";

type TemplateAction = (
  prev: CreateDiagramFormState,
  formData: FormData,
) => Promise<CreateDiagramFormState>;

interface TemplateGalleryProps {
  readonly templates: readonly TemplateSummary[];
  readonly action: TemplateAction;
}

const INITIAL: CreateDiagramFormState = {};

export function TemplateGallery({ templates, action }: TemplateGalleryProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  if (templates.length === 0) {
    return null;
  }

  return (
    <section className="flex w-full max-w-md flex-col gap-3">
      <h2 className="text-sm font-medium">Start from a template</h2>
      <ul className="flex flex-col gap-2">
        {templates.map((t) => (
          <li
            key={t.id}
            className="flex flex-col gap-2 rounded border border-gray-300 p-3"
          >
            <div>
              <p className="text-sm font-medium">{t.name}</p>
              <p className="text-xs text-gray-500">{t.description}</p>
            </div>
            <form action={formAction} className="flex justify-end">
              <input type="hidden" name="templateId" value={t.id} />
              <button
                type="submit"
                disabled={pending}
                className="rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {pending ? "Creating…" : "Use template"}
              </button>
            </form>
          </li>
        ))}
      </ul>
      {state.error !== undefined ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
