import type { FieldError, ProblemDetails } from '@bookleaf/contracts';

const BASE = '/api/v1';
/** Auth endpoints that must never trigger a refresh-and-retry. */
const NO_REFRESH = ['/auth/login', '/auth/token', '/auth/refresh', '/auth/logout'];

/** Every failure the UI can show: an API problem document, or a network failure (status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldError[];
  readonly requestId: string | null;
  readonly meta: Record<string, unknown>;

  constructor(status: number, problem: Partial<ProblemDetails> & { code?: string }) {
    super(problem.detail ?? problem.title ?? 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.status = status;
    this.code = problem.code ?? (status === 0 ? 'NETWORK' : 'INTERNAL');
    this.fieldErrors = problem.errors ?? [];
    this.requestId = problem.requestId ?? null;
    this.meta = problem.meta ?? {};
  }

  static network(): ApiError {
    return new ApiError(0, {
      code: 'NETWORK' as ProblemDetails['code'],
      detail: "We couldn't reach BookLeaf. Check your connection and try again.",
    });
  }

  fieldError(path: string): string | undefined {
    return this.fieldErrors.find((e) => e.path === path)?.message;
  }

  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that hit a 401 simultaneously. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  return refreshing;
}

function onSessionEnded() {
  if (typeof window === 'undefined' || window.location.pathname.startsWith('/login')) return;
  // biome-ignore lint/suspicious/noDocumentCookie: clearing the non-sensitive role hint cookie
  document.cookie = 'bl_role=; Max-Age=0; path=/';
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.assign(`/login?expired=1&next=${next}`);
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
  retry = true,
): Promise<T> {
  const { body, headers, signal } = options;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw ApiError.network();
  }

  if (res.status === 401 && retry && !NO_REFRESH.includes(path)) {
    if (await refreshSession()) return request<T>(method, path, options, false);
    onSessionEnded();
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new ApiError(res.status, (data as Partial<ProblemDetails>) ?? {});
  return data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body: body ?? {} }),
  patch: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  put: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
};

/** Builds a query string, skipping empty values and joining arrays with commas. */
export function qs(
  params: Record<string, string | number | boolean | readonly string[] | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}
