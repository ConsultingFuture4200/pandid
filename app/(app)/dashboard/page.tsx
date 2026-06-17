/**
 * Protected dashboard placeholder (DEV-1134, FR-20).
 *
 * Demonstrates the authenticated surface: gated by `requireUser`, shows the
 * logged-in email and a logout control. The real editor UI is owned by the
 * canvas task (DEV-1137); this page only proves auth + protected routing.
 */
import { requireUser } from "@/lib/auth/current-user";
import { logoutAction } from "../../(auth)/actions";

export default async function DashboardPage() {
  const user = await requireUser();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-gray-500">
        Signed in as <span className="font-medium">{user.email}</span>
      </p>
      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded border border-gray-300 px-3 py-2 text-sm font-medium"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
