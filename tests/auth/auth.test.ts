import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let authDir: string;

describe('university account authentication', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    authDir = await mkdtemp(join(tmpdir(), 'openmaic-auth-'));
    vi.stubEnv('OPENMAIC_AUTH_DATA_DIR', authDir);
    vi.stubEnv('OPENMAIC_ALLOWED_EMAIL_DOMAIN', 'mituniversity.ac.in');
    vi.stubEnv('OPENMAIC_BOOTSTRAP_ADMIN_EMAIL', 'admin@mituniversity.ac.in');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(authDir, { recursive: true, force: true });
  });

  it('accepts exact MIT University domains and rejects lookalikes', async () => {
    const { getEmailDomain, isAllowedUniversityEmail, normalizeEmail } =
      await import('@/lib/auth/server');

    expect(normalizeEmail('  FACULTY@MITUNIVERSITY.AC.IN  ')).toBe('faculty@mituniversity.ac.in');
    expect(getEmailDomain('faculty@mituniversity.ac.in')).toBe('mituniversity.ac.in');
    expect(isAllowedUniversityEmail('faculty@mituniversity.ac.in')).toBe(true);
    expect(isAllowedUniversityEmail('faculty@mituniversity.ac.in.evil.com')).toBe(false);
    expect(isAllowedUniversityEmail('faculty@evilmituniversity.ac.in')).toBe(false);
  });

  it('creates faculty users, hashes passwords, logs in, and invalidates logout sessions', async () => {
    const {
      authenticateUser,
      createSession,
      createUser,
      destroySession,
      getUserBySessionToken,
      validateSignupInput,
    } = await import('@/lib/auth/server');

    expect(
      validateSignupInput({
        name: 'A',
        email: 'faculty@mituniversity.ac.in',
        password: 'Password123',
      }),
    ).toMatch(/Name/);

    const user = await createUser({
      name: 'Faculty User',
      email: 'Faculty@MitUniversity.Ac.In',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    expect(user.role).toBe('faculty');
    expect(user.email).toBe('faculty@mituniversity.ac.in');
    expect(user.passwordHash).toContain('scrypt$');
    expect(user.passwordHash).not.toContain('Password123');

    await expect(
      createUser({
        name: 'Duplicate',
        email: 'faculty@mituniversity.ac.in',
        password: 'Password123',
      }),
    ).rejects.toThrow('already exists');

    await expect(authenticateUser('faculty@mituniversity.ac.in', 'wrong')).resolves.toBeNull();
    await expect(
      authenticateUser('faculty@mituniversity.ac.in', 'Password123'),
    ).resolves.toMatchObject({
      id: user.id,
    });

    const { token } = await createSession(user.id);
    await expect(getUserBySessionToken(token)).resolves.toMatchObject({ id: user.id });
    await destroySession(token);
    await expect(getUserBySessionToken(token)).resolves.toBeNull();
  });

  it('bootstraps only the configured admin and rate-limits repeated attempts', async () => {
    const { createUser, isRateLimited, listPublicUsers, resetAuthRateLimitsForTests } =
      await import('@/lib/auth/server');

    const admin = await createUser({
      name: 'Admin User',
      email: 'admin@mituniversity.ac.in',
      password: 'Password123',
    });
    const faculty = await createUser({
      name: 'Faculty User',
      email: 'faculty2@mituniversity.ac.in',
      password: 'Password123',
    });

    expect(admin.role).toBe('admin');
    expect(faculty.role).toBe('faculty');
    await expect(listPublicUsers()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: admin.id, role: 'admin' }),
        expect.objectContaining({ id: faculty.id, role: 'faculty' }),
      ]),
    );

    resetAuthRateLimitsForTests();
    expect(isRateLimited({ action: 'login', key: 'ip:user', limit: 2 })).toBe(false);
    expect(isRateLimited({ action: 'login', key: 'ip:user', limit: 2 })).toBe(false);
    expect(isRateLimited({ action: 'login', key: 'ip:user', limit: 2 })).toBe(true);
  });
});
