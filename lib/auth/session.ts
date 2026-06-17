/**
 * Session token primitives (DEV-1134, FR-20).
 *
 * A session token is an opaque, high-entropy random string handed to the
 * browser in a cookie. The server stores only its SHA-256 hash, so a leaked DB
 * row cannot be replayed as a valid cookie. Pure crypto over Node primitives.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "./constants";

/** Raw token entropy in bytes (256-bit). */
const TOKEN_BYTES = 32;

// Re-exported so existing importers of session.ts keep working. The canonical
// definitions live in the Edge-safe `constants.ts`.
export { SESSION_COOKIE_NAME, SESSION_TTL_MS };

/** Generate a fresh opaque session token (URL-safe base64, no padding). */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Hash a raw token for storage / lookup. Deterministic; hex-encoded SHA-256. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time comparison of two token hashes. Both are fixed-length hex
 * SHA-256 digests; a length mismatch is a non-match, never a throw.
 */
export function tokenHashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Compute the absolute expiry timestamp for a session created `now`. */
export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

/** True if the session is expired as of `now`. */
export function isExpired(expiresAt: string, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
