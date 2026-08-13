import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  FACULTY_VOICE_OWNER_ID,
  getVoiceCloningDefaultLanguage,
  getChatterboxDefaultModelVariant,
  isVoiceCloningServerEnabled,
} from '@/lib/voice-cloning/config';
import { VOICE_CLONING_CONSENT_VERSION, VOICE_PREVIEW_TEXT } from '@/lib/voice-cloning/phrases';
import {
  createVoiceProfileId,
  deleteVoiceProfileAssets,
  findCurrentVoiceProfile,
  readVoiceProfile,
  referenceAudioExists,
  writeReferenceAudio,
  writeVoiceProfile,
} from '@/lib/voice-cloning/storage';
import {
  isChatterboxModelVariant,
  resolveNewVoiceProfileModelVariant,
  resolveVoiceProfileGenerationSettings,
  resolveVoiceProfileLanguageId,
  resolveVoiceProfileModelVariant,
  toPublicVoiceProfile,
  validateVoiceGenerationSettings,
  type ChatterboxModelVariant,
  type VoiceConfiguration,
  type VoiceGenerationSettings,
  type VoicePreview,
  type VoiceProfile,
} from '@/lib/voice-cloning/types';
import {
  isVoiceRecordingQualityError,
  masterGeneratedVoiceAudio,
  normalizeVoiceEnrollmentRecording,
  type IncomingVoiceClip,
} from '@/lib/voice-cloning/audio-validation';
import { getVoiceCloningProvider } from '@/lib/voice-cloning/provider';
import { createLogger } from '@/lib/logger';
import { resolveTTSLanguageCode, tryResolveTTSLanguageCode } from '@/lib/audio/tts-language';

const log = createLogger('VoiceCloningProfileAPI');

export const maxDuration = 120;

function disabled() {
  return apiError('PROVIDER_DISABLED', 404, 'Voice cloning is disabled');
}

function requestedModelVariant(
  value: FormDataEntryValue | null,
): ChatterboxModelVariant | null | undefined {
  if (value === null) return undefined;
  return resolveNewVoiceProfileModelVariant(typeof value === 'string' ? value : String(value));
}

function serverDefaultModelVariant(): ChatterboxModelVariant {
  const configured = getChatterboxDefaultModelVariant();
  return isChatterboxModelVariant(configured) ? configured : 'v3';
}

function voicePreviewFromAudio(audio: Uint8Array, format: string): VoicePreview {
  return {
    format,
    base64: Buffer.from(audio).toString('base64'),
    createdAt: new Date().toISOString(),
  };
}

function parseGenerationSettings(value: unknown): VoiceGenerationSettings {
  if (typeof value === 'string') {
    try {
      return validateVoiceGenerationSettings(JSON.parse(value));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('Invalid voice generation settings');
      throw error;
    }
  }
  return validateVoiceGenerationSettings(value);
}

function parseProfileLanguageId(value: unknown, fallbackLanguage?: string | null): string {
  if (value === undefined || value === null || value === '') {
    return resolveTTSLanguageCode(fallbackLanguage, {
      defaultLanguage: getVoiceCloningDefaultLanguage(),
    });
  }
  if (typeof value !== 'string') throw new Error('Unsupported voice language');
  const languageId = tryResolveTTSLanguageCode(value.trim());
  if (!languageId) throw new Error('Unsupported voice language');
  return languageId;
}

function resolveVoiceConfiguration(input: {
  modelVariant?: unknown;
  languageId?: unknown;
  generationSettings?: unknown;
  fallbackProfile?: VoiceProfile;
}): VoiceConfiguration {
  const profile = input.fallbackProfile;
  const modelVariant =
    input.modelVariant === undefined
      ? profile
        ? resolveVoiceProfileModelVariant(profile)
        : serverDefaultModelVariant()
      : isChatterboxModelVariant(input.modelVariant)
        ? input.modelVariant
        : null;
  if (!modelVariant) throw new Error('Unsupported voice model');

  const languageId = parseProfileLanguageId(
    input.languageId,
    profile ? resolveVoiceProfileLanguageId(profile) : undefined,
  );

  const generationSettings =
    input.generationSettings === undefined && profile
      ? resolveVoiceProfileGenerationSettings(profile)
      : parseGenerationSettings(input.generationSettings);

  return { modelVariant, languageId, generationSettings };
}

