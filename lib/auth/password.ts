/**
 * Password hashing for web login (DEV-1134, FR-20).
 *
 * Uses Node's built-in `scrypt` (no third-party dependency). Each hash carries
 * its own random salt; the stored string is self-describing so verification
 * needs nothing but the stored value and the candidate password.
 *
 * Stored format: `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`
 *
 * Pure crypto over Node primitives — no DB, no framework coupling. This module
 * is the trust boundary for credential material; it never logs or returns the
 * plaintext.
 */
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Promise wrapper over `scrypt` with options. `util.promisify` collapses the
 * overloads to the 3-arg form, so we wrap the options overload by hand.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

/** scrypt cost parameters. N must be a power of two. */
const COST_N = 16384;
const BLOCK_SIZE_R = 8;
const PARALLELISM_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

const SCHEME = "scrypt";

/** Minimum password length enforced at the credential boundary. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Hash a plaintext password into a self-describing, storable string.
 * @throws if the password is shorter than {@link MIN_PASSWORD_LENGTH}.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters. Choose a longer password.`,
    );
  }
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(plaintext, salt, KEY_LENGTH, {
    N: COST_N,
    r: BLOCK_SIZE_R,
    p: PARALLELISM_P,
  });
  return [
    SCHEME,
    COST_N,
    BLOCK_SIZE_R,
    PARALLELISM_P,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/**
 * Verify a candidate password against a stored hash. Returns `false` (never
 * throws) for malformed stored values so a corrupt row cannot crash a login
 * attempt; constant-time compare prevents timing leaks.
 */
export async function verifyPassword(
  plaintext: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCHEME) {
    return false;
  }
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const derived = await scrypt(plaintext, salt, expected.length, {
    N,
    r,
    p,
  });
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}
