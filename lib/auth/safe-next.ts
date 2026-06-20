/**
 * Safe post-login redirect target (DEV-1134, FR-20; DEV-1147 `/authorize` seam).
 *
 * The MCP `/authorize` endpoint sends an unauthenticated user to
 * `/login?next=<authorize-url>` so they return to the OAuth flow after signing
 * in. Login must honor `next` — but ONLY when it is a safe, same-origin relative
 * path. An attacker-controlled `next` is a classic open-redirect: feeding it to
 * a redirect could bounce the freshly-authenticated user to a phishing origin.
 *
 * Accept only paths that:
 *   - start with a single `/` (relative to this origin), and
 *   - do NOT start with `//` or `/\` (protocol-relative → another origin), and
 *   - contain no backslashes (some clients normalize `\` to `/`), and
 *   - contain no whitespace or ASCII control characters (which a URL parser may
 *     strip, smuggling a scheme past the leading-slash check).
 *
 * Anything else falls back to the caller's default (the dashboard). Returning a
 * value the caller passes straight to `redirect()` keeps the open-redirect guard
 * in exactly one place.
 */

/** Default post-login destination when no safe `next` is supplied. */
export const DEFAULT_POST_LOGIN_PATH = "/dashboard";

/** Whitespace or ASCII control characters (U+0000..U+0020, plus DEL U+007F). */
const UNSAFE_CHARS = /[\u0000-\u0020\u007f]/;

/**
 * Resolve a post-login redirect target from an untrusted `next` value, falling
 * back to {@link DEFAULT_POST_LOGIN_PATH} (or a supplied default) when `next` is
 * absent or unsafe.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback: string = DEFAULT_POST_LOGIN_PATH,
): string {
  return isSafeNextPath(next) ? next : fallback;
}

/** True when `next` is a safe same-origin relative path (see module docs). */
export function isSafeNextPath(next: string | null | undefined): next is string {
  if (typeof next !== "string" || next.length === 0) {
    return false;
  }
  // Must be origin-relative.
  if (!next.startsWith("/")) {
    return false;
  }
  // Protocol-relative (`//host`) or `/\host` escape to another origin.
  if (next.startsWith("//") || next.startsWith("/\\")) {
    return false;
  }
  // Backslashes can be normalized to `/` by browsers/clients → treat as unsafe.
  if (next.includes("\\")) {
    return false;
  }
  // Whitespace / control chars can smuggle a scheme past the checks above.
  if (UNSAFE_CHARS.test(next)) {
    return false;
  }
  return true;
}
