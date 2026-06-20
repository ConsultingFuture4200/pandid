/**
 * MCP OAuth provider domain types + Zod boundary schemas (DEV-1147, FR-21).
 *
 * This module backs the **account-based pairing** for the MCP custom connector:
 * Claude Desktop adds the connector and authenticates via an OAuth 2.0
 * authorization-code + PKCE flow whose authorization server IS this app. The
 * tokens it issues are **scoped to a single account** (PRD §4: "the connector is
 * account-scoped — it acts on whatever diagram is active for that account").
 *
 * Scope boundary with sibling tasks:
 *   - Web login + the `accountId` principal are owned by DEV-1134 (`lib/auth`).
 *     This module references an account by id; it never re-models credentials.
 *   - **Dynamic Client Registration** (registering NEW connector clients) and the
 *     401 → re-registration handshake are DEV-1148. This module models a client
 *     by reference (`OAuthClient`) and validates against an already-registered
 *     one; it does not implement the `/register` endpoint. The repository
 *     interface exposes `findClient` so DCR can add `createClient` beside it
 *     without touching issuance/validation.
 *   - The MCP server's `ContextResolver` seam is owned by DEV-1145, and
 *     account → active-diagram resolution is DEV-1149. This module exposes a
 *     bearer-token → accountId resolver (`OAuthService.resolveAccessToken`) that
 *     those tasks consume; it does not edit the MCP server.
 *
 * Tokens are stored **hashed** (SHA-256), mirroring the web-session design in
 * `lib/auth/session.ts`: the raw token only ever leaves the server in the token
 * response body, so a leaked DB row cannot be replayed.
 */
import { z } from "zod";
import { isoTimestampSchema, uuidSchema } from "@/lib/types";

/**
 * The single OAuth scope this provider grants in v1. The connector acts on the
 * account's active diagram; there is no finer-grained scope surface yet, so a
 * token either carries account access or it does not. Modeled explicitly so a
 * v2 read-only / per-diagram scope split is additive, not a reinterpretation of
 * an absent value.
 */
export const MCP_OAUTH_SCOPE = "mcp" as const;

/**
 * PKCE code-challenge method. Per the MCP authorization spec (2025-11-25) and
 * OAuth 2.1, only `S256` is accepted — plain challenges are refused so a token
 * can never be obtained without proving possession of the verifier.
 */
export const CODE_CHALLENGE_METHOD = "S256" as const;

/**
 * A registered OAuth client (the connector). Created by DCR (DEV-1148); this
 * module only reads it to validate authorization/token requests. `redirectUris`
 * is the exact allow-list a returned authorization code may be delivered to.
 */
export interface OAuthClient {
  readonly clientId: string;
  /** Exact-match allow-list of redirect URIs. No wildcards (OAuth 2.1). */
  readonly redirectUris: readonly string[];
  readonly createdAt: string;
}

/**
 * A short-lived authorization code, bound to the account that approved it and
 * to the PKCE challenge presented at the authorization step. Single-use: the
 * token endpoint deletes it on redemption (replay yields `invalid_grant`).
 */
export interface AuthorizationCode {
  /** SHA-256 of the opaque code. The raw code only travels in the redirect. */
  readonly codeHash: string;
  readonly clientId: string;
  /** The account that completed web login and approved this authorization. */
  readonly accountId: string;
  /** Exact redirect URI the code was issued for; rechecked at redemption. */
  readonly redirectUri: string;
  /** PKCE: base64url SHA-256 of the verifier the client will later present. */
  readonly codeChallenge: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * A persisted access token, scoped to one account. Stored hashed. An optional
 * expiry supports the access/refresh split; a refresh token is itself a token
 * row of kind `refresh` so one storage shape serves both.
 */
export interface AccessTokenRecord {
  /** SHA-256 of the opaque bearer token. */
  readonly tokenHash: string;
  readonly kind: TokenKind;
  readonly clientId: string;
  /** The account every operation under this token is scoped to (FR-6, PRD §4). */
  readonly accountId: string;
  readonly scope: string;
  readonly createdAt: string;
  /** Absolute expiry; `null` for refresh tokens, which are long-lived. */
  readonly expiresAt: string | null;
}

export const tokenKindSchema = z.enum(["access", "refresh"]);
export type TokenKind = z.infer<typeof tokenKindSchema>;

export const oauthClientSchema = z.object({
  clientId: z.string().min(1),
  redirectUris: z.array(z.string().url()).min(1),
  createdAt: isoTimestampSchema,
});

export const authorizationCodeSchema = z.object({
  codeHash: z.string().length(64),
  clientId: z.string().min(1),
  accountId: uuidSchema,
  redirectUri: z.string().url(),
  codeChallenge: z.string().min(1),
  createdAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema,
});

export const accessTokenRecordSchema = z.object({
  tokenHash: z.string().length(64),
  kind: tokenKindSchema,
  clientId: z.string().min(1),
  accountId: uuidSchema,
  scope: z.string().min(1),
  createdAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema.nullable(),
});

/**
 * The principal a validated access token resolves to. This is what the MCP
 * context resolver (DEV-1145 seam) and active-diagram scoping (DEV-1149) build
 * a `TransportContext` from. Deliberately minimal: an account id + the scope.
 */
export interface OAuthPrincipal {
  readonly accountId: string;
  readonly clientId: string;
  readonly scope: string;
}

/**
 * Inputs to the authorization endpoint (the `?query` of `/authorize`), after
 * the human has completed web login. `response_type=code` and the `S256` PKCE
 * method are the only accepted shapes (OAuth 2.1 / MCP 2025-11-25).
 */
export const authorizationRequestSchema = z.object({
  responseType: z.literal("code"),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  codeChallenge: z.string().min(1),
  codeChallengeMethod: z.literal(CODE_CHALLENGE_METHOD),
  /** Opaque client state, echoed back on the redirect (CSRF binding). */
  state: z.string().optional(),
  /** Requested scope; must be exactly the single `mcp` scope when present. */
  scope: z.string().optional(),
});
export type AuthorizationRequest = z.infer<typeof authorizationRequestSchema>;

/**
 * Inputs to the token endpoint. A discriminated union over `grant_type`: the
 * authorization-code redemption and the refresh-token exchange. Field names are
 * snake_case to match the on-the-wire form-encoded body (RFC 6749 §4.1.3/§6).
 */
export const tokenRequestSchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    redirect_uri: z.string().url(),
    client_id: z.string().min(1),
    /** PKCE verifier; SHA-256 must equal the stored challenge. */
    code_verifier: z.string().min(43).max(128),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1),
  }),
]);
export type TokenRequest = z.infer<typeof tokenRequestSchema>;

/**
 * The token endpoint success body (RFC 6749 §5.1). `expires_in` is seconds.
 * Raw tokens — the only place they leave the server.
 */
export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

/**
 * OAuth error codes this provider emits (subset of RFC 6749 §4.1.2.1 / §5.2
 * plus the spec's `invalid_token`). Carried by {@link OAuthError}; the HTTP
 * layer maps each to its status + JSON/redirect form.
 */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "access_denied"
  | "invalid_token"
  | "server_error";

/**
 * Typed OAuth failure. Messages say what happened + how to fix (CLAUDE.md). The
 * `code` is the RFC 6749 `error` field; the HTTP layer renders it to the right
 * status and body/redirect.
 */
export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  constructor(code: OAuthErrorCode, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}
