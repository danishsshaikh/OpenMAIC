import { FACULTY_VOICE_OWNER_ID, isVoiceCloningServerEnabled } from '@/lib/voice-cloning/config';
import { getVoiceCloningProvider } from '@/lib/voice-cloning/provider';
import {
  readVoiceProfile,
  referenceAudioExists,
  writeVoiceProfile,
} from '@/lib/voice-cloning/storage';
import { resolveTTSLanguageCode } from '@/lib/audio/tts-language';
import {
  isVoiceProviderProfileNotFoundError,
  resolveVoiceProfileGenerationSettings,
  resolveVoiceProfileLanguageId,
  resolveVoiceProfileModelVariant,
} from '@/lib/voice-cloning/types';

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
  if (!(await referenceAudioExists(profile.referenceAudioKey))) {
    throw new Error('Voice profile reference audio not found');
  }
  const language = resolveTTSLanguageCode(resolveVoiceProfileLanguageId(profile), {
    fallbackLanguage: profile.language,
  });
  const modelVariant = resolveVoiceProfileModelVariant(profile);
  const generationSettings = resolveVoiceProfileGenerationSettings(profile);
  const provider = getVoiceCloningProvider();
  const synthesize = (providerReferenceId: string) =>
    provider.synthesize({
      providerReferenceId,
      text: input.text,
      language,
      modelVariant,
      generationSettings,
    });

  try {
    return await synthesize(profile.providerReferenceId);
  } catch (error) {
    if (!isVoiceProviderProfileNotFoundError(error)) {
      throw error;
    }
  }

  const { providerReferenceId } = await provider.createProfile({
    profileId: profile.id,
    referenceAudioKey: profile.referenceAudioKey!,
    language,
    modelVariant,
    generationSettings,
  });
  if (providerReferenceId !== profile.providerReferenceId) {
    await writeVoiceProfile({
      ...profile,
      providerReferenceId,
      updatedAt: new Date().toISOString(),
    });
  }
  return synthesize(providerReferenceId);
}
