import path from 'path';
import { isVoiceCloningEnabled } from '@/lib/config/feature-flags';

export const FACULTY_VOICE_OWNER_ID = 'local-faculty';

export function isVoiceCloningServerEnabled(): boolean {
  return isVoiceCloningEnabled();
}

export function getVoiceCloningProviderId(): string {
  return (process.env.VOICE_CLONING_PROVIDER || 'chatterbox').trim().toLowerCase();
}

export function getVoiceCloningBaseUrl(): string {
  return (process.env.VOICE_CLONING_BASE_URL || '').trim().replace(/\/$/, '');
}

export function getVoiceCloningStorageDir(): string {
  const configured = process.env.VOICE_CLONING_STORAGE_DIR?.trim();
  return configured || path.join(process.cwd(), 'data', 'voice-cloning');
}

export function getVoiceCloningDefaultLanguage(): string {
  return (process.env.VOICE_CLONING_LANGUAGE_DEFAULT || 'en').trim() || 'en';
}

export function getVoiceCloningTimeoutMs(): number {
  const parsed = Number(process.env.VOICE_CLONING_TIMEOUT_MS || 120000);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 120000;
}
