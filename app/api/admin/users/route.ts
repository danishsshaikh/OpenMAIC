import { NextRequest, NextResponse } from 'next/server';
import { listPublicUsers, requireSessionUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await requireSessionUser(req);
  if (user instanceof Response) return user;
  if (user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({ success: true, users: await listPublicUsers() });
}
