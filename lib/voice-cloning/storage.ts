import { promises as fs } from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { getVoiceCloningStorageDir } from '@/lib/voice-cloning/config';
import type { VoiceProfile } from '@/lib/voice-cloning/types';

const PROFILE_FILE = 'profile.json';
const REFERENCE_FILE = 'reference.wav';

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

function safeProfileId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Invalid voice profile id');
  }
  return id;
}

export function createVoiceProfileId(): string {
  return `vcp_${nanoid(16)}`;
}

export function getVoiceProfileDir(profileId: string): string {
  return path.join(getVoiceCloningStorageDir(), safeProfileId(profileId));
}

function profilePath(profileId: string): string {
  return path.join(getVoiceProfileDir(profileId), PROFILE_FILE);
}

export function referenceAudioKeyForProfile(profileId: string): string {
  return path.join(getVoiceProfileDir(profileId), REFERENCE_FILE);
}

export async function writeVoiceProfile(profile: VoiceProfile): Promise<void> {
  const dir = getVoiceProfileDir(profile.id);
  await ensureDir(dir);
  const tmp = path.join(dir, `${PROFILE_FILE}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(profile, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, profilePath(profile.id));
}

export async function readVoiceProfile(profileId: string): Promise<VoiceProfile | null> {
  try {
    const raw = await fs.readFile(profilePath(profileId), 'utf8');
    return JSON.parse(raw) as VoiceProfile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function findCurrentVoiceProfile(ownerId: string): Promise<VoiceProfile | null> {
  const root = getVoiceCloningStorageDir();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const profiles: VoiceProfile[] = [];
  for (const entry of entries) {
    if (!entry.startsWith('vcp_')) continue;
    const profile = await readVoiceProfile(entry).catch(() => null);
    if (profile?.ownerId === ownerId && profile.status !== 'deleted') {
      profiles.push(profile);
    }
  }
  profiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return profiles[0] ?? null;
}

export async function writeReferenceAudio(profileId: string, bytes: Uint8Array): Promise<string> {
  const key = referenceAudioKeyForProfile(profileId);
  await ensureDir(path.dirname(key));
  await fs.writeFile(key, bytes, { mode: 0o600 });
  return key;
}

export async function deleteVoiceProfileAssets(profile: VoiceProfile): Promise<void> {
  if (profile.referenceAudioKey) {
    await fs.rm(profile.referenceAudioKey, { force: true }).catch(() => undefined);
  }
}
