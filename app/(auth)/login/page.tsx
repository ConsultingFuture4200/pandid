/**
 * Login page (DEV-1134, FR-20). Already-authenticated users skip to the
 * post-login target. A `?next=` param (e.g. the MCP /authorize URL that bounced
 * an unauthenticated user here) is honored only when it is a safe same-origin
 * path — `safeNextPath` is the single open-redirect guard.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loginAction } from "../actions";
import { AuthForm } from "../auth-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(Array.isArray(rawNext) ? rawNext[0] : rawNext);

  if ((await getCurrentUser()) !== null) {
    redirect(next);
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <AuthForm action={loginAction} submitLabel="Log in" next={next} />
      <p className="text-sm text-gray-500">
        No account?{" "}
        <Link href="/signup" className="underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
