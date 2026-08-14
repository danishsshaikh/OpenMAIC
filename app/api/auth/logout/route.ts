import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, clearSessionCookie, destroySession } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  await destroySession(req.cookies.get(AUTH_COOKIE_NAME)?.value);
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
