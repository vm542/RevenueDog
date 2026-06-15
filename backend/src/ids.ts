import { randomBytes } from 'node:crypto';

export function genId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export function genKey(prefix: 'pk' | 'sk'): string {
  return `${prefix}_${randomBytes(24).toString('hex')}`;
}

/** ISO-8601 UTC, second precision (the contract's date format). */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
