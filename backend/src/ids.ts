import { randomBytes } from 'node:crypto';

export function genId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/**
 * Generates an API key with the given prefix. RevenueCat-style platform prefixes
 * (`appl_`, `goog_`, `amzn_`) let the official RevenueCat SDK accept the key as-is
 * during a drop-in migration; `pk_`/`sk_` are RevenueDog's generic public/secret keys.
 */
export function genKey(prefix: 'pk' | 'sk' | 'appl' | 'goog' | 'amzn'): string {
  return `${prefix}_${randomBytes(24).toString('hex')}`;
}

/** ISO-8601 UTC, second precision (the contract's date format). */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
