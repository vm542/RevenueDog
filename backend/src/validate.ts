import type { ZodType } from 'zod';
import { invalidRequest } from './errors.js';

/** Parses a request body with zod, mapping failures to 400 invalid_request. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const path = issue.path.join('.');
    throw invalidRequest(path ? `${path}: ${issue.message}` : issue.message);
  }
  return result.data;
}
