/**
 * MCP OAuth provider service (DEV-1147, FR-21).
 *
 * The authorization-server core for the MCP custom connector. Three operations:
 *
 *   - `authorize`          — after the human completes web login and approves,
 *                            mint a single-use authorization code bound to the
 *                            account + the PKCE challenge.
 *   - `exchangeToken`      — redeem a code (PKCE-verified) for an account-scoped
 *                            access + refresh token, or refresh an access token.
 *   - `resolveAccessToken` — validate a bearer token and resolve it to the
 *                            account principal MCP tool calls run as. This is
 *                            the seam DEV-1145's `ContextResolver` and DEV-1149's
 *                            active-diagram scoping build a `TransportContext`
 *                            from.
 *
 * Architecture invariants:
 *   - **Account-scoped tokens** (PRD §4, FR-6): every issued token carries one
 *     `accountId`; `resolveAccessToken` never returns a token usable for another
 *     account. This is the pairing the whole propose-and-confirm flow rests on.
 *   - **Server is the single source of truth**: all client/code/token state goes
 *     through the `OAuthRepository`. Raw tokens are never persisted (hashed).
 *   - **One committer is untouched here**: OAuth grants *access*, not commit
 *     rights. A token lets Claude *propose*; committing remains the human's act
 *     on a different code path. Nothing in this module mutates diagram state.
 *
 * Refusals are typed `OAuthError`s (RFC 6749 error codes); the HTTP layer maps
 * them to statuses/redirects.
 */
import type { OAuthRepository } from "./repository";
import {
  ACCESS_TOKEN_TTL_MS,
  AUTH_CODE_TTL_MS,
  generateOpaqueToken,
  hashToken,
  isExpired,
  verifyPkce,
} from "./tokens";
import {
  MCP_OAUTH_SCOPE,
  OAuthError,
  type AuthorizationRequest,
  type OAuthPrincipal,
  type TokenRequest,
  type TokenResponse,
} from "./types";

/** Result of `authorize`: the raw code + the validated redirect (for the 302). */
export interface AuthorizationResult {
  /** Raw single-use authorization code to deliver on the redirect. */
  readonly code: string;
  /** The redirect URI the code must be delivered to (already allow-listed). */
  readonly redirectUri: string;
  /** Echoed client state, for the redirect's `state` param (CSRF binding). */
  readonly state?: string;
}

export class OAuthService {
  constructor(private readonly repo: OAuthRepository) {}

  /**
   * Approve an authorization request and mint a single-use code. The caller
   * (the /authorize route) must have already authenticated the web session and
   * resolved `accountId` — this method binds that account to the code. It does
   * NOT authenticate the human; that is the route's job (web login + consent).
   *
   * @throws {OAuthError} `invalid_client` unknown client, `invalid_request`
   *   redirect_uri not allow-listed, `invalid_scope` scope other than `mcp`.
   */
  async authorize(
    request: AuthorizationRequest,
    accountId: string,
    now: Date = new Date(),
  ): Promise<AuthorizationResult> {
    const client = await this.repo.findClient(request.clientId);
    if (client === null) {
      throw new OAuthError(
        "invalid_client",
        `Unknown client "${request.clientId}". Re-add the connector in Claude ` +
          "Desktop so it registers, then try connecting again.",
      );
    }
    if (!client.redirectUris.includes(request.redirectUri)) {
      throw new OAuthError(
        "invalid_request",
        "The redirect_uri is not registered for this client. The connector " +
          "must use the redirect URI it registered with.",
      );
    }
    if (request.scope !== undefined && request.scope !== MCP_OAUTH_SCOPE) {
      throw new OAuthError(
        "invalid_scope",
        `This connector grants only the "${MCP_OAUTH_SCOPE}" scope. Request ` +
          "that scope (or omit scope) when connecting.",
      );
    }

    const code = generateOpaqueToken();
    await this.repo.createAuthorizationCode({
      codeHash: hashToken(code),
      clientId: request.clientId,
      accountId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS).toISOString(),
    });

