import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateUser,
  createSession,
  isRateLimited,
  rateLimitKey,
  setSessionCookie,
  toPublicAuthUser,
} from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (isRateLimited({ action: 'login', key: rateLimitKey(req, body.email) })) {
    return NextResponse.json(
      { success: false, error: 'Too many login attempts. Try again later.' },
      { status: 429 },
    );
  }

  const user = await authenticateUser(body.email || '', body.password || '');
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Invalid email or password' },
      { status: 401 },
    );
  }

  const { token, expiresAt } = await createSession(user.id);
  const response = NextResponse.json({ success: true, user: toPublicAuthUser(user) });
  setSessionCookie(response, token, expiresAt);
  return response;
}
