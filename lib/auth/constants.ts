/**
 * Edge-safe auth constants (DEV-1134, FR-20).
 *
 * Plain values with no `node:crypto` dependency, so the Edge-runtime
 * middleware can import the cookie name without pulling in Node crypto (which
 * the Edge Runtime rejects). `session.ts` re-uses these for the Node path.
 */

/** Name of the cookie carrying the raw session token. */
export const SESSION_COOKIE_NAME = "pid_session";

/** Session lifetime. Persistence ("remember me") is the default for this app. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
