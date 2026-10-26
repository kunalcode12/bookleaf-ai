import { z } from 'zod';

/**
 * Stable, machine-readable error codes. Clients branch on `code`, never on `title`/`detail` text.
 * Every error response is an RFC 9457 Problem Details document (application/problem+json).
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'CSRF_REJECTED',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_STATUS_TRANSITION',
  'ASSIGNMENT_CONFLICT',
  'TICKET_CLOSED',
  'PRECONDITION_FAILED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'AI_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const FieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});
export type FieldError = z.infer<typeof FieldErrorSchema>;

export const ProblemDetailsSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    code: z.enum(ERROR_CODES),
    requestId: z.string().optional(),
    errors: z.array(FieldErrorSchema).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'ProblemDetails', description: 'RFC 9457 problem details with a stable `code`.' });
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const PROBLEM_TYPE_BASE = 'https://bookleaf.support/problems/';

export function problemType(code: ErrorCode): string {
  return `${PROBLEM_TYPE_BASE}${code.toLowerCase().replaceAll('_', '-')}`;
}
