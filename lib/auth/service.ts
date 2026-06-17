/**
 * Auth service (DEV-1134, FR-20).
 *
 * Orchestrates signup / login / logout / session-resolution over an
 * `AuthRepository`. All credential checks and session minting happen here; the
 * Next.js layer (server actions, middleware) is a thin adapter that only
 * handles cookies and redirects.
 *
 * Returns a raw session token on signup/login that the adapter sets as a
 * cookie. The raw token is never persisted — only its hash (see `session.ts`).
 */
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./password";
import type { AuthRepository } from "./repository";
import {
  generateSessionToken,
  hashSessionToken,
  isExpired,
  sessionExpiry,
} from "./session";
import {
  AuthError,
  credentialsSchema,
  type AuthenticatedUser,
} from "./types";

/** Result of a successful signup/login: the principal + a raw session token. */
export interface AuthSession {
  readonly user: AuthenticatedUser;
  readonly token: string;
  readonly expiresAt: Date;
}

/** Generate a UUID for new session rows. */
function newId(): string {
  // `crypto.randomUUID` is available in Node 20+ and the Edge runtime.
  return crypto.randomUUID();
}

export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  /**
   * Register a new account from email + password, then open a session.
   * @throws {AuthError} `invalid_input` for malformed email/password,
   *   `weak_password` when too short, `email_taken` when the email exists.
   */
  async signup(input: { email: string; password: string }): Promise<AuthSession> {
    const parsed = credentialsSchema.safeParse(input);
    if (!parsed.success) {
      throw new AuthError(
        "invalid_input",
        "Enter a valid email and password to create your account.",
      );
    }
    const { email, password } = parsed.data;
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(
        "weak_password",
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters. Choose a longer password.`,
      );
    }
    const existing = await this.repo.findCredentialByEmail(email);
    if (existing !== null) {
      throw new AuthError(
        "email_taken",
        "An account with that email already exists. Log in instead.",
      );
    }
    const passwordHash = await hashPassword(password);
    const { accountId } = await this.repo.createAccountWithCredential({
      email,
      passwordHash,
    });
    return this.openSession({ accountId, email });
  }

  /**
   * Verify credentials and open a session.
   * @throws {AuthError} `invalid_input` for malformed input, `invalid_credentials`
   *   when email is unknown or the password does not match. The same error is
   *   used for both to avoid leaking which emails are registered.
   */
  async login(input: { email: string; password: string }): Promise<AuthSession> {
    const parsed = credentialsSchema.safeParse(input);
    if (!parsed.success) {
      throw new AuthError(
        "invalid_input",
        "Enter a valid email and password to log in.",
      );
    }
    const { email, password } = parsed.data;
    const credential = await this.repo.findCredentialByEmail(email);
    if (credential === null) {
      // Spend a hash to keep timing uniform whether or not the email exists.
      await verifyPassword(
        password,
        "scrypt$16384$8$1$00$00",
      );
      throw new AuthError(
        "invalid_credentials",
        "Email or password is incorrect. Check both and try again.",
      );
    }
    const ok = await verifyPassword(password, credential.passwordHash);
    if (!ok) {
      throw new AuthError(
        "invalid_credentials",
        "Email or password is incorrect. Check both and try again.",
      );
    }
    return this.openSession({
      accountId: credential.accountId,
      email: credential.email,
    });
  }

  /** Revoke a session by its raw token. Idempotent. */
  async logout(token: string): Promise<void> {
    await this.repo.deleteSessionByTokenHash(hashSessionToken(token));
  }

  /**
   * Resolve a raw session token to the authenticated principal, or null when
   * the token is absent, unknown, or expired. Expired sessions are pruned.
   */
  async resolveSession(
    token: string | undefined,
    now: Date = new Date(),
  ): Promise<AuthenticatedUser | null> {
    if (token === undefined || token.length === 0) {
      return null;
    }
    const tokenHash = hashSessionToken(token);
    const session = await this.repo.findSessionByTokenHash(tokenHash);
    if (session === null) {
      return null;
    }
    if (isExpired(session.expiresAt, now)) {
      await this.repo.deleteSessionByTokenHash(tokenHash);
      return null;
    }
    const email = await this.repo.findAccountEmail(session.accountId);
    if (email === null) {
      return null;
    }
    return { accountId: session.accountId, email };
  }

  /** Mint and persist a session for an already-authenticated principal. */
  private async openSession(user: AuthenticatedUser): Promise<AuthSession> {
    const token = generateSessionToken();
    const createdAt = new Date();
    const expiresAt = sessionExpiry(createdAt);
    await this.repo.createSession({
      id: newId(),
      accountId: user.accountId,
      tokenHash: hashSessionToken(token),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    return { user, token, expiresAt };
  }
}
