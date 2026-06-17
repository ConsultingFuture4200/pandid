"use server";

/**
 * Auth server actions (DEV-1134, FR-20).
 *
 * Thin adapter between the login/signup forms and the framework-agnostic
 * `AuthService`: it validates form input, calls the service, sets/clears the
 * session cookie, and redirects. All credential logic lives in the service.
 */
import { redirect } from "next/navigation";
import {
  AuthError,
  getAuthService,
  type AuthErrorCode,
} from "@/lib/auth";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "@/lib/auth/cookies";

/** Form state surfaced back to the page on failure. */
export interface AuthFormState {
  readonly error?: string;
  readonly code?: AuthErrorCode;
}

function fields(formData: FormData): { email: string; password: string } {
  return {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signupAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const service = getAuthService();
  try {
    const { user, token, expiresAt } = await service.signup(fields(formData));
    await setSessionCookie(token, expiresAt);
    void user;
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: err.message, code: err.code };
    }
    throw err;
  }
  redirect("/dashboard");
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const service = getAuthService();
  try {
    const { token, expiresAt } = await service.login(fields(formData));
    await setSessionCookie(token, expiresAt);
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: err.message, code: err.code };
    }
    throw err;
  }
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionCookie();
  if (token !== undefined) {
    await getAuthService().logout(token);
  }
  await clearSessionCookie();
  redirect("/login");
}