    return { code, redirectUri: request.redirectUri, state: request.state };
  }

  /**
   * Token endpoint. Redeems an authorization code (PKCE-verified) or a refresh
   * token for an account-scoped access + refresh token pair.
   *
   * @throws {OAuthError} `invalid_grant` for a bad/expired/replayed code or
   *   refresh token, a redirect_uri/client mismatch, or a failed PKCE check.
   */
  async exchangeToken(
    request: TokenRequest,
    now: Date = new Date(),
  ): Promise<TokenResponse> {
    if (request.grant_type === "authorization_code") {
      return this.exchangeAuthorizationCode(request, now);
    }
    return this.exchangeRefreshToken(request, now);
  }

  /**
   * Validate a bearer access token and resolve it to its account principal, or
   * null when the token is absent, unknown, the wrong kind (a refresh token), or
   * expired. Expired tokens are pruned. This is the function the MCP context
   * resolver (DEV-1145) and active-diagram scoping (DEV-1149) call per request.
   */
  async resolveAccessToken(
    rawToken: string | undefined,
    now: Date = new Date(),
  ): Promise<OAuthPrincipal | null> {
    if (rawToken === undefined || rawToken.length === 0) {
      return null;
    }
    const tokenHash = hashToken(rawToken);
    const record = await this.repo.findTokenByHash(tokenHash);
    if (record === null) {
      return null;
    }
    // A refresh token is not a bearer credential for tool calls.
    if (record.kind !== "access") {
      return null;
    }
    if (isExpired(record.expiresAt, now)) {
      await this.repo.deleteTokenByHash(tokenHash);
      return null;
    }
    return {
      accountId: record.accountId,
      clientId: record.clientId,
      scope: record.scope,
    };
  }

  // --- internals -----------------------------------------------------------

  private async exchangeAuthorizationCode(
    request: Extract<TokenRequest, { grant_type: "authorization_code" }>,
    now: Date,
  ): Promise<TokenResponse> {
    // Single-use: consume (fetch-and-delete) so a replay finds nothing.
    const code = await this.repo.consumeAuthorizationCode(hashToken(request.code));
    if (code === null) {
      throw new OAuthError(
        "invalid_grant",
        "The authorization code is invalid, expired, or already used. Restart " +
          "the connector sign-in in Claude Desktop to get a new one.",
      );
    }
    if (isExpired(code.expiresAt, now)) {
      throw new OAuthError(
        "invalid_grant",
        "The authorization code has expired. Restart the connector sign-in in " +
          "Claude Desktop.",
      );
    }
    // The redeeming client and redirect must match the ones the code was issued
    // for (RFC 6749 §4.1.3) — defends against code injection across clients.
    if (code.clientId !== request.client_id) {
      throw new OAuthError(
        "invalid_grant",
        "This authorization code was issued to a different client.",
      );
    }
    if (code.redirectUri !== request.redirect_uri) {
      throw new OAuthError(
        "invalid_grant",
        "redirect_uri does not match the one the authorization code was issued " +
          "for.",
      );
    }
    // PKCE (OAuth 2.1 / MCP 2025-11-25): prove possession of the verifier.
    if (!verifyPkce(request.code_verifier, code.codeChallenge)) {
      throw new OAuthError(
        "invalid_grant",
        "PKCE verification failed: the code_verifier does not match the " +
          "code_challenge from the authorization request.",
      );
    }

    return this.issueTokenPair(code.clientId, code.accountId, now);
  }

  private async exchangeRefreshToken(
    request: Extract<TokenRequest, { grant_type: "refresh_token" }>,
    now: Date,
  ): Promise<TokenResponse> {
    const record = await this.repo.findTokenByHash(hashToken(request.refresh_token));
    if (record === null || record.kind !== "refresh") {
      throw new OAuthError(
        "invalid_grant",
        "The refresh token is invalid or expired. Reconnect the connector in " +
          "Claude Desktop to re-authorize.",
      );
    }
    if (isExpired(record.expiresAt, now)) {
      await this.repo.deleteTokenByHash(record.tokenHash);
      throw new OAuthError(
        "invalid_grant",
        "The refresh token has expired. Reconnect the connector in Claude " +
          "Desktop to re-authorize.",
      );
    }
    if (record.clientId !== request.client_id) {
      throw new OAuthError(
        "invalid_grant",
        "This refresh token was issued to a different client.",
      );
    }
    return this.issueTokenPair(record.clientId, record.accountId, now);
  }

  /**
   * Mint and persist an account-scoped access + refresh token pair. Both store
   * only the hash; the raw values are returned once, in the token response.
   */
  private async issueTokenPair(
    clientId: string,
    accountId: string,
    now: Date,
  ): Promise<TokenResponse> {
    const accessToken = generateOpaqueToken();
    const refreshToken = generateOpaqueToken();
    const createdAt = now.toISOString();
    const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);

    await this.repo.createToken({
      tokenHash: hashToken(accessToken),
      kind: "access",
      clientId,
      accountId,
      scope: MCP_OAUTH_SCOPE,
      createdAt,
      expiresAt: accessExpiresAt.toISOString(),
    });
    await this.repo.createToken({
      tokenHash: hashToken(refreshToken),
      kind: "refresh",
      clientId,
      accountId,
      scope: MCP_OAUTH_SCOPE,
      createdAt,
      expiresAt: null, // long-lived; revoked by deletion, not expiry
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: MCP_OAUTH_SCOPE,
    };
  }
}
