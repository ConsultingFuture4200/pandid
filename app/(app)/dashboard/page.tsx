/**
 * Protected dashboard (DEV-1134, FR-20).
 *
 * The signed-in landing surface. Auth + the email/logout/nav live in the
 * `(app)` layout; this page orients the user and links to the two things they
 * need next: managing diagrams (create / pick the active one) and the editor.
 */
import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";

export default async function DashboardPage() {
  const user = await requireUser();
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-gray-500">
        Signed in as <span className="font-medium">{user.email}</span>
      </p>
      <div className="flex gap-3">
        <Link
          href="/diagrams"
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white"
        >
          Diagrams
        </Link>
        <Link
          href="/editor"
          className="rounded border border-gray-300 px-3 py-2 text-sm font-medium"
        >
          Open editor
        </Link>
      </div>
    </main>
  );
}
