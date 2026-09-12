import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import type { AssetPrincipal } from '@openmaic/storage';
import type { RuntimeHttpPrincipal } from '@openmaic/storage/server';
import { AUTH_COOKIE_NAME, getUserBySessionToken } from '@/lib/auth/server';
import { createLogger } from '@/lib/logger';

const log = createLogger('PersistenceAuth');

type PersistencePrincipal = RuntimeHttpPrincipal & Partial<Pick<AssetPrincipal, 'key'>>;

/**
 * The single asset partition for this deployment shape. Documents are
 * owner-scoped by the route layer; assets remain shared until the storage
 * package carries per-asset ownership.
 */
export const SHARED_ASSET_PRINCIPAL = 'shared';

function insecureDevAuthOptInEnabled(): boolean {
  const optIn = process.env.PERSISTENCE_ALLOW_INSECURE_DEV_AUTH;
  return optIn === 'true' || optIn === '1';
}

function devAuthenticatorAllowedInCurrentEnvironment(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return insecureDevAuthOptInEnabled();
}

if (process.env.NODE_ENV === 'production' && insecureDevAuthOptInEnabled()) {
  log.warn(
    'Persistence is running the development authenticator in production: it provides no user ' +
      'isolation, so this endpoint must only be reachable on a trusted network. Replace it with ' +
      'real session verification before serving public traffic.',
  );
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function cookieValue(header: string | string[] | undefined, name: string): string | undefined {
  const raw = Array.isArray(header) ? header.join(';') : header;
  return raw
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function secureEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function authenticatePersistenceCredentials(
  authorization: string | undefined,
  learnerKey: string | undefined,
): PersistencePrincipal | undefined {
  if (!devAuthenticatorAllowedInCurrentEnvironment()) return undefined;

  const token = process.env.PERSISTENCE_DEV_TOKEN;
  if (!token || !authorization || !secureEqual(authorization, `Bearer ${token}`)) return undefined;

  return { key: SHARED_ASSET_PRINCIPAL, ...(learnerKey ? { learnerKey } : {}) };
}

async function authenticateSessionCookie(
  cookieHeader: string | string[] | undefined,
): Promise<PersistencePrincipal | undefined> {
  const sessionToken = cookieValue(cookieHeader, AUTH_COOKIE_NAME);
  const user = await getUserBySessionToken(
    sessionToken ? decodeURIComponent(sessionToken) : undefined,
  );
  return user ? { key: SHARED_ASSET_PRINCIPAL, learnerKey: `user:${user.id}` } : undefined;
}

export function authenticatePersistenceHeaders(headers: Headers): PersistencePrincipal | undefined {
  return authenticatePersistenceCredentials(
    headers.get('authorization') ?? undefined,
    headers.get('x-learner-key') ?? undefined,
  );
}

export async function authenticatePersistenceRequest(
  req: IncomingMessage,
): Promise<PersistencePrincipal | undefined> {
  return (
    (await authenticateSessionCookie(req.headers.cookie)) ??
    authenticatePersistenceCredentials(
      singleHeader(req.headers.authorization),
      singleHeader(req.headers['x-learner-key']),
    )
  );
}
