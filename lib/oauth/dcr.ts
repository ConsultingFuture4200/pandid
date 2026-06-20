/**
 * Dynamic Client Registration service (DEV-1148 / 15b, FR-21, PRD §5.6).
 *
 * Owns three things, and nothing else:
 *
 *   1. `register` — the RFC 7591 registration operation: validate client
 *      metadata, mint a `client_id` (+ secret for confidential clients), persist
 *      the client, return the registration response. Backs `/oauth/register`.
 *   2. `assertClientValid` — the client-validity primitive the token endpoint
 *      (DEV-1147) calls before issuing a token. An unknown/revoked `client_id`
 *      throws `OAuthError.invalidClient`, which the token route renders as HTTP
 *      401 `invalid_client` — the documented signal that a DCR client must
 *      re-register (RFC 6749 §5.2). This is the whole "401 re-registration"
 *      contract; the token endpoint consumes it without re-deriving it.
 *   3. `deleteClient` — revoke a registration (the deletion that makes a later
 *      token request 401 and trigger re-registration).
 *
 * Token issuance, the authorize endpoint, and the consent UI are DEV-1147's —
 * this module never mints access tokens. The boundary is deliberate: DCR and
 * token issuance are different RFCs and different tasks; the only coupling is
 * the `assertClientValid` call the token endpoint makes.
 */
import { createHash, randomBytes } from "node:crypto";
import type { OAuthClientRepository } from "./client-repository";
import {
  OAuthError,
  type ClientRegistrationRequest,
  type ClientRegistrationResponse,
  type OAuthClientRecord,
  clientRegistrationRequestSchema,
} from "./types";

/** Grant types this provider supports. */
const SUPPORTED_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
/** Response types this provider supports. */
const SUPPORTED_RESPONSE_TYPES = ["code"] as const;
const DEFAULT_GRANT_TYPES: readonly string[] = ["authorization_code"];
const DEFAULT_RESPONSE_TYPES: readonly string[] = ["code"];
const DEFAULT_AUTH_METHOD = "client_secret_basic";

/** Bytes of entropy for the issued client_id and client_secret. */
const CLIENT_ID_BYTES = 16;
const CLIENT_SECRET_BYTES = 32;

/** SHA-256 hex of a secret. Same hashing discipline as session tokens in auth. */
export function hashClientSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** A URL-safe random token (base64url, no padding). */
function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/** Generate a UUID for new client rows. */
function newId(): string {
  return crypto.randomUUID();
}

export class DcrService {
  constructor(private readonly repo: OAuthClientRepository) {}

