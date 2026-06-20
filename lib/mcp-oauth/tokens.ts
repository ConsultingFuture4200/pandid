/**
 * OAuth token + authorization-code primitives (DEV-1147, FR-21).
 *
 * Pure crypto over Node primitives, mirroring the web-session design in
 * `lib/auth/session.ts`: opaque high-entropy strings handed to the client, of
 * which the server stores only the SHA-256 hash. A leaked token/code row cannot
 * be replayed.
 *
 * Also implements the PKCE S256 check (OAuth 2.1 / MCP 2025-11-25): the token
 * endpoint proves the client redeeming a code is the one that requested it,
 * with no shared secret.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Bearer-token / code entropy in bytes (256-bit). */
const TOKEN_BYTES = 32;

/**
 * Access-token lifetime (1 hour). Short, because Desktop holds a refresh token
 * and silently refreshes; a leaked access token expires quickly.
 */
export const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60;

/** Authorization-code lifetime (5 minutes) — single-use and short by design. */
export const AUTH_CODE_TTL_MS = 1000 * 60 * 5;

/** Generate a fresh opaque token/code (URL-safe base64, no padding). */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Hash a raw token/code for storage and lookup. Hex-encoded SHA-256. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** True if `expiresAt` (or null = never) is in the past as of `now`. */
export function isExpired(
  expiresAt: string | null,
  now: Date = new Date(),
): boolean {
  if (expiresAt === null) {
    return false;
  }
  return new Date(expiresAt).getTime() <= now.getTime();
}

/**
 * Compute the PKCE S256 challenge for a verifier: base64url(SHA-256(verifier)).
 * (RFC 7636 §4.2.) Used to recompute the expected challenge at code redemption.
 */
export function computeS256Challenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/**
 * Constant-time PKCE verification: does `codeVerifier` hash to `storedChallenge`?
 * A length mismatch is a non-match, never a throw.
 */
export function verifyPkce(
  codeVerifier: string,
  storedChallenge: string,
): boolean {
  const computed = computeS256Challenge(codeVerifier);
  const a = Buffer.from(computed);
  const b = Buffer.from(storedChallenge);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
