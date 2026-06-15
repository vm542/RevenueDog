export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'resource_not_found'
  | 'conflict'
  | 'receipt_validation_failed'
  | 'store_problem'
  | 'internal_error';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const invalidRequest = (message: string) => new AppError(400, 'invalid_request', message);
export const unauthorized = (message: string) => new AppError(401, 'unauthorized', message);
export const forbidden = (message: string) => new AppError(403, 'forbidden', message);
export const notFound = (message: string) => new AppError(404, 'resource_not_found', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const receiptValidationFailed = (message: string) =>
  new AppError(422, 'receipt_validation_failed', message);
export const storeProblem = (message: string) => new AppError(502, 'store_problem', message);
export const internalError = (message: string) => new AppError(500, 'internal_error', message);
