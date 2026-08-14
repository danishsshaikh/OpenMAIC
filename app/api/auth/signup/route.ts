import { NextRequest, NextResponse } from 'next/server';
import {
  createSession,
  createUser,
  isRateLimited,
  rateLimitKey,
  setSessionCookie,
  toPublicAuthUser,
} from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  };
  if (isRateLimited({ action: 'signup', key: rateLimitKey(req, body.email) })) {
    return NextResponse.json(
      { success: false, error: 'Too many signup attempts. Try again later.' },
      { status: 429 },
    );
  }

  try {
    const user = await createUser({
      name: body.name || '',
      email: body.email || '',
      password: body.password || '',
      confirmPassword: body.confirmPassword,
    });
    const { token, expiresAt } = await createSession(user.id);
    const response = NextResponse.json(
      { success: true, user: toPublicAuthUser(user) },
      { status: 201 },
    );
    setSessionCookie(response, token, expiresAt);
    return response;
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Signup failed' },
      { status: 400 },
    );
  }
}
