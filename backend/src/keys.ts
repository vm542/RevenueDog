import { createHash } from 'node:crypto';

/**
 * Secret API keys are high-entropy random tokens, so a fast unsalted SHA-256 is a safe
 * digest for at-rest storage and lookup (no dictionary/brute-force surface like a
 * password would have). We never persist the plaintext key — it is shown once at
 * creation; thereafter only the hash and a short display prefix are stored.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** A non-secret prefix for display/identification, e.g. `sk_1a2b3c4d`. */
export function keyPrefix(key: string): string {
  return key.slice(0, 11);
}
