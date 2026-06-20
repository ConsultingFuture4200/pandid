/**
 * DCR service tests (DEV-1148 / 15b, FR-21).
 *
 * Covers the automatable half of this 🔴 task: registration (RFC 7591) and the
 * 401 invalid_client re-registration contract (RFC 6749 §5.2). The live Desktop
 * DCR round-trip is human-verified (docs/HUMAN-VERIFY-DEV-1148.md) and not
 * asserted here.
 */
import { describe, expect, it } from "vitest";
import { DcrService, hashClientSecret } from "./dcr";
import { InMemoryOAuthClientRepository } from "./in-memory-client-repository";
import { OAuthError, INVALID_CLIENT_STATUS } from "./types";
import type { OAuthClientRepository } from "./client-repository";

function makeService(): { svc: DcrService; repo: OAuthClientRepository } {
  const repo = new InMemoryOAuthClientRepository();
  return { svc: new DcrService(repo), repo };
}

const VALID_METADATA = {
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  client_name: "Claude Desktop",
};

describe("DcrService.register", () => {
  it("registers a confidential client and issues id + secret", async () => {
    const { svc } = makeService();
    const res = await svc.register(VALID_METADATA);

    expect(res.client_id).toBeTruthy();
    expect(res.client_secret).toBeTruthy();
    expect(typeof res.client_id_issued_at).toBe("number");
    expect(res.redirect_uris).toEqual(VALID_METADATA.redirect_uris);
    expect(res.grant_types).toEqual(["authorization_code"]);
    expect(res.response_types).toEqual(["code"]);
    expect(res.token_endpoint_auth_method).toBe("client_secret_basic");
    expect(res.client_name).toBe("Claude Desktop");
  });

  it("issues no secret for a public client (token_endpoint_auth_method=none)", async () => {
    const { svc } = makeService();
    const res = await svc.register({
      ...VALID_METADATA,
      token_endpoint_auth_method: "none",
    });
    expect(res.client_id).toBeTruthy();
    expect(res.client_secret).toBeUndefined();
    expect(res.token_endpoint_auth_method).toBe("none");
  });

  it("persists only the secret hash, never the raw secret", async () => {
    const { svc, repo } = makeService();
    const res = await svc.register(VALID_METADATA);
    const stored = await repo.findByClientId(res.client_id);
    expect(stored).not.toBeNull();
    expect(stored?.clientSecretHash).toBe(
      hashClientSecret(res.client_secret as string),
    );
    // The raw secret must not equal what's stored.
    expect(stored?.clientSecretHash).not.toBe(res.client_secret);
  });

  it("issues unique client_ids across registrations", async () => {
    const { svc } = makeService();
    const a = await svc.register(VALID_METADATA);
    const b = await svc.register(VALID_METADATA);
    expect(a.client_id).not.toBe(b.client_id);
  });

  it("preserves extension metadata members without failing (RFC 7591 loose)", async () => {
    const { svc } = makeService();
    const res = await svc.register({
      ...VALID_METADATA,
      software_id: "x",
      contacts: ["a@b.com"],
    });
    expect(res.client_id).toBeTruthy();
  });

  it("rejects a missing redirect_uris with invalid_redirect_uri (400)", async () => {
    const { svc } = makeService();
    await expect(svc.register({ client_name: "no uris" })).rejects.toMatchObject(
      { code: "invalid_redirect_uri", httpStatus: 400 },
    );
  });

  it("rejects a non-absolute redirect_uri with invalid_redirect_uri (400)", async () => {
    const { svc } = makeService();
    await expect(
      svc.register({ redirect_uris: ["/relative/path"] }),
    ).rejects.toMatchObject({ code: "invalid_redirect_uri", httpStatus: 400 });
  });

  it("rejects a non-object body with invalid_client_metadata (400)", async () => {
    const { svc } = makeService();
    await expect(svc.register("not an object")).rejects.toMatchObject({
      code: "invalid_client_metadata",
      httpStatus: 400,
    });
  });

  it("rejects an unsupported grant_type with invalid_client_metadata (400)", async () => {
    const { svc } = makeService();
    await expect(
      svc.register({
        ...VALID_METADATA,
        grant_types: ["client_credentials"],
      }),
    ).rejects.toMatchObject({
      code: "invalid_client_metadata",
      httpStatus: 400,
    });
  });

  it("rejects an unsupported response_type with invalid_client_metadata (400)", async () => {
    const { svc } = makeService();
    await expect(
      svc.register({ ...VALID_METADATA, response_types: ["token"] }),
    ).rejects.toMatchObject({
      code: "invalid_client_metadata",
      httpStatus: 400,
    });
  });

  it("accepts the supported authorization_code + refresh_token grants", async () => {
    const { svc } = makeService();
    const res = await svc.register({
      ...VALID_METADATA,
      grant_types: ["authorization_code", "refresh_token"],
    });
    expect(res.grant_types).toEqual(["authorization_code", "refresh_token"]);
  });
});

describe("DcrService.assertClientValid — 401 re-registration contract", () => {
  it("returns the registered client for a known client_id", async () => {
    const { svc } = makeService();
    const res = await svc.register(VALID_METADATA);
    const client = await svc.assertClientValid(res.client_id);
    expect(client.clientId).toBe(res.client_id);
  });

  it("throws 401 invalid_client for an unknown client_id", async () => {
    const { svc } = makeService();
    await expect(svc.assertClientValid("never-registered")).rejects.toMatchObject(
      { code: "invalid_client", httpStatus: INVALID_CLIENT_STATUS },
    );
  });

  it("throws 401 invalid_client for an empty client_id", async () => {
    const { svc } = makeService();
    await expect(svc.assertClientValid("")).rejects.toBeInstanceOf(OAuthError);
    await expect(svc.assertClientValid("")).rejects.toMatchObject({
      code: "invalid_client",
      httpStatus: 401,
    });
  });

  it("throws 401 invalid_client after the client is deleted (re-register signal)", async () => {
    const { svc } = makeService();
    const res = await svc.register(VALID_METADATA);
    // Valid before deletion.
    await expect(svc.assertClientValid(res.client_id)).resolves.toBeTruthy();
    await svc.deleteClient(res.client_id);
    // After deletion the token endpoint gets 401 invalid_client → re-register.
    await expect(svc.assertClientValid(res.client_id)).rejects.toMatchObject({
      code: "invalid_client",
      httpStatus: 401,
    });
  });

  it("OAuthError.invalidClient carries the 401 status and invalid_client code", () => {
    const err = OAuthError.invalidClient("abc");
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.code).toBe("invalid_client");
    expect(err.httpStatus).toBe(401);
    expect(err.message).toContain("abc");
  });

  it("re-registration after deletion yields a fresh, valid client_id", async () => {
    const { svc } = makeService();
    const first = await svc.register(VALID_METADATA);
    await svc.deleteClient(first.client_id);
    const second = await svc.register(VALID_METADATA);
    expect(second.client_id).not.toBe(first.client_id);
    await expect(svc.assertClientValid(second.client_id)).resolves.toBeTruthy();
  });

  it("deleteClient is idempotent", async () => {
    const { svc } = makeService();
    await expect(svc.deleteClient("nope")).resolves.toBeUndefined();
    await expect(svc.deleteClient("nope")).resolves.toBeUndefined();
  });
});
