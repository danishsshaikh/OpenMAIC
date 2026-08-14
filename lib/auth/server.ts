import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { AUTH_COOKIE_NAME, createSignedSessionToken } from '@/lib/auth/session-cookie';

export { AUTH_COOKIE_NAME };

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60_000;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
const DEFAULT_ALLOWED_DOMAIN = 'mituniversity.ac.in';

function scryptKey(
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export type UserRole = 'admin' | 'faculty';
export type UserStatus = 'active' | 'disabled';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  lastActiveAt?: string;
  voiceConfiguredAt?: string;
  classroomsCreatedCount: number;
}

export interface PublicAuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastLoginAt?: string;
  lastActiveAt?: string;
  voiceConfiguredAt?: string;
  classroomsCreatedCount: number;
  voiceConfigured: boolean;
}

interface AuthSession {
  id: string;
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastActiveAt: string;
}

interface AuthStore {
  users: AuthUser[];
  sessions: AuthSession[];
}

interface RateLimitState {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateLimitState>();
let storeWriteQueue = Promise.resolve();

function authDataDir(): string {
  const configured = process.env.OPENMAIC_AUTH_DATA_DIR?.trim();
  return configured || path.join(process.cwd(), 'data', 'auth');
}

function storePath(): string {
  return path.join(authDataDir(), 'auth-store.json');
}

export function getAllowedEmailDomain(): string {
  return (process.env.OPENMAIC_ALLOWED_EMAIL_DOMAIN || DEFAULT_ALLOWED_DOMAIN).trim().toLowerCase();
}

function bootstrapAdminEmail(): string | null {
  const configured = process.env.OPENMAIC_BOOTSTRAP_ADMIN_EMAIL?.trim();
  return configured ? normalizeEmail(configured) : null;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function getEmailDomain(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at !== normalized.indexOf('@') || at === normalized.length - 1) return '';
  return normalized.slice(at + 1);
}

export function isAllowedUniversityEmail(email: string): boolean {
  return getEmailDomain(email) === getAllowedEmailDomain();
}

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return 'Name must be at least 2 characters';
  if (trimmed.length > 120) return 'Name must be 120 characters or fewer';
  return null;
}

export function validateSignupInput(input: {
  name: string;
  email: string;
  password: string;
  confirmPassword?: string;
}): string | null {
  const nameError = validateName(input.name);
  if (nameError) return nameError;
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid university email';
  if (!isAllowedUniversityEmail(email)) {
    return `Use your ${getAllowedEmailDomain()} university email`;
  }
  if (input.confirmPassword !== undefined && input.password !== input.confirmPassword) {
    return 'Passwords do not match';
  }
  return validatePassword(input.password);
}

export function validatePassword(password: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include at least one letter and one number';
  }
  if (/\s/.test(password)) return 'Password cannot contain spaces';
  return null;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scryptKey(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    SCRYPT_PARAMS.keylen,
    salt,
    derived.toString('base64url'),
  ].join('$');
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, keylen, salt, expected] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const derived = await scryptKey(password, salt, Number(keylen), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  const expectedBuffer = Buffer.from(expected, 'base64url');
  if (derived.length !== expectedBuffer.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

async function readStore(): Promise<AuthStore> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AuthStore>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { users: [], sessions: [] };
    throw error;
  }
}

async function writeStore(store: AuthStore): Promise<void> {
  await fs.mkdir(authDataDir(), { recursive: true, mode: 0o700 });
  const file = storePath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, file);
}

async function updateStore<T>(fn: (store: AuthStore) => Promise<T>): Promise<T> {
  const run = storeWriteQueue.then(async () => {
    const store = await readStore();
    const result = await fn(store);
    await writeStore(store);
    return result;
  });
  storeWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function publicUser(user: AuthUser): PublicAuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    lastActiveAt: user.lastActiveAt,
    voiceConfiguredAt: user.voiceConfiguredAt,
    classroomsCreatedCount: user.classroomsCreatedCount || 0,
    voiceConfigured: Boolean(user.voiceConfiguredAt),
  };
}

export function toPublicAuthUser(user: AuthUser): PublicAuthUser {
  return publicUser(user);
}

function roleForNewUser(email: string): UserRole {
  return bootstrapAdminEmail() === email ? 'admin' : 'faculty';
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  confirmPassword?: string;
}): Promise<AuthUser> {
  const error = validateSignupInput(input);
  if (error) throw new Error(error);
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();
  return updateStore(async (store) => {
    if (store.users.some((user) => user.email === email)) {
      throw new Error('An account already exists for this email');
    }
    const user: AuthUser = {
      id: `usr_${nanoid(18)}`,
      name: input.name.trim(),
      email,
      role: roleForNewUser(email),
      status: 'active',
      passwordHash: await hashPassword(input.password),
      createdAt: now,
      updatedAt: now,
      classroomsCreatedCount: 0,
    };
    store.users.push(user);
    return user;
  });
}

