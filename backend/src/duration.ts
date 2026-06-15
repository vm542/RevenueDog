import { AppError } from './errors.js';

// Date-based ISO-8601 durations are all the stores use (P1W, P1M, P3M, P6M, P1Y...).
const DURATION_RE = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/;

export function isValidDuration(value: string): boolean {
  return value !== 'P' && DURATION_RE.test(value);
}

/** Adds an ISO-8601 duration to an ISO timestamp using calendar arithmetic (UTC). */
export function addDuration(fromIso: string, duration: string): string {
  const match = DURATION_RE.exec(duration);
  if (!match || duration === 'P') {
    throw new AppError(500, 'internal_error', `Invalid product duration "${duration}".`);
  }
  const [, years, months, weeks, days] = match;
  const date = new Date(fromIso);
  if (years) date.setUTCFullYear(date.getUTCFullYear() + Number(years));
  if (months) date.setUTCMonth(date.getUTCMonth() + Number(months));
  const totalDays = (weeks ? Number(weeks) * 7 : 0) + (days ? Number(days) : 0);
  if (totalDays) date.setUTCDate(date.getUTCDate() + totalDays);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
