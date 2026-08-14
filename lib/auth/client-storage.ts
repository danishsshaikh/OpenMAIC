const AUTH_USER_ID_KEY = 'openmaic.auth.userId';

function safeNamespace(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return 'anonymous';
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'anonymous';
}

export function getBrowserAuthUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(AUTH_USER_ID_KEY);
  } catch {
    return null;
  }
}

export function setBrowserAuthUserId(userId: string): void {
  try {
    window.localStorage.setItem(AUTH_USER_ID_KEY, userId);
  } catch {
    /* localStorage unavailable */
  }
}

export function clearBrowserAuthState(): void {
  try {
    window.localStorage.removeItem(AUTH_USER_ID_KEY);
    window.sessionStorage.clear();
  } catch {
    /* browser storage unavailable */
  }
}

export function getBrowserStorageNamespace(): string {
  return safeNamespace(getBrowserAuthUserId());
}
