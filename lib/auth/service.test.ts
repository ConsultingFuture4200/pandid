import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthRepository } from "./in-memory-repository";
import { AuthService } from "./service";
import { AuthError } from "./types";
import { SESSION_TTL_MS } from "./session";

const EMAIL = "Operator@Example.com";
const PASSWORD = "a-strong-password";

describe("AuthService", () => {
  let repo: InMemoryAuthRepository;
  let service: AuthService;

  beforeEach(() => {
    repo = new InMemoryAuthRepository();
    service = new AuthService(repo);
  });

  describe("signup", () => {
    it("creates an account row and opens a session", async () => {
      const { user, token, expiresAt } = await service.signup({
        email: EMAIL,
        password: PASSWORD,
      });
      expect(user.email).toBe("operator@example.com"); // normalized lowercase
      expect(user.accountId).toMatch(/^[0-9a-f-]{36}$/);
      expect(token.length).toBeGreaterThan(0);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      // The account row backs session resolution.
      const resolved = await service.resolveSession(token);
      expect(resolved?.accountId).toBe(user.accountId);
    });

    it("rejects a duplicate email", async () => {
      await service.signup({ email: EMAIL, password: PASSWORD });
      await expect(
        service.signup({ email: "operator@example.com", password: PASSWORD }),
      ).rejects.toMatchObject({ code: "email_taken" });
    });

    it("rejects a weak password", async () => {
      await expect(
        service.signup({ email: EMAIL, password: "short" }),
      ).rejects.toMatchObject({ code: "weak_password" });
    });

    it("rejects malformed email", async () => {
      await expect(
        service.signup({ email: "not-an-email", password: PASSWORD }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    });
  });

  describe("login", () => {
    beforeEach(async () => {
      await service.signup({ email: EMAIL, password: PASSWORD });
    });

    it("opens a session for correct credentials", async () => {
      const { user, token } = await service.login({
        email: EMAIL,
        password: PASSWORD,
      });
      expect(user.email).toBe("operator@example.com");
      expect(await service.resolveSession(token)).not.toBeNull();
    });

    it("rejects a wrong password with invalid_credentials", async () => {
      await expect(
        service.login({ email: EMAIL, password: "wrong-password" }),
      ).rejects.toMatchObject({ code: "invalid_credentials" });
    });

    it("rejects an unknown email with invalid_credentials (no enumeration)", async () => {
      await expect(
        service.login({ email: "nobody@example.com", password: PASSWORD }),
      ).rejects.toMatchObject({ code: "invalid_credentials" });
    });

    it("throws AuthError, not a generic Error", async () => {
      const err = await service
        .login({ email: EMAIL, password: "wrong-password" })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuthError);
    });
  });

  describe("session lifecycle", () => {
    it("logout revokes the session token", async () => {
      const { token } = await service.signup({
        email: EMAIL,
        password: PASSWORD,
      });
      expect(await service.resolveSession(token)).not.toBeNull();
      await service.logout(token);
      expect(await service.resolveSession(token)).toBeNull();
    });

    it("logout is idempotent for an unknown token", async () => {
      await expect(service.logout("does-not-exist")).resolves.toBeUndefined();
    });

    it("resolveSession returns null for undefined/empty/unknown tokens", async () => {
      expect(await service.resolveSession(undefined)).toBeNull();
      expect(await service.resolveSession("")).toBeNull();
      expect(await service.resolveSession("bogus")).toBeNull();
    });

    it("persists a session across resolutions (session persistence)", async () => {
      const { token, user } = await service.signup({
        email: EMAIL,
        password: PASSWORD,
      });
      const first = await service.resolveSession(token);
      const second = await service.resolveSession(token);
      expect(first).toEqual(second);
      expect(first?.accountId).toBe(user.accountId);
    });

    it("prunes and rejects an expired session", async () => {
      const { token } = await service.signup({
        email: EMAIL,
        password: PASSWORD,
      });
      const afterExpiry = new Date(Date.now() + SESSION_TTL_MS + 1000);
      expect(await service.resolveSession(token, afterExpiry)).toBeNull();
      // pruned: even at "now" it is gone
      expect(await service.resolveSession(token)).toBeNull();
    });
  });
});