export async function authenticateUser(
  emailInput: string,
  password: string,
): Promise<AuthUser | null> {
  const email = normalizeEmail(emailInput);
  const store = await readStore();
  const user = store.users.find((candidate) => candidate.email === email);
  if (!user || user.status !== 'active') return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  const now = new Date().toISOString();
  await updateStore(async (latest) => {
    const stored = latest.users.find((candidate) => candidate.id === user.id);
    if (stored) {
      stored.lastLoginAt = now;
      stored.lastActiveAt = now;
      stored.updatedAt = now;
    }
  });
  return { ...user, lastLoginAt: now, lastActiveAt: now, updatedAt: now };
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const nowMs = Date.now();
  const expiresAt = new Date(nowMs + SESSION_TTL_MS);
  const token = await createSignedSessionToken({
    randomToken: randomBytes(32).toString('base64url'),
    expiresAtMs: expiresAt.getTime(),
  });
  const now = new Date(nowMs).toISOString();
  await updateStore(async (store) => {
    store.sessions = store.sessions.filter(
      (session) => new Date(session.expiresAt).getTime() > nowMs,
    );
    store.sessions.push({
      id: `ses_${nanoid(18)}`,
      tokenHash: tokenHash(token),
      userId,
      createdAt: now,
      expiresAt: expiresAt.toISOString(),
      lastActiveAt: now,
    });
  });
  return { token, expiresAt };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  const hash = tokenHash(token);
  await updateStore(async (store) => {
    store.sessions = store.sessions.filter((session) => session.tokenHash !== hash);
  });
}

export async function getUserBySessionToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const hash = tokenHash(token);
  const nowMs = Date.now();
  const store = await readStore();
  const session = store.sessions.find((candidate) => candidate.tokenHash === hash);
  if (!session || new Date(session.expiresAt).getTime() <= nowMs) return null;
  const user = store.users.find((candidate) => candidate.id === session.userId);
  if (!user || user.status !== 'active') return null;
  if (nowMs - new Date(session.lastActiveAt).getTime() > SESSION_TOUCH_INTERVAL_MS) {
    const now = new Date(nowMs).toISOString();
    await updateStore(async (latest) => {
      const latestSession = latest.sessions.find((candidate) => candidate.tokenHash === hash);
      const latestUser = latest.users.find((candidate) => candidate.id === user.id);
      if (latestSession) latestSession.lastActiveAt = now;
      if (latestUser) {
        latestUser.lastActiveAt = now;
        latestUser.updatedAt = now;
      }
    });
  }
  return user;
}

export async function getSessionUser(req: NextRequest | Request): Promise<AuthUser | null> {
  if ('cookies' in req) {
    return getUserBySessionToken(req.cookies.get(AUTH_COOKIE_NAME)?.value);
  }
  const cookie = req.headers.get('cookie') || '';
  const token = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`))
    ?.slice(AUTH_COOKIE_NAME.length + 1);
  return getUserBySessionToken(token ? decodeURIComponent(token) : undefined);
}

export async function requireSessionUser(req: NextRequest | Request): Promise<AuthUser | Response> {
  const user = await getSessionUser(req);
  if (!user)
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 });
  return user;
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export function isRateLimited(input: {
  action: 'login' | 'signup';
  key: string;
  limit?: number;
  windowMs?: number;
}): boolean {
  const limit = input.limit ?? (input.action === 'login' ? 8 : 4);
  const windowMs = input.windowMs ?? 10 * 60 * 1000;
  const key = `${input.action}:${input.key}`;
  const now = Date.now();
  const state = rateLimits.get(key);
  if (!state || state.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  state.count += 1;
  return state.count > limit;
}

export function rateLimitKey(req: NextRequest, email?: string): string {
  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  return `${ip}:${email ? normalizeEmail(email) : ''}`;
}

export async function listPublicUsers(): Promise<PublicAuthUser[]> {
  const store = await readStore();
  return store.users.map(publicUser).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markVoiceConfigured(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await updateStore(async (store) => {
    const user = store.users.find((candidate) => candidate.id === userId);
    if (user) {
      user.voiceConfiguredAt = now;
      user.updatedAt = now;
    }
  });
}

export async function incrementClassroomsCreated(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await updateStore(async (store) => {
    const user = store.users.find((candidate) => candidate.id === userId);
    if (user) {
      user.classroomsCreatedCount = (user.classroomsCreatedCount || 0) + 1;
      user.updatedAt = now;
    }
  });
}

export function resetAuthRateLimitsForTests(): void {
  rateLimits.clear();
}
