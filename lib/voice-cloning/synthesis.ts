import { FACULTY_VOICE_OWNER_ID, isVoiceCloningServerEnabled } from '@/lib/voice-cloning/config';
import { getVoiceCloningProvider } from '@/lib/voice-cloning/provider';
import { readVoiceProfile } from '@/lib/voice-cloning/storage';

export async function synthesizeFacultyVoice(input: {
  profileId: string;
  text: string;
  language?: string;
}): Promise<{ audio: Uint8Array; format: string }> {
  if (!isVoiceCloningServerEnabled()) {
    throw new Error('Voice cloning is disabled');
  }
  const profile = await readVoiceProfile(input.profileId);
  if (!profile || profile.ownerId !== FACULTY_VOICE_OWNER_ID || profile.status === 'deleted') {
    throw new Error('Voice profile not found');
  }
  if (profile.status !== 'ready' || !profile.providerReferenceId) {
    throw new Error('Voice profile is not ready');
  }
  return getVoiceCloningProvider().synthesize({
    providerReferenceId: profile.providerReferenceId,
    text: input.text,
    language: input.language || profile.language,
  });
}
