import type { IncomingMessage } from 'node:http';

import type { RuntimeHttpPrincipal } from '@openmaic/storage/server';
import { AUTH_COOKIE_NAME, getUserBySessionToken } from '@/lib/auth/server';

function cookieValue(header: string | string[] | undefined, name: string): string | undefined {
  const raw = Array.isArray(header) ? header.join(';') : header;
  return raw
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export async function authenticatePersistenceRequest(
  req: IncomingMessage,
): Promise<RuntimeHttpPrincipal | undefined> {
  const sessionToken = cookieValue(req.headers.cookie, AUTH_COOKIE_NAME);
  const user = await getUserBySessionToken(
    sessionToken ? decodeURIComponent(sessionToken) : undefined,
  );
  return user ? { learnerKey: `user:${user.id}` } : undefined;
}
