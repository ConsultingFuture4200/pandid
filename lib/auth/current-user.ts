/**
 * Server-side current-user resolution (DEV-1134, FR-20).
 *
 * Reads the session cookie, resolves it through the auth service, and returns
 * the authenticated principal (or null). Used by Server Components and server
 * actions to gate protected pages. The middleware does a cheap cookie-presence
 * check for redirects; this is the authoritative resolution.
 */
import { redirect } from "next/navigation";
import { getAuthService } from "./index";
import { readSessionCookie } from "./cookies";
import type { AuthenticatedUser } from "./types";

/** Resolve the authenticated user from the request session, or null. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = await readSessionCookie();
  return getAuthService().resolveSession(token);
}

/** Like {@link getCurrentUser} but redirects to /login when unauthenticated. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (user === null) {
    redirect("/login");
  }
  return user;
}
