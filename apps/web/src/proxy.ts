import { type NextRequest, NextResponse } from 'next/server';

const ROLE_COOKIE = 'bl_role';
const AUTHOR_AREAS = ['/home', '/books', '/support'];
const ADMIN_AREA = '/desk';

const homeFor = (role: string | undefined) => (role === 'admin' ? ADMIN_AREA : '/home');
const startsWithAny = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * 1. Forwards `/api/*` to the API (same-origin for the browser, so cookies stay first-party), adding
 *    the shared origin secret when one is configured.
 * 2. Optimistic page routing from the non-sensitive role hint cookie: signed-out visitors go to the
 *    login page, authors and admins land in their own area. This is UX only — every request for
 *    data is authorised by the API itself.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    const origin = process.env.API_ORIGIN ?? 'http://localhost:4000';
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', request.nextUrl.host);
    headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));
    if (process.env.API_ORIGIN_SECRET) headers.set('x-origin-secret', process.env.API_ORIGIN_SECRET);
    return NextResponse.rewrite(new URL(`${pathname}${search}`, origin), { request: { headers } });
  }

  const role = request.cookies.get(ROLE_COOKIE)?.value;
  if (pathname === '/') return NextResponse.redirect(new URL(role ? homeFor(role) : '/login', request.url));

  const wantsAuthorArea = startsWithAny(pathname, AUTHOR_AREAS);
  const wantsAdminArea = startsWithAny(pathname, [ADMIN_AREA]);
  if (!wantsAuthorArea && !wantsAdminArea) return NextResponse.next();

  if (!role) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  if ((wantsAdminArea && role !== 'admin') || (wantsAuthorArea && role === 'admin')) {
    return NextResponse.redirect(new URL(homeFor(role), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/api/:path*', '/home/:path*', '/books/:path*', '/support/:path*', '/desk/:path*'],
};
