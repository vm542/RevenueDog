import { describe, expect, it } from 'vitest';
import { addDuration, isValidDuration } from '../src/duration.js';

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
