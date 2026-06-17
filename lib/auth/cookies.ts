/**
 * Session-cookie helpers for the Next.js App Router (DEV-1134, FR-20).
 *
 * Server-only: reads/writes the httpOnly session cookie via `next/headers`,
 * which is itself server-only and throws if reached from client code. The raw
 * token is the cookie value; the server stores only its hash. Keeps cookie
 * mechanics out of the framework-agnostic auth service.
 */
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "./constants";

/** Persist the raw session token in an httpOnly, secure cookie. */
export async function setSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Read the raw session token from the request cookies, if present. */
export async function readSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value;
}

/** Clear the session cookie (logout). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
