import type { ErrorCode, FieldError } from '@bookleaf/contracts';

export interface AppErrorOptions {
  errors?: FieldError[];
  meta?: Record<string, unknown>;
  headers?: Record<string, string>;
  cause?: unknown;
}

/**
 * Expected, user-facing failure. Rendered as RFC 9457 problem details with a stable `code`.
 * Anything that is not an AppError is treated as an unexpected 500 (logged, never leaked).
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly options: AppErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
  }
}

export const Errors = {
  badRequest: (message: string, meta?: Record<string, unknown>) =>
    new AppError(400, 'BAD_REQUEST', message, { meta }),
  validation: (errors: FieldError[], message = 'Some fields need your attention.') =>
    new AppError(422, 'VALIDATION_FAILED', message, { errors }),
  unauthenticated: (message = 'Please sign in to continue.') => new AppError(401, 'UNAUTHENTICATED', message),
  tokenExpired: () => new AppError(401, 'TOKEN_EXPIRED', 'Your session has expired. Please sign in again.'),
  invalidCredentials: () =>
    new AppError(401, 'INVALID_CREDENTIALS', "That email and password don't match a BookLeaf account."),
  forbidden: (message = "You don't have access to this.") => new AppError(403, 'FORBIDDEN', message),
  csrf: () =>
    new AppError(
      403,
      'CSRF_REJECTED',
      'This request came from an unexpected origin and was blocked for your safety.',
    ),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`),
  conflict: (code: ErrorCode, message: string, meta?: Record<string, unknown>) =>
    new AppError(409, code, message, { meta }),
  preconditionFailed: (meta?: Record<string, unknown>) =>
    new AppError(
      412,
      'PRECONDITION_FAILED',
      'This ticket was changed by someone else while you were viewing it. Refresh to see the latest version.',
      { meta },
    ),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError(
      429,
      'RATE_LIMITED',
      `Too many requests. Please try again in ${retryAfterSeconds} seconds.`,
      {
        headers: { 'retry-after': String(retryAfterSeconds) },
        meta: { retryAfterSeconds },
      },
    ),
  unavailable: (message: string) => new AppError(503, 'SERVICE_UNAVAILABLE', message),
  aiUnavailable: (message = 'Leaf is temporarily unavailable. You can still write a reply manually.') =>
    new AppError(503, 'AI_UNAVAILABLE', message),
};

export const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};
