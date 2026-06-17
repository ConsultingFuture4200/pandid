/**
 * Auth domain types + Zod boundary schemas (DEV-1134, FR-20).
 *
 * Web-login concern only: credentials and sessions. The `Account` identity
 * contract lives in `@/lib/types` (DEV-1130); the `accounts` table is owned by
 * the schema task (DEV-1132). This module never re-models the account row —
 * it references it by id.
 */
import { z } from "zod";
import { isoTimestampSchema, uuidSchema } from "@/lib/types";

/** Credentials submitted at the login/signup boundary. */
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
export type Credentials = z.infer<typeof credentialsSchema>;

/**
 * A persisted password credential, bound 1:1 to an account.
 * Stored separately from the account row (auth-owned table).
 */
export interface AuthCredential {
  readonly accountId: string;
  readonly email: string;
  /** Self-describing scrypt hash (see `password.ts`). Never the plaintext. */
  readonly passwordHash: string;
}

/** A server-side session record. The token is stored hashed, never raw. */
export interface SessionRecord {
  readonly id: string;
  readonly accountId: string;
  /** SHA-256 of the opaque session token. The raw token only lives in the cookie. */
  readonly tokenHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export const sessionRecordSchema = z.object({
  id: uuidSchema,
  accountId: uuidSchema,
  tokenHash: z.string().length(64),
  createdAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema,
});

/** The authenticated principal exposed to the app after session resolution. */
export interface AuthenticatedUser {
  readonly accountId: string;
  readonly email: string;
}

/**
 * Typed failure modes at the auth boundary. User-facing messages (what happened
 * + how to fix) are produced at the call site from these discriminants.
 */
export type AuthErrorCode =
  | "invalid_credentials"
  | "email_taken"
  | "weak_password"
  | "invalid_input";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}
