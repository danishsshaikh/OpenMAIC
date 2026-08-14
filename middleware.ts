import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifySignedSessionToken } from '@/lib/auth/session-cookie';

const PUBLIC_API_PREFIXES = ['/api/auth/'];
const PUBLIC_PATHS = new Set(['/login', '/signup', '/api/health']);

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) || PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = await verifySignedSessionToken(
    request.cookies.get(AUTH_COOKIE_NAME)?.value,
  );

  if (pathname === '/' && !hasSessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if ((pathname === '/login' || pathname === '/signup') && hasSessionCookie) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  if (!hasSessionCookie && pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'UNAUTHENTICATED', error: 'Authentication required' },
      { status: 401 },
    );
  }

  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|branding/|logos/|avatars/|vendor/|openmaic-mark.png|logo-horizontal.png).*)',
  ],
};
