import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("produces a self-describing scrypt hash that verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("Tr0ub4dor&3", hash)).toBe(false);
  });

  it("salts: same password hashes differently each time", async () => {
    const a = await hashPassword("same-password-1");
    const b = await hashPassword("same-password-1");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password-1", a)).toBe(true);
    expect(await verifyPassword("same-password-1", b)).toBe(true);
  });

  it("refuses to hash a password shorter than the minimum", async () => {
    await expect(hashPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow(
      /at least/,
    );
  });

  it("returns false (never throws) on a malformed stored hash", async () => {
    expect(await verifyPassword("whatever", "not-a-valid-hash")).toBe(false);
    expect(await verifyPassword("whatever", "scrypt$bad")).toBe(false);
    expect(await verifyPassword("whatever", "")).toBe(false);
  });
});
