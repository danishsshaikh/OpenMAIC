import type { IncomingMessage } from 'node:http';

import { beforeEach, describe, expect, it, vi } from 'vitest';

function request(headers: IncomingMessage['headers']): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe('embedded persistence session authentication', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('derives the storage principal from the opaque session cookie', async () => {
    vi.doMock('@/lib/auth/server', () => ({
      AUTH_COOKIE_NAME: 'openmaic_session',
      getUserBySessionToken: vi.fn(async (token) =>
        token === 'session-token' ? { id: 'usr_faculty_a' } : null,
      ),
    }));
    const { authenticatePersistenceRequest } = await import('@/lib/persistence/server-auth');

    await expect(
      authenticatePersistenceRequest(
        request({
          cookie: 'openmaic_session=session-token',
          'x-learner-key': 'attacker-controlled',
        }),
      ),
    ).resolves.toEqual({ key: 'shared', learnerKey: 'user:usr_faculty_a' });
  });

  it('shares one asset principal across learner keys, like the global documents', async () => {
    vi.stubEnv('PERSISTENCE_DEV_TOKEN', 'shared-secret');
    vi.stubEnv('NODE_ENV', 'development');
    vi.doMock('@/lib/auth/server', () => ({
      AUTH_COOKIE_NAME: 'openmaic_session',
      getUserBySessionToken: vi.fn(async () => null),
    }));
    const { authenticatePersistenceRequest } = await import('@/lib/persistence/server-auth');

    const first = await authenticatePersistenceRequest(
      request({ authorization: 'Bearer shared-secret', 'x-learner-key': 'anon:a' }),
    );
    const second = await authenticatePersistenceRequest(
      request({ authorization: 'Bearer shared-secret', 'x-learner-key': 'anon:b' }),
    );
    expect(first?.key).toBe('shared');
    expect(second?.key).toBe('shared');
    expect(first?.learnerKey).not.toBe(second?.learnerKey);
  });

  it('issues the shared asset principal even without a learner key', async () => {
    vi.stubEnv('PERSISTENCE_DEV_TOKEN', 'shared-secret');
    vi.stubEnv('NODE_ENV', 'development');
    vi.doMock('@/lib/auth/server', () => ({
      AUTH_COOKIE_NAME: 'openmaic_session',
      getUserBySessionToken: vi.fn(async () => null),
    }));
    const { authenticatePersistenceRequest } = await import('@/lib/persistence/server-auth');

    await expect(
      authenticatePersistenceRequest(request({ authorization: 'Bearer shared-secret' })),
    ).resolves.toEqual({ key: 'shared' });
  });

  it('rejects missing or invalid session cookies', async () => {
    vi.doMock('@/lib/auth/server', () => ({
      AUTH_COOKIE_NAME: 'openmaic_session',
      getUserBySessionToken: vi.fn(async () => null),
    }));
    const { authenticatePersistenceRequest } = await import('@/lib/persistence/server-auth');

    await expect(authenticatePersistenceRequest(request({}))).resolves.toBeUndefined();
    await expect(
      authenticatePersistenceRequest(request({ cookie: 'openmaic_session=bad-token' })),
    ).resolves.toBeUndefined();
  });
});

describe('embedded persistence development authentication — production gate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/auth/server', () => ({
      AUTH_COOKIE_NAME: 'openmaic_session',
      getUserBySessionToken: vi.fn(async () => null),
    }));
    vi.unstubAllEnvs();
    vi.stubEnv('PERSISTENCE_DEV_TOKEN', 'shared-secret');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PERSISTENCE_ALLOW_INSECURE_DEV_AUTH', '');
  });

  it('refuses the development authenticator in production without the explicit opt-in', async () => {
    const { authenticatePersistenceRequest } = await import('@/lib/persistence/server-auth');
    vi.stubEnv('NODE_ENV', 'production');
    await expect(
      authenticatePersistenceRequest(
        request({ authorization: 'Bearer shared-secret', 'x-learner-key': 'anon:learner-1' }),
      ),
    ).resolves.toBeUndefined();
  });

  it('serves in production when the insecure-opt-in is explicitly set', async () => {
    const { authenticatePersistenceRequest } = await import('@/lib/persistence/server-auth');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PERSISTENCE_ALLOW_INSECURE_DEV_AUTH', 'true');
    await expect(
      authenticatePersistenceRequest(
        request({ authorization: 'Bearer shared-secret', 'x-learner-key': 'anon:learner-1' }),
      ),
    ).resolves.toEqual({ key: 'shared', learnerKey: 'anon:learner-1' });
  });

  it('keeps unchanged behaviour outside production regardless of the opt-in flag', async () => {
    const { authenticatePersistenceRequest } = await import('@/lib/persistence/server-auth');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PERSISTENCE_ALLOW_INSECURE_DEV_AUTH', 'true');
    await expect(
      authenticatePersistenceRequest(
        request({ authorization: 'Bearer shared-secret', 'x-learner-key': 'anon:dev-1' }),
      ),
    ).resolves.toEqual({ key: 'shared', learnerKey: 'anon:dev-1' });

    vi.stubEnv('PERSISTENCE_ALLOW_INSECURE_DEV_AUTH', '');
    await expect(
      authenticatePersistenceRequest(
        request({ authorization: 'Bearer shared-secret', 'x-learner-key': 'anon:dev-2' }),
      ),
    ).resolves.toEqual({ key: 'shared', learnerKey: 'anon:dev-2' });
  });
});
