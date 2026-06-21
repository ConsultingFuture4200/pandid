/**
 * Landing page. Routes a visitor into the app: signed-out users get
 * sign-in / create-account; signed-in users get the app surfaces (diagrams,
 * editor, dashboard). Server Component — resolves auth from the session.
 */
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";

const linkClass =
  "rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50";

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">Extraction P&amp;ID Co-Editor</h1>
        <p className="max-w-md text-sm text-gray-500">
          Design extraction-equipment P&amp;ID diagrams on a live canvas, with
          Claude proposing changes through your Desktop connector — you accept
          or reject every change.
        </p>
      </div>

      {user === null ? (
        <div className="flex gap-3">
          <Link href="/signup" className={linkClass}>
            Create account
          </Link>
          <Link href="/login" className={linkClass}>
            Sign in
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-gray-500">
            Signed in as <span className="font-medium">{user.email}</span>
          </p>
          <div className="flex gap-3">
            <Link href="/diagrams" className={linkClass}>
              Diagrams
            </Link>
            <Link href="/editor" className={linkClass}>
              Editor
            </Link>
            <Link href="/dashboard" className={linkClass}>
              Dashboard
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
