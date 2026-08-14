import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, toPublicAuthUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }
  return NextResponse.json({ success: true, user: toPublicAuthUser(user) });
}