  /**
   * Register a client (RFC 7591). Validates metadata, mints credentials,
   * persists the record, and returns the registration response. The raw secret
   * (confidential clients only) is in the response and is never stored or
   * recoverable afterward.
   *
   * @throws {OAuthError} `invalid_client_metadata` / `invalid_redirect_uri`
   *   (HTTP 400) when the request body is not valid registration metadata.
   */
  async register(input: unknown): Promise<ClientRegistrationResponse> {
    const parsed = clientRegistrationRequestSchema.safeParse(input);
    if (!parsed.success) {
      // Distinguish a redirect_uri problem (its own RFC 7591 error code) from
      // generic metadata problems, so a DCR client gets the actionable code.
      const redirectIssue = parsed.error.issues.find(
        (i) => i.path[0] === "redirect_uris",
      );
      if (redirectIssue) {
        throw new OAuthError(
          "invalid_redirect_uri",
          "Each redirect_uris entry must be an absolute URI, and at least one " +
            "is required. Fix the redirect_uris and re-register.",
          400,
        );
      }
      throw new OAuthError(
        "invalid_client_metadata",
        "The registration request is not valid client metadata. Send a JSON " +
          "object with at least redirect_uris (an array of absolute URIs).",
        400,
      );
    }

    const meta = parsed.data;
    this.assertSupportedGrants(meta);

    const authMethod = meta.token_endpoint_auth_method ?? DEFAULT_AUTH_METHOD;
    const isPublicClient = authMethod === "none";

    const clientId = randomToken(CLIENT_ID_BYTES);
    // Public clients (native apps using PKCE) get no secret; confidential
    // clients get one, returned once and stored only as a hash.
    const clientSecret = isPublicClient ? null : randomToken(CLIENT_SECRET_BYTES);

    const grantTypes = meta.grant_types ?? [...DEFAULT_GRANT_TYPES];
    const responseTypes = meta.response_types ?? [...DEFAULT_RESPONSE_TYPES];

    const record: OAuthClientRecord = {
      id: newId(),
      clientId,
      clientSecretHash:
        clientSecret === null ? null : hashClientSecret(clientSecret),
      redirectUris: meta.redirect_uris,
      clientName: meta.client_name ?? null,
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod: authMethod,
      scope: meta.scope ?? null,
      createdAt: new Date().toISOString(),
    };
    await this.repo.createClient(record);

    const response: ClientRegistrationResponse = {
      client_id: clientId,
      ...(clientSecret === null ? {} : { client_secret: clientSecret }),
      client_id_issued_at: Math.floor(Date.parse(record.createdAt) / 1000),
      redirect_uris: record.redirectUris,
      grant_types: record.grantTypes,
      response_types: record.responseTypes,
      token_endpoint_auth_method: record.tokenEndpointAuthMethod,
      ...(record.clientName === null ? {} : { client_name: record.clientName }),
      ...(record.scope === null ? {} : { scope: record.scope }),
    };
    return response;
  }

  /**
   * Resolve and validate a `client_id` for the token endpoint (DEV-1147).
   *
   * Returns the registered client when it exists; throws
   * `OAuthError.invalidClient` (HTTP 401, `error: invalid_client`) when the
   * client is unknown or was deleted. That 401 is the documented re-register
   * trigger — a DCR client (Claude Desktop) discards its registration and hits
   * `/register` again. The token endpoint must NOT swallow this error: it
   * renders it on the wire so re-registration can happen.
   *
   * @throws {OAuthError} `invalid_client` (HTTP 401) when the client is unknown.
   */
  async assertClientValid(clientId: string): Promise<OAuthClientRecord> {
    if (typeof clientId !== "string" || clientId.length === 0) {
      throw OAuthError.invalidClient(String(clientId));
    }
    const client = await this.repo.findByClientId(clientId);
    if (client === null) {
      throw OAuthError.invalidClient(clientId);
    }
    return client;
  }

  /**
   * Revoke a registration. Idempotent. After this, `assertClientValid` for the
   * same `client_id` throws 401 invalid_client, so the next token request
   * triggers re-registration — the deletion arm of the re-registration contract.
   */
  async deleteClient(clientId: string): Promise<void> {
    await this.repo.deleteByClientId(clientId);
  }

  /**
   * Reject grant/response types this provider does not support, with the RFC
   * 7591 metadata error. We only run the authorization-code + refresh-token
   * flow Claude Desktop's connector uses.
   */
  private assertSupportedGrants(meta: ClientRegistrationRequest): void {
    const grants = meta.grant_types;
    if (grants !== undefined) {
      const bad = grants.find(
        (g) => !(SUPPORTED_GRANT_TYPES as readonly string[]).includes(g),
      );
      if (bad !== undefined) {
        throw new OAuthError(
          "invalid_client_metadata",
          `Unsupported grant_type "${bad}". This server supports: ` +
            `${SUPPORTED_GRANT_TYPES.join(", ")}.`,
          400,
        );
      }
    }
    const responses = meta.response_types;
    if (responses !== undefined) {
      const bad = responses.find(
        (r) => !(SUPPORTED_RESPONSE_TYPES as readonly string[]).includes(r),
      );
      if (bad !== undefined) {
        throw new OAuthError(
          "invalid_client_metadata",
          `Unsupported response_type "${bad}". This server supports: ` +
            `${SUPPORTED_RESPONSE_TYPES.join(", ")}.`,
          400,
        );
      }
    }
  }
}
