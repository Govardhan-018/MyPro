import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/** AES-256-GCM: 12-byte nonce is the standard, 16-byte tag is GCM's own. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encrypts OAuth tokens at rest — Phase 7.3.
 *
 * A Gmail refresh token is a long-lived key to someone's mailbox, and RLS
 * alone does not protect it: these rows are read with the service key, so a
 * leaked database dump or a mistaken `select *` on a column we forgot to
 * exclude would hand the mailbox over. Encrypting the column means the
 * ciphertext is worthless without `TOKEN_ENCRYPTION_KEY`, which lives only in
 * the environment.
 *
 * GCM rather than CBC because it authenticates: a tampered ciphertext fails
 * to decrypt instead of yielding plausible garbage that then gets sent to
 * Google as a bearer token.
 */
@Injectable()
export class CryptoService {
  private cachedKey: Buffer | null = null;

  /**
   * AES-256 needs exactly 32 bytes. `openssl rand -base64 32` gives exactly
   * that once decoded, but the env var is only validated as "at least 32
   * characters", so anything else is hashed to the right length rather than
   * rejected at runtime — a key that is the wrong shape must not be the thing
   * that stops the app booting months after it was set.
   */
  private key(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    const raw = env().TOKEN_ENCRYPTION_KEY;

    const decoded = Buffer.from(raw, 'base64');
    this.cachedKey =
      decoded.length === 32 ? decoded : createHash('sha256').update(raw, 'utf8').digest();
    return this.cachedKey;
  }

  /**
   * @returns `iv || tag || ciphertext`, as a Postgres `bytea` hex literal.
   *
   * One buffer rather than three columns: the nonce and tag are meaningless
   * on their own and must never drift apart from the ciphertext they belong
   * to, which three nullable columns would eventually allow.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return toBytea(Buffer.concat([iv, cipher.getAuthTag(), body]));
  }

  /** @returns null when the value is absent or cannot be authenticated. */
  decrypt(stored: string | null | undefined): string | null {
    if (!stored) return null;
    const buf = fromBytea(stored);
    if (!buf || buf.length <= IV_BYTES + TAG_BYTES) return null;

    try {
      const iv = buf.subarray(0, IV_BYTES);
      const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const body = buf.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.key(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      // Wrong key, or tampered-with ciphertext. Either way we have no token;
      // the caller's job is to ask the user to reconnect, not to guess.
      return null;
    }
  }
}

/**
 * PostgREST exchanges `bytea` as a hex literal — `\x48656c6c6f`. Writing
 * anything else (base64, say) silently stores the *characters* of that
 * encoding, which decrypts to nothing and is painful to diagnose later.
 */
const BYTEA_PREFIX = '\\x';

function toBytea(buf: Buffer): string {
  return `${BYTEA_PREFIX}${buf.toString('hex')}`;
}

function fromBytea(value: string): Buffer | null {
  if (value.startsWith(BYTEA_PREFIX)) return Buffer.from(value.slice(2), 'hex');
  // Tolerate a value written before this convention settled, rather than
  // throwing away a mailbox connection over an encoding detail.
  const buf = Buffer.from(value, 'base64');
  return buf.length ? buf : null;
}