function voiceConfigurationsEqual(left: VoiceConfiguration, right: VoiceConfiguration): boolean {
  return (
    left.modelVariant === right.modelVariant &&
    left.languageId === right.languageId &&
    JSON.stringify(left.generationSettings) === JSON.stringify(right.generationSettings)
  );
}

async function generateVariantPreview(
  profile: VoiceProfile,
  config: VoiceConfiguration,
): Promise<{ providerReferenceId: string; preview: VoicePreview }> {
  if (!profile.referenceAudioKey || !(await referenceAudioExists(profile.referenceAudioKey))) {
    throw new Error('Voice profile reference audio not found');
  }
  const provider = getVoiceCloningProvider();
  const { providerReferenceId } = await provider.createProfile({
    profileId: profile.id,
    referenceAudioKey: profile.referenceAudioKey,
    language: config.languageId,
    modelVariant: config.modelVariant,
    generationSettings: config.generationSettings,
  });
  const preview = await provider.generatePreview({
    providerReferenceId,
    text: VOICE_PREVIEW_TEXT,
    language: config.languageId,
    modelVariant: config.modelVariant,
    generationSettings: config.generationSettings,
  });
  const mastered = await masterGeneratedVoiceAudio(preview.audio, preview.format);
  log.info('voice output mastering completed', {
    profileId: profile.id,
    operation: 'preview',
    format: mastered.format,
  });
  return {
    providerReferenceId,
    preview: voicePreviewFromAudio(mastered.audio, mastered.format),
  };
}

async function readEnrollmentRecording(formData: FormData): Promise<IncomingVoiceClip> {
  const value = formData.get('recording');
  if (!(value instanceof File)) {
    throw new Error('Missing recording');
  }
  return {
    bytes: new Uint8Array(await value.arrayBuffer()),
    mimeType: value.type,
    fileName: value.name,
  };
}

export async function GET() {
  if (!isVoiceCloningServerEnabled()) return disabled();
  const profile = await findCurrentVoiceProfile(FACULTY_VOICE_OWNER_ID);
  return apiSuccess({ profile: toPublicVoiceProfile(profile) });
}

