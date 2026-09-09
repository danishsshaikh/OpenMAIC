import { isVoiceCloningServerEnabled } from '@/lib/voice-cloning/config';
import { getVoiceCloningProvider } from '@/lib/voice-cloning/provider';
import {
  readVoiceProfile,
  referenceAudioExists,
  writeVoiceProfile,
} from '@/lib/voice-cloning/storage';
import { resolveTTSLanguageCode } from '@/lib/audio/tts-language';
import { masterGeneratedVoiceAudio } from '@/lib/voice-cloning/audio-validation';
import { createLogger } from '@/lib/logger';
import {
  isVoiceProviderProfileNotFoundError,
  resolveVoiceProfileGenerationSettings,
  resolveVoiceProfileLanguageId,
  resolveVoiceProfileModelVariant,
} from '@/lib/voice-cloning/types';

const log = createLogger('VoiceCloningSynthesis');

export async function synthesizeFacultyVoice(input: {
  profileId: string;
  ownerId: string;
  text: string;
  language?: string;
}): Promise<{ audio: Uint8Array; format: string }> {
  if (!isVoiceCloningServerEnabled()) {
    throw new Error('Voice cloning is disabled');
  }
  const profile = await readVoiceProfile(input.profileId, input.ownerId);
  if (!profile || profile.ownerId !== input.ownerId || profile.status === 'deleted') {
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
  const synthesize = async (providerReferenceId: string) => {
    const result = await provider.synthesize({
      providerReferenceId,
      text: input.text,
      language,
      modelVariant,
      generationSettings,
    });
    const mastered = await masterGeneratedVoiceAudio(result.audio, result.format);
    log.info('voice output mastering completed', {
      profileId: profile.id,
      operation: 'synthesize',
      format: mastered.format,
    });
    return mastered;
  };

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
