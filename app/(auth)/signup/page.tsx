/**
 * Signup page (DEV-1134, FR-20). Creates the account row + opens a session.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { signupAction } from "../actions";
import { AuthForm } from "../auth-form";

export default async function SignupPage() {
  if ((await getCurrentUser()) !== null) {
    redirect("/dashboard");
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Create account</h1>
      <AuthForm action={signupAction} submitLabel="Sign up" />
      <p className="text-sm text-gray-500">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
