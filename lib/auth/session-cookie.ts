export const AUTH_COOKIE_NAME = 'openmaic_session';

function sessionSigningSecret(): string {
  return (
    process.env.OPENMAIC_SESSION_SIGNING_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.ACCESS_CODE ||
    'openmaic-development-session-secret'
  );
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

export function sessionTokenPayload(randomToken: string, expiresAtMs: number): string {
  return `v1.${randomToken}.${expiresAtMs}`;
}

export async function signSessionTokenPayload(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    bufferSource(encodeUtf8(sessionSigningSecret())),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, bufferSource(encodeUtf8(payload)));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createSignedSessionToken(input: {
  randomToken: string;
  expiresAtMs: number;
}): Promise<string> {
  const payload = sessionTokenPayload(input.randomToken, input.expiresAtMs);
  return `${payload}.${await signSessionTokenPayload(payload)}`;
}

export async function verifySignedSessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const expiresAtMs = Number(parts[2]);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return false;
  const payload = parts.slice(0, 3).join('.');
  const expected = base64UrlToBytes(await signSessionTokenPayload(payload));
  const actual = base64UrlToBytes(parts[3] || '');
  return equalBytes(expected, actual);
}
