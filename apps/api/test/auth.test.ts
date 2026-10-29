import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, bearer, createTestContext, ORIGIN, PRIYA, type TestContext } from './harness';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const cookieHeader = (setCookie: string | string[] | undefined) =>
  (Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [])
    .map((c) => c.split(';')[0])
    .join('; ');

describe('authentication', () => {
  it('signs in with a password and returns the session user', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: PRIYA });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({
      email: PRIYA.email,
      role: 'author',
      author: { externalId: 'AUTH001' },
    });
    const cookies = String(res.headers['set-cookie']);
    expect(cookies).toContain('bl_at=');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('Path=/api/v1/auth');
  });

  it('rejects a wrong password with a problem document, not a generic error', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { ...PRIYA, password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(res.json().requestId).toBeTruthy();
  });

  it('answers unknown emails exactly like wrong passwords (no account enumeration)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { email: 'nobody@example.com', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('validates the login body with field-level errors', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(422);
    const paths = res.json().errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('requires a session for protected routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/me/books' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
    const forged = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me/books',
      headers: bearer('forged.jwt.token'),
    });
    expect(forged.statusCode).toBe(401);
  });

  it('rotates refresh tokens: a used refresh token cannot be replayed', async () => {
    const login = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: ADMIN });
    const { refreshToken } = login.json();
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().refreshToken).not.toBe(refreshToken);
    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('blocks cookie-authenticated writes from untrusted origins (CSRF)', async () => {
    const login = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: PRIYA });
    const cookie = cookieHeader(login.headers['set-cookie']);
    const payload = {
      bookId: null,
      subject: 'Question about my account',
      description: 'How do I change the email on my account?',
    };

    const noOrigin = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/tickets',
      headers: { cookie },
      payload,
    });
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.json().code).toBe('CSRF_REJECTED');

    const evil = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/tickets',
      headers: { cookie, origin: 'https://evil.example' },
      payload,
    });
    expect(evil.statusCode).toBe(403);

    const trusted = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/tickets',
      headers: { cookie, origin: ORIGIN },
      payload,
    });
    expect(trusted.statusCode).toBe(201);
  });

  it('returns the current session and signs out', async () => {
    const login = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: ADMIN });
    const cookie = cookieHeader(login.headers['set-cookie']);
    const session = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json().user).toMatchObject({ role: 'admin', title: 'Support Lead' });

    const logout = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers['set-cookie'])).toContain('bl_at=;');
  });

  it('lists demo personas for evaluators', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/demo-accounts' });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toHaveLength(13);
  });
});

describe('API hygiene', () => {
  it('never lets responses be cached and tags each one with a request id', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/demo-accounts' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('answers unknown routes with a problem document', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      headers: { 'content-type': 'application/json' },
      payload: '{"email": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_REQUEST');
  });

  it('publishes an OpenAPI 3.1 document', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toBe('3.1.0');
    expect(Object.keys(res.json().paths)).toContain('/api/v1/admin/tickets/{ticketRef}');
  });

  it('reports liveness and readiness', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
    const ready = await ctx.app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks.database).toBe('ok');
  });
});
