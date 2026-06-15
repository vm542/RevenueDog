import { describe, expect, it } from 'vitest';
import { assertProductionSafe, loadConfig } from '../src/config.js';
import { addDuration, isValidDuration } from '../src/duration.js';

describe('production safety guard', () => {
  const prod = (over: NodeJS.ProcessEnv) =>
    loadConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'https://dash.example.com', ...over } as NodeJS.ProcessEnv);

  it('refuses to boot in production with trust-mode validation', () => {
    expect(() => assertProductionSafe(prod({}))).toThrow(/trust-mode/i);
  });

  it('refuses to boot in production with wildcard CORS', () => {
    expect(() =>
      assertProductionSafe(prod({ APPLE_VALIDATION: 'apple', GOOGLE_VALIDATION: 'google', CORS_ORIGIN: '*' })),
    ).toThrow(/CORS/i);
  });

  it('allows a properly configured production server', () => {
    expect(() =>
      assertProductionSafe(prod({ APPLE_VALIDATION: 'apple', GOOGLE_VALIDATION: 'google' })),
    ).not.toThrow();
  });

  it('never blocks non-production environments', () => {
    expect(() => assertProductionSafe(loadConfig({} as NodeJS.ProcessEnv))).not.toThrow();
  });
});

describe('duration', () => {
  it('validates ISO-8601 durations', () => {
    expect(isValidDuration('P1M')).toBe(true);
    expect(isValidDuration('P1Y')).toBe(true);
    expect(isValidDuration('P7D')).toBe(true);
    expect(isValidDuration('P1W')).toBe(true);
    expect(isValidDuration('P')).toBe(false);
    expect(isValidDuration('1M')).toBe(false);
    expect(isValidDuration('PXM')).toBe(false);
  });

  it('adds calendar durations in UTC', () => {
    expect(addDuration('2026-01-15T00:00:00Z', 'P1M')).toBe('2026-02-15T00:00:00Z');
    expect(addDuration('2026-01-15T00:00:00Z', 'P1Y')).toBe('2027-01-15T00:00:00Z');
    expect(addDuration('2026-01-01T00:00:00Z', 'P7D')).toBe('2026-01-08T00:00:00Z');
    expect(addDuration('2026-01-01T00:00:00Z', 'P1W')).toBe('2026-01-08T00:00:00Z');
  });
});
