/**
 * OAuth Dynamic Client Registration types + Zod boundary schemas
 * (DEV-1148 / 15b, FR-21, PRD §5.6).
 *
 * Models the Dynamic Client Registration protocol (RFC 7591) and the
 * `invalid_client` error contract (RFC 6749 §5.2) that drives 401
 * re-registration. Claude Desktop's custom connector performs DCR against the
 * `/register` endpoint to obtain a `client_id`, then runs the OAuth code flow
 * (token issuance is DEV-1147's authorize/token endpoints — this module owns
 * only registration + the client store + the client-validity primitive that the
 * token endpoint calls).
 *
 * Why this lives apart from web-login auth (`lib/auth`): the account identity is
 * auth-mechanism-agnostic (PRD §7 / DEV-1130). DCR adds its own client storage
 * without touching `auth_credentials`, exactly as the auth migration noted.
 */
import { z } from "zod";
import { isoTimestampSchema, uuidSchema } from "@/lib/types";

/**
 * OAuth token-endpoint-style error codes we emit. Only the subset this task
 * owns is modeled: registration-input failures and the `invalid_client` signal
 * that an unknown/deleted client must re-register (RFC 6749 §5.2, RFC 7591 §3.2.2).
 */
export type OAuthErrorCode =
  | "invalid_client"
  | "invalid_client_metadata"
  | "invalid_redirect_uri";

/**
 * The HTTP status RFC 6749 §5.2 pairs with `invalid_client`: 401. Returning
 * 401 `invalid_client` from the token endpoint is the documented signal that
 * tells a DCR-capable client (Claude Desktop) to discard its registration and
 * re-register. Other registration-input errors are 400 (RFC 7591 §3.2.2).
 */
export const INVALID_CLIENT_STATUS = 401;
export const INVALID_CLIENT_METADATA_STATUS = 400;

/**
 * Typed OAuth failure. The `code` is the RFC error code emitted in the JSON
 * body (`{"error": code, "error_description": message}`); `httpStatus` is the
 * status the HTTP adapter sets. Carries a `WWW-Authenticate` value for the 401
 * case so the route can return it verbatim (RFC 6750 / 6749 §5.2).
 */
export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly httpStatus: number;
  constructor(code: OAuthErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.httpStatus = httpStatus;
  }

  /**
   * The standard signal an unknown/deleted client must re-register: HTTP 401
   * with `error: "invalid_client"`. The token endpoint (DEV-1147) calls
   * {@link assertClientValid}, which throws this; a DCR client reacts by hitting
   * `/register` again. This is the entire "401 re-registration" contract.
   */
  static invalidClient(clientId: string): OAuthError {
    return new OAuthError(
      "invalid_client",
      `Unknown or revoked client "${clientId}". Re-register via the ` +
        "registration endpoint, then retry the OAuth flow.",
      INVALID_CLIENT_STATUS,
    );
  }
}

/**
 * Registration request metadata (RFC 7591 §2). We accept the full documented
 * shape but only constrain the fields the connector OAuth flow relies on. A
 * public client (Claude Desktop is a native app using PKCE) need not present a
 * secret; we still issue one and accept either `token_endpoint_auth_method`.
 *
 * Unknown members are allowed (RFC 7591 permits extension metadata) and ignored.
 */
export const clientRegistrationRequestSchema = z
  .object({
    /**
     * Redirect URIs the client may use in the authorization code flow. Required
     * for the `authorization_code` grant. Each must be an absolute URI.
     */
    redirect_uris: z
      .array(z.string().url())
      .min(1, "At least one redirect_uri is required."),
    /** Optional human-facing client name shown on the consent screen. */
    client_name: z.string().trim().min(1).max(256).optional(),
    /** Requested grant types. We support authorization_code (+ refresh_token). */
    grant_types: z.array(z.string()).optional(),
    /** Requested response types. We support `code`. */
    response_types: z.array(z.string()).optional(),
    /** Space-delimited scopes the client requests. Optional at registration. */
    scope: z.string().optional(),
    /**
     * How the client authenticates at the token endpoint. Native apps use
     * `none` (public client + PKCE). Defaults to `client_secret_basic`.
     */
    token_endpoint_auth_method: z
      .enum(["none", "client_secret_basic", "client_secret_post"])
      .optional(),
  })
  .loose();
export type ClientRegistrationRequest = z.infer<
  typeof clientRegistrationRequestSchema
>;

/**
 * A persisted registered OAuth client (the DCR-owned store). The plaintext
 * secret is never stored — only its hash, mirroring session-token handling in
 * `lib/auth`. The raw secret is returned to the client exactly once, in the
 * registration response.
 */
export interface OAuthClientRecord {
  readonly id: string;
  /** Public OAuth client identifier issued at registration. */
  readonly clientId: string;
  /**
   * SHA-256 of the issued client secret, or null for a public client
   * (`token_endpoint_auth_method: "none"`). Never the raw secret.
   */
  readonly clientSecretHash: string | null;
  readonly redirectUris: readonly string[];
  readonly clientName: string | null;
  readonly grantTypes: readonly string[];
  readonly responseTypes: readonly string[];
  readonly tokenEndpointAuthMethod: string;
  readonly scope: string | null;
  readonly createdAt: string;
}

export const oauthClientRecordSchema = z.object({
  id: uuidSchema,
  clientId: z.string().min(1),
  clientSecretHash: z.string().length(64).nullable(),
  redirectUris: z.array(z.string().url()).min(1),
  clientName: z.string().nullable(),
  grantTypes: z.array(z.string()),
  responseTypes: z.array(z.string()),
  tokenEndpointAuthMethod: z.string(),
  scope: z.string().nullable(),
  createdAt: isoTimestampSchema,
});

/**
 * Registration response body (RFC 7591 §3.2.1). `client_secret` is present only
 * for confidential clients and is returned exactly once. `client_id_issued_at`
 * is seconds since the epoch per the spec.
 */
export interface ClientRegistrationResponse {
  readonly client_id: string;
  readonly client_secret?: string;
  readonly client_id_issued_at: number;
  readonly redirect_uris: readonly string[];
  readonly grant_types: readonly string[];
  readonly response_types: readonly string[];
  readonly token_endpoint_auth_method: string;
  readonly client_name?: string;
  readonly scope?: string;
}
