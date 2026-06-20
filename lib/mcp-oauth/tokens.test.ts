/**
 * Token + PKCE primitive tests (DEV-1147, FR-21).
 *
 * The crypto under the OAuth provider: opaque-token generation, hashing,
 * expiry, and the PKCE S256 check. Service-level flow lives in service.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  computeS256Challenge,
  generateOpaqueToken,
  hashToken,
  isExpired,
  verifyPkce,
} from "./tokens";

describe("opaque tokens", () => {
  it("generates high-entropy, unique, url-safe tokens", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43); // 256-bit base64url
  });

  it("hashes deterministically to a 64-char hex SHA-256", () => {
    const token = generateOpaqueToken();
    const h1 = hashToken(token);
    const h2 = hashToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isExpired", () => {
  it("treats null expiry as never-expiring", () => {
    expect(isExpired(null)).toBe(false);
  });
  it("compares against now", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isExpired(past)).toBe(true);
    expect(isExpired(future)).toBe(false);
  });
});

describe("PKCE S256", () => {
  it("computes a base64url challenge from a verifier", () => {
    const challenge = computeS256Challenge("abc".repeat(20));
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("verifies a matching verifier and rejects a mismatch", () => {
    const verifier = "k".repeat(64);
    const challenge = computeS256Challenge(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("wrong".repeat(13), challenge)).toBe(false);
  });
});