export async function POST(req: NextRequest) {
  if (!isVoiceCloningServerEnabled()) return disabled();
  let profile: VoiceProfile | null = null;
  let previousProfile: VoiceProfile | null = null;
  try {
    const formData = await req.formData();
    const consent = formData.get('consent') === 'true';
    if (!consent) {
      return apiError('INVALID_REQUEST', 400, 'Explicit consent is required');
    }

    const displayName =
      typeof formData.get('displayName') === 'string'
        ? String(formData.get('displayName')).trim().slice(0, 80)
        : '';
    const parsedModelVariant = requestedModelVariant(formData.get('modelVariant'));
    if (parsedModelVariant === null) {
      return apiError('INVALID_REQUEST', 400, 'Unsupported voice model');
    }
    let languageId: string;
    let generationSettings: VoiceGenerationSettings;
    try {
      languageId = parseProfileLanguageId(
        formData.get('languageId') ?? formData.get('language'),
        getVoiceCloningDefaultLanguage(),
      );
      generationSettings = parseGenerationSettings(formData.get('generationSettings'));
    } catch (error) {
      return apiError(
        'INVALID_REQUEST',
        400,
        error instanceof Error ? error.message : 'Invalid voice settings',
      );
    }
    const config: VoiceConfiguration = {
      modelVariant: parsedModelVariant ?? serverDefaultModelVariant(),
      languageId,
      generationSettings,
    };
    const profileId = createVoiceProfileId();
    let normalizedReference: Awaited<ReturnType<typeof normalizeVoiceEnrollmentRecording>>;
    try {
      const recording = await readEnrollmentRecording(formData);
      log.info('voice enrollment quality check started', {
        profileId,
        operation: 'enroll',
        recordingBytes: recording.bytes.byteLength,
      });
      normalizedReference = await normalizeVoiceEnrollmentRecording(recording);
      log.info('voice enrollment quality check passed', {
        profileId,
        operation: 'enroll',
        duration: normalizedReference.durationSeconds,
        meanVolumeDb: normalizedReference.quality.meanVolumeDb,
        maxVolumeDb: normalizedReference.quality.maxVolumeDb,
        silenceRatio: normalizedReference.quality.silenceRatio,
      });
    } catch (error) {
      if (isVoiceRecordingQualityError(error)) {
        log.warn('voice enrollment rejected', {
          profileId,
          operation: 'enroll',
          reason: error.code,
        });
        return apiError('INVALID_REQUEST', 400, error.userMessage);
      }
      return apiError(
        'INVALID_REQUEST',
        400,
        error instanceof Error ? error.message : 'Invalid voice recording',
      );
    }

    previousProfile = await findCurrentVoiceProfile(FACULTY_VOICE_OWNER_ID);

    const now = new Date().toISOString();
    profile = {
      id: profileId,
      ownerId: FACULTY_VOICE_OWNER_ID,
      displayName: displayName || 'My Teaching Voice',
      provider: 'chatterbox',
      language: languageId,
      languageId,
      modelVariant: config.modelVariant,
      generationSettings,
      status: 'processing',
      createdAt: now,
      updatedAt: now,
      consentTimestamp: now,
      consentVersion: VOICE_CLONING_CONSENT_VERSION,
      profileVersion: 1,
      replacesProfileId: previousProfile?.id,
    };
    await writeVoiceProfile(profile);

    const referenceAudioKey = await writeReferenceAudio(
      profileId,
      normalizedReference.referenceAudio,
    );
    profile = { ...profile, referenceAudioKey, updatedAt: new Date().toISOString() };
    await writeVoiceProfile(profile);
    log.info('voice reference preprocessing completed', {
      profileId,
      operation: 'enroll',
      duration: normalizedReference.durationSeconds,
    });

    const { providerReferenceId, preview } = await generateVariantPreview(profile, config);
    profile = {
      ...profile,
      providerReferenceId,
      status: 'preview-ready',
      updatedAt: new Date().toISOString(),
      draftPreview: { config, preview },
    };
    await writeVoiceProfile(profile);

    log.info('voice profile enrolled', {
      profileId,
      operation: 'enroll',
      status: profile.status,
      duration: normalizedReference.durationSeconds,
    });

    return apiSuccess({ profile: toPublicVoiceProfile(profile) }, 201);
  } catch (error) {
    if (profile) {
      const failed = {
        ...profile,
        status: 'failed' as const,
        updatedAt: new Date().toISOString(),
        failureReason: error instanceof Error ? error.message : 'Voice enrollment failed',
      };
      await writeVoiceProfile(failed).catch(() => undefined);
    }
    log.warn('voice profile enrollment failed', {
      operation: 'enroll',
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      profileId: profile?.id,
    });
    return apiError(
      'GENERATION_FAILED',
      500,
      'Voice enrollment failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function PATCH(req: NextRequest) {
  if (!isVoiceCloningServerEnabled()) return disabled();
  const body = (await req.json().catch(() => ({}))) as {
    profileId?: string;
    action?: string;
    modelVariant?: string;
    languageId?: string;
    generationSettings?: unknown;
  };
  if (!body.profileId || !body.action) {
    return apiError('INVALID_REQUEST', 400, 'Invalid profile update');
  }
  const profile = await readVoiceProfile(body.profileId);
  if (!profile || profile.ownerId !== FACULTY_VOICE_OWNER_ID || profile.status === 'deleted') {
    return apiError('INVALID_REQUEST', 404, 'Voice profile not found');
  }
  let config: VoiceConfiguration;
  try {
    config = resolveVoiceConfiguration({
      modelVariant: body.modelVariant,
      languageId: body.languageId,
      generationSettings: body.generationSettings,
      fallbackProfile: profile,
    });
  } catch (error) {
    return apiError(
      'INVALID_REQUEST',
      400,
      error instanceof Error ? error.message : 'Invalid voice settings',
    );
  }

  if (body.action === 'preview-model') {
    if (profile.status !== 'preview-ready' && profile.status !== 'ready') {
      return apiError('INVALID_REQUEST', 400, 'Voice profile is not ready for preview');
    }
    const { providerReferenceId, preview } = await generateVariantPreview(profile, config);
    const next = {
      ...profile,
      providerReferenceId,
      draftPreview: { config, preview },
      updatedAt: new Date().toISOString(),
    };
    await writeVoiceProfile(next);
    return apiSuccess({ profile: toPublicVoiceProfile(next) });
  }

  if (body.action !== 'accept-preview') {
    return apiError('INVALID_REQUEST', 400, 'Invalid profile update');
  }

  const acceptedDraft = profile.draftPreview;
  if (!acceptedDraft || !voiceConfigurationsEqual(acceptedDraft.config, config)) {
    return apiError('INVALID_REQUEST', 400, 'Preview must be generated before accepting');
  }
  const next = {
    ...profile,
    status: 'ready' as const,
    language: config.languageId,
    languageId: config.languageId,
    modelVariant: config.modelVariant,
    generationSettings: config.generationSettings,
    preview: acceptedDraft.preview,
    draftPreview: undefined,
    updatedAt: new Date().toISOString(),
  };
  await writeVoiceProfile(next);
  if (profile.replacesProfileId) {
    const previousProfile = await readVoiceProfile(profile.replacesProfileId);
    if (
      previousProfile &&
      previousProfile.ownerId === FACULTY_VOICE_OWNER_ID &&
      previousProfile.status !== 'deleted'
    ) {
      if (previousProfile.providerReferenceId) {
        await getVoiceCloningProvider()
          .deleteProfile({ providerReferenceId: previousProfile.providerReferenceId })
          .catch(() => undefined);
      }
      await deleteVoiceProfileAssets(previousProfile);
      await writeVoiceProfile({
        ...previousProfile,
        status: 'deleted',
        referenceAudioKey: undefined,
        providerReferenceId: undefined,
        preview: undefined,
        previewVariants: undefined,
        draftPreview: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return apiSuccess({ profile: toPublicVoiceProfile(next) });
}

export async function DELETE(req: NextRequest) {
  if (!isVoiceCloningServerEnabled()) return disabled();
  const profileId = req.nextUrl.searchParams.get('profileId');
  const profile = profileId
    ? await readVoiceProfile(profileId)
    : await findCurrentVoiceProfile(FACULTY_VOICE_OWNER_ID);
  if (!profile || profile.ownerId !== FACULTY_VOICE_OWNER_ID || profile.status === 'deleted') {
    return apiSuccess({ deleted: true });
  }
  try {
    if (profile.providerReferenceId) {
      await getVoiceCloningProvider()
        .deleteProfile({ providerReferenceId: profile.providerReferenceId })
        .catch(() => undefined);
    }
    await deleteVoiceProfileAssets(profile);
    await writeVoiceProfile({
      ...profile,
      status: 'deleted',
      referenceAudioKey: undefined,
      providerReferenceId: undefined,
      preview: undefined,
      previewVariants: undefined,
      draftPreview: undefined,
      updatedAt: new Date().toISOString(),
    });
    log.info('voice profile deleted', {
      profileId: profile.id,
      operation: 'delete',
      status: 'deleted',
    });
    return apiSuccess({ deleted: true });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Voice profile deletion failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}
