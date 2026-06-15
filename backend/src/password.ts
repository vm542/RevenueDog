import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt (no external dependency). Stored format:
 *   scrypt$<N>$<saltHex>$<hashHex>
 * The cost parameter is encoded so it can be raised later without breaking
 * existing hashes.
 */
const N = 16384;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  const salt = Buffer.from(parts[2]!, 'hex');
  const expected = Buffer.from(parts[3]!, 'hex');
  const actual = scryptSync(password, salt, expected.length, { N: cost });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
