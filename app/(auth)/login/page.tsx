/**
 * Login page (DEV-1134, FR-20). Already-authenticated users skip to dashboard.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loginAction } from "../actions";
import { AuthForm } from "../auth-form";

export default async function LoginPage() {
  if ((await getCurrentUser()) !== null) {
    redirect("/dashboard");
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <AuthForm action={loginAction} submitLabel="Log in" />
      <p className="text-sm text-gray-500">
        No account?{" "}
        <Link href="/signup" className="underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
