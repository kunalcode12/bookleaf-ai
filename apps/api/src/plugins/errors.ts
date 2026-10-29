import { type ErrorCode, type FieldError, type ProblemDetails, problemType } from '@bookleaf/contracts';
import { TicketLifecycleError } from '@bookleaf/domain';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError, STATUS_TITLES } from '../lib/errors';

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  detail: string,
  extra: { errors?: FieldError[]; meta?: Record<string, unknown>; headers?: Record<string, string> } = {},
) {
  const body: ProblemDetails = {
    type: problemType(code),
    title: STATUS_TITLES[status] ?? 'Error',
    status,
    detail,
    instance: request.url.split('?')[0],
    code,
    requestId: String(request.id),
    ...(extra.errors ? { errors: extra.errors } : {}),
    ...(extra.meta ? { meta: extra.meta } : {}),
  };
  for (const [k, v] of Object.entries(extra.headers ?? {})) reply.header(k, v);
  return reply.status(status).type('application/problem+json').send(body);
}

/** Postgres error codes worth translating into client errors. */
function fromPostgres(error: {
  code?: string;
  constraint_name?: string;
  constraint?: string;
  message: string;
}) {
  switch (error.code) {
    case '23505':
      return {
        status: 409,
        code: 'CONFLICT' as const,
        detail: 'This change conflicts with an existing record.',
      };
    case '23514':
    case '23502':
    case '22P02':
      return { status: 422, code: 'VALIDATION_FAILED' as const, detail: 'The data did not pass validation.' };
    case '23503':
      return {
        status: 422,
        code: 'VALIDATION_FAILED' as const,
        detail: 'A referenced record does not exist.',
      };
    case '42501':
      return { status: 403, code: 'FORBIDDEN' as const, detail: "You don't have access to this." };
    default:
      return null;
  }
}

/**
 * Every failure becomes an RFC 9457 problem-details document with a stable `code`. Validation
 * errors list each field; expected domain errors map to 4xx; anything unexpected is logged with
 * the request id and returned as a generic 500 without internals.
 */
export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setNotFoundHandler((request, reply) =>
    send(request, reply, 404, 'NOT_FOUND', `No route for ${request.method} ${request.url.split('?')[0]}.`),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return send(request, reply, error.status, error.code, error.message, error.options);
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const errors: FieldError[] = error.validation.map((issue) => ({
        path:
          issue.instancePath
            .replace(/^\//, '')
            .replace(/\//g, '.')
            .replace(/^(body|querystring|params|headers)\.?/, '') || String(issue.params?.issue ?? 'request'),
        message: issue.message ?? 'Invalid value',
        code: issue.keyword,
      }));
      const where =
        error.validationContext === 'querystring'
          ? 'query parameters'
          : error.validationContext === 'params'
            ? 'path parameters'
            : error.validationContext === 'headers'
              ? 'headers'
              : 'fields';
      return send(request, reply, 422, 'VALIDATION_FAILED', `Some ${where} need your attention.`, { errors });
    }

    if (error instanceof TicketLifecycleError) {
      return send(request, reply, 409, error.code, error.message, {
        meta: { allowedTransitions: error.allowed },
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error, issues: error.cause.issues }, 'response did not match its schema');
      return send(request, reply, 500, 'INTERNAL', 'Something went wrong on our side. Please try again.');
    }

    if (error.statusCode === 429) {
      const retryAfter = Number(reply.getHeader('retry-after') ?? 60);
      return send(
        request,
        reply,
        429,
        'RATE_LIMITED',
        `Too many requests. Please try again in ${retryAfter} seconds.`,
        {
          meta: { retryAfterSeconds: retryAfter },
        },
      );
    }

    switch (error.code) {
      case 'FST_ERR_CTP_BODY_TOO_LARGE':
        return send(request, reply, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
      case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
        return send(
          request,
          reply,
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Send JSON (content-type: application/json).',
        );
      case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      case 'FST_ERR_CTP_INVALID_JSON_BODY':
        return send(request, reply, 400, 'BAD_REQUEST', 'The request body is not valid JSON.');
      default:
        break;
    }
    if (error instanceof SyntaxError && error.statusCode === 400) {
      return send(request, reply, 400, 'BAD_REQUEST', 'The request body is not valid JSON.');
    }

    const pg = fromPostgres(error as unknown as { code?: string; message: string });
    if (pg) {
      request.log.warn({ err: error }, 'database rejected the request');
      return send(request, reply, pg.status, pg.code, pg.detail);
    }

    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return send(request, reply, error.statusCode, 'BAD_REQUEST', error.message);
    }

    request.log.error({ err: error }, 'unhandled error');
    return send(request, reply, 500, 'INTERNAL', 'Something went wrong on our side. Please try again.');
  });
});
