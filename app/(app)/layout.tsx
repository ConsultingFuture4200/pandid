/**
 * Authenticated app shell (PRD §2.2, FR-20).
 *
 * Wraps the signed-in surfaces in the `(app)` route group (dashboard, diagrams)
 * with a single nav so a logged-in user can reach create-diagram and the editor
 * without typing URLs. Gated by `requireUser`; the email + logout live here so
 * each page doesn't re-implement them.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/current-user";
import { logoutAction } from "../(auth)/actions";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <Link href="/diagrams" className="hover:underline">
            Diagrams
          </Link>
          <Link href="/editor" className="hover:underline">
            Editor
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">{user.email}</span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded border border-gray-300 px-3 py-1.5 font-medium"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
