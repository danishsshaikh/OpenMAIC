import { resolveRequestOwnerId } from './owner';
import { AUTH_COOKIE_NAME, getUserBySessionToken } from '@/lib/auth/server';

function readCookie(headers: Headers, name: string): string | undefined {
  const encoded = headers.get('cookie');
  if (!encoded) return undefined;
  for (const item of encoded.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function authenticatedOwnerId(req: Pick<Request, 'headers'>): Promise<string | undefined> {
  const token = readCookie(req.headers, AUTH_COOKIE_NAME);
  const user = await getUserBySessionToken(token);
  return user ? `user:${user.id}` : undefined;
}

/**
 * Resolve the anonymous owner identity and run a handler with its response
 * headers.
 *
 * The Set-Cookie minted by resolveRequestOwnerId must ride every response,
 * including 4xx and 5xx: a client that retries after an error keeps the same
 * owner partition, while a 500 that dropped the cookie would silently make
 * the retry a different anonymous owner.
 */
export async function withRequestOwnerId(
  req: Pick<Request, 'headers'>,
  handler: (ownerId: string, responseHeaders: Headers) => Promise<Response>,
): Promise<Response> {
  const responseHeaders = new Headers();
  const ownerId = resolveRequestOwnerId(req, responseHeaders, await authenticatedOwnerId(req));
  try {
    return await handler(ownerId, responseHeaders);
  } catch (error) {
    console.error('[agent-runtime] request failed under an anonymous owner', error);
    return new Response('Internal Server Error', { status: 500, headers: responseHeaders });
  }
}
