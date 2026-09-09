import type { IncomingMessage } from 'node:http';

import { beforeEach, describe, expect, it, vi } from 'vitest';

function request(headers: IncomingMessage['headers']): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe('embedded persistence session authentication', () => {
  beforeEach(() => {
    vi.resetModules();
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
    ).resolves.toEqual({ learnerKey: 'user:usr_faculty_a' });
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
