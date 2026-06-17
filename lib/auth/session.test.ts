import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
  isExpired,
  sessionExpiry,
  tokenHashesEqual,
} from "./session";

describe("session tokens", () => {
  it("generates distinct high-entropy tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes deterministically to a 64-char hex digest", () => {
    const token = generateSessionToken();
    const h1 = hashSessionToken(token);
    const h2 = hashSessionToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("compares hashes in constant time, rejecting mismatches", () => {
    const h = hashSessionToken("tok");
    expect(tokenHashesEqual(h, h)).toBe(true);
    expect(tokenHashesEqual(h, hashSessionToken("other"))).toBe(false);
    expect(tokenHashesEqual(h, "short")).toBe(false);
  });

  it("computes expiry as creation + TTL", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const exp = sessionExpiry(now);
    expect(exp.getTime() - now.getTime()).toBe(SESSION_TTL_MS);
  });

  it("detects expiry relative to now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const past = new Date(now.getTime() - 1).toISOString();
    const future = new Date(now.getTime() + 1000).toISOString();
    expect(isExpired(past, now)).toBe(true);
    expect(isExpired(future, now)).toBe(false);
  });
});
