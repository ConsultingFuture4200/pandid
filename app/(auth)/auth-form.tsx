"use client";

/**
 * Shared credential form for login + signup (DEV-1134, FR-20).
 *
 * Client component: drives a server action via `useActionState` and surfaces
 * the typed error message returned on failure. No credential logic here — it
 * only collects email/password and renders server-returned errors.
 */
import { useActionState } from "react";
import type { AuthFormState } from "./actions";

type AuthAction = (
  prev: AuthFormState,
  formData: FormData,
) => Promise<AuthFormState>;

interface AuthFormProps {
  readonly action: AuthAction;
  readonly submitLabel: string;
}

const INITIAL: AuthFormState = {};

export function AuthForm({ action, submitLabel }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>
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
        {pending ? "Working…" : submitLabel}
      </button>
    </form>
  );
}
