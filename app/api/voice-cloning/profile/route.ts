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
  resolveVoiceProfileModelVariant,
  toPublicVoiceProfile,
  type ChatterboxModelVariant,
  type VoicePreview,
  type VoiceProfile,
} from '@/lib/voice-cloning/types';
import {
  normalizeVoiceEnrollmentClips,
  type IncomingVoiceClip,
} from '@/lib/voice-cloning/audio-validation';
import { getVoiceCloningProvider } from '@/lib/voice-cloning/provider';
import { createLogger } from '@/lib/logger';
import { resolveTTSLanguageCode } from '@/lib/audio/tts-language';

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

async function generateVariantPreview(
  profile: VoiceProfile,
  modelVariant: ChatterboxModelVariant,
): Promise<{ providerReferenceId: string; preview: VoicePreview }> {
  if (!profile.referenceAudioKey || !(await referenceAudioExists(profile.referenceAudioKey))) {
    throw new Error('Voice profile reference audio not found');
  }
  const provider = getVoiceCloningProvider();
  const { providerReferenceId } = await provider.createProfile({
    profileId: profile.id,
    referenceAudioKey: profile.referenceAudioKey,
    language: profile.language,
    modelVariant,
  });
  const preview = await provider.generatePreview({
    providerReferenceId,
    text: VOICE_PREVIEW_TEXT,
    language: profile.language,
    modelVariant,
  });
  return {
    providerReferenceId,
    preview: voicePreviewFromAudio(preview.audio, preview.format),
  };
}

async function readClip(formData: FormData, key: string): Promise<IncomingVoiceClip> {
  const value = formData.get(key);
  if (!(value instanceof File)) {
    throw new Error(`Missing recording: ${key}`);
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
    const language = resolveTTSLanguageCode(
      typeof formData.get('language') === 'string'
        ? String(formData.get('language')).trim() || getVoiceCloningDefaultLanguage()
        : getVoiceCloningDefaultLanguage(),
      { defaultLanguage: getVoiceCloningDefaultLanguage() },
    );
    const parsedModelVariant = requestedModelVariant(formData.get('modelVariant'));
    if (parsedModelVariant === null) {
      return apiError('INVALID_REQUEST', 400, 'Unsupported voice model');
    }
    const modelVariant = parsedModelVariant ?? serverDefaultModelVariant();
    if (!modelVariant) {
      return apiError('INVALID_REQUEST', 400, 'Unsupported voice model');
    }
    const clips = await Promise.all([
      readClip(formData, 'clip0'),
      readClip(formData, 'clip1'),
      readClip(formData, 'clip2'),
    ]);
    previousProfile = await findCurrentVoiceProfile(FACULTY_VOICE_OWNER_ID);

    const now = new Date().toISOString();
    const profileId = createVoiceProfileId();
    profile = {
      id: profileId,
      ownerId: FACULTY_VOICE_OWNER_ID,
      displayName: displayName || 'My Teaching Voice',
      provider: 'chatterbox',
      language,
      modelVariant,
      status: 'processing',
      createdAt: now,
      updatedAt: now,
      consentTimestamp: now,
      consentVersion: VOICE_CLONING_CONSENT_VERSION,
      profileVersion: 1,
    };
    await writeVoiceProfile(profile);

    const { referenceAudio, durations } = await normalizeVoiceEnrollmentClips(clips);
    const referenceAudioKey = await writeReferenceAudio(profileId, referenceAudio);
    profile = { ...profile, referenceAudioKey, updatedAt: new Date().toISOString() };
    await writeVoiceProfile(profile);

    const { providerReferenceId, preview } = await generateVariantPreview(profile, modelVariant);
    profile = {
      ...profile,
      providerReferenceId,
      modelVariant,
      status: 'preview-ready',
      updatedAt: new Date().toISOString(),
      preview,
      previewVariants: { [modelVariant]: preview },
    };
    await writeVoiceProfile(profile);

    if (previousProfile && previousProfile.id !== profile.id) {
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
        updatedAt: new Date().toISOString(),
      });
    }

    log.info('voice profile enrolled', {
      profileId,
      operation: 'enroll',
      status: profile.status,
      duration: durations.reduce((sum, value) => sum + value, 0),
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
  };
  if (!body.profileId || !body.action) {
    return apiError('INVALID_REQUEST', 400, 'Invalid profile update');
  }
  const profile = await readVoiceProfile(body.profileId);
  if (!profile || profile.ownerId !== FACULTY_VOICE_OWNER_ID || profile.status === 'deleted') {
    return apiError('INVALID_REQUEST', 404, 'Voice profile not found');
  }
  const modelVariant =
    body.modelVariant === undefined
      ? resolveVoiceProfileModelVariant(profile)
      : isChatterboxModelVariant(body.modelVariant)
        ? body.modelVariant
        : null;
  if (!modelVariant) {
    return apiError('INVALID_REQUEST', 400, 'Unsupported voice model');
  }

  if (body.action === 'preview-model') {
    if (profile.status !== 'preview-ready' && profile.status !== 'ready') {
      return apiError('INVALID_REQUEST', 400, 'Voice profile is not ready for preview');
    }
    const { providerReferenceId, preview } = await generateVariantPreview(profile, modelVariant);
    const previewVariants = { ...(profile.previewVariants ?? {}), [modelVariant]: preview };
    const next = {
      ...profile,
      providerReferenceId,
      preview,
      previewVariants,
      updatedAt: new Date().toISOString(),
    };
    await writeVoiceProfile(next);
    return apiSuccess({ profile: toPublicVoiceProfile(next) });
  }

  if (body.action !== 'accept-preview') {
    return apiError('INVALID_REQUEST', 400, 'Invalid profile update');
  }

  const acceptedPreview = profile.previewVariants?.[modelVariant] ?? profile.preview;
  if (!acceptedPreview) {
    return apiError('INVALID_REQUEST', 400, 'Preview must be generated before accepting');
  }
  const next = {
    ...profile,
    status: 'ready' as const,
    modelVariant,
    preview: acceptedPreview,
    previewVariants: { ...(profile.previewVariants ?? {}), [modelVariant]: acceptedPreview },
    updatedAt: new Date().toISOString(),
  };
  await writeVoiceProfile(next);
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
