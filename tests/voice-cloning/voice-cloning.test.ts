import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFeatureFlagBoolean } from '@/lib/config/feature-flags';
import {
  DEFAULT_CHATTERBOX_MODEL_VARIANT,
  LEGACY_CHATTERBOX_MODEL_VARIANT,
  resolveVoiceProfileModelVariant,
  toPublicVoiceProfile,
  VoiceProviderProfileNotFoundError,
  type VoiceProfile,
} from '@/lib/voice-cloning/types';

describe('voice cloning feature flag', () => {
  it('defaults false for unset or non-truthy values', () => {
    expect(readFeatureFlagBoolean(undefined)).toBe(false);
    expect(readFeatureFlagBoolean('')).toBe(false);
    expect(readFeatureFlagBoolean('false')).toBe(false);
  });

  it('accepts canonical truthy values', () => {
    expect(readFeatureFlagBoolean('true')).toBe(true);
    expect(readFeatureFlagBoolean('1')).toBe(true);
    expect(readFeatureFlagBoolean('yes')).toBe(true);
    expect(readFeatureFlagBoolean('on')).toBe(true);
  });
});

describe('voice profile privacy', () => {
  it('returns an opaque public profile without private paths', () => {
    const profile: VoiceProfile = {
      id: 'vcp_test',
      ownerId: 'local-faculty',
      displayName: 'My Teaching Voice',
      provider: 'chatterbox',
      language: 'en',
      status: 'ready',
      modelVariant: 'v3',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      consentTimestamp: '2026-08-11T00:00:00.000Z',
      consentVersion: 'faculty-self-voice-v1',
      referenceAudioKey: '/private/reference.wav',
      providerReferenceId: 'internal-provider-id',
      profileVersion: 1,
    };

    expect(toPublicVoiceProfile(profile)).toEqual({
      id: 'vcp_test',
      displayName: 'My Teaching Voice',
      provider: 'chatterbox',
      language: 'en',
      status: 'ready',
      modelVariant: 'v3',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      consentTimestamp: '2026-08-11T00:00:00.000Z',
      consentVersion: 'faculty-self-voice-v1',
      profileVersion: 1,
    });
  });

  it('exposes legacy V2 semantics for pre-version profiles without private paths', () => {
    const profile = toPublicVoiceProfile({
      id: 'vcp_legacy',
      ownerId: 'local-faculty',
      displayName: 'Legacy',
      provider: 'chatterbox',
      language: 'en',
      status: 'ready',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      consentTimestamp: '2026-08-11T00:00:00.000Z',
      consentVersion: 'faculty-self-voice-v1',
      referenceAudioKey: '/private/reference.wav',
      providerReferenceId: 'ref-legacy',
      profileVersion: 1,
    });

    expect(profile).toMatchObject({
      id: 'vcp_legacy',
      modelVariant: LEGACY_CHATTERBOX_MODEL_VARIANT,
    });
    expect(profile).not.toHaveProperty('referenceAudioKey');
    expect(profile).not.toHaveProperty('providerReferenceId');
  });

  it('hides deleted profiles', () => {
    expect(
      toPublicVoiceProfile({
        id: 'vcp_deleted',
        ownerId: 'local-faculty',
        displayName: 'Deleted',
        provider: 'chatterbox',
        language: 'en',
        status: 'deleted',
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        consentTimestamp: '2026-08-11T00:00:00.000Z',
        consentVersion: 'faculty-self-voice-v1',
        profileVersion: 1,
      }),
    ).toBeNull();
  });
});

describe('explicit cloned voice TTS routing', () => {
  const synthesizeFacultyVoice = vi.fn();
  const generateTTS = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    synthesizeFacultyVoice.mockReset();
    generateTTS.mockReset();
    vi.doMock('@/lib/voice-cloning/synthesis', () => ({ synthesizeFacultyVoice }));
    vi.doMock('@/lib/audio/tts-providers', () => ({
      generateTTS,
      TTSRateLimitError: class TTSRateLimitError extends Error {},
    }));
    vi.doMock('@/lib/server/usage-storage', () => ({ recordGenerationUsage: vi.fn() }));
    vi.doMock('@/lib/server/provider-config', () => ({
      isServerConfiguredProvider: vi.fn(() => false),
      isServerTTSProviderDisabled: vi.fn(() => false),
      resolveTTSApiKey: vi.fn(() => undefined),
      resolveTTSBaseUrl: vi.fn(() => undefined),
      resolveTTSModel: vi.fn((_providerId, modelId) => modelId),
    }));
    vi.doMock('@/lib/server/ssrf-guard', () => ({ validateUrlForSSRF: vi.fn(() => null) }));
  });

  function request(body: Record<string, unknown>) {
    return new Request('http://localhost/api/generate/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Hello class',
        audioId: 'audio-1',
        ttsProviderId: 'browser-native-tts',
        ttsVoice: 'default',
        ...body,
      }),
    });
  }

  it('routes explicit faculty voice requests to the clone provider before default TTS guards', async () => {
    synthesizeFacultyVoice.mockResolvedValue({
      audio: new Uint8Array([1, 2, 3]),
      format: 'wav',
    });
    const { POST } = await import('@/app/api/generate/tts/route');

    const response = await POST(
      request({ teacherVoiceProfileId: 'vcp_ready', language: 'en' }) as never,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ success: true, audioId: 'audio-1', format: 'wav' });
    expect(synthesizeFacultyVoice).toHaveBeenCalledWith({
      profileId: 'vcp_ready',
      text: 'Hello class',
      language: 'en',
    });
    expect(generateTTS).not.toHaveBeenCalled();
  });

  it('does not silently fall back when explicit faculty voice synthesis fails', async () => {
    synthesizeFacultyVoice.mockRejectedValue(new Error('voice service unavailable'));
    const { POST } = await import('@/app/api/generate/tts/route');

    const response = await POST(request({ teacherVoiceProfileId: 'vcp_ready' }) as never);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toMatchObject({
      success: false,
      errorCode: 'GENERATION_FAILED',
    });
    expect(generateTTS).not.toHaveBeenCalled();
  });
});

describe('faculty voice synthesis language resolution', () => {
  const synthesize = vi.fn();
  const createProfile = vi.fn();
  const referenceAudioExists = vi.fn();
  const writeVoiceProfile = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    synthesize.mockReset();
    createProfile.mockReset();
    referenceAudioExists.mockReset();
    writeVoiceProfile.mockReset();
    referenceAudioExists.mockResolvedValue(true);
    writeVoiceProfile.mockResolvedValue(undefined);
    vi.doUnmock('@/lib/voice-cloning/synthesis');
    vi.doMock('@/lib/voice-cloning/config', () => ({
      FACULTY_VOICE_OWNER_ID: 'local-faculty',
      isVoiceCloningServerEnabled: () => true,
      getVoiceCloningProviderId: () => 'chatterbox',
    }));
    vi.doMock('@/lib/voice-cloning/storage', () => ({
      readVoiceProfile: vi.fn(async () => ({
        id: 'vcp_ready',
        ownerId: 'local-faculty',
        displayName: 'Faculty Voice',
        provider: 'chatterbox',
        language: 'hi',
        status: 'ready',
        modelVariant: 'v3',
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        consentTimestamp: '2026-08-11T00:00:00.000Z',
        consentVersion: 'faculty-self-voice-v1',
        referenceAudioKey: '/private/reference.wav',
        providerReferenceId: 'ref-1',
        profileVersion: 1,
      })),
      referenceAudioExists,
      writeVoiceProfile,
    }));
    vi.doMock('@/lib/voice-cloning/provider', () => ({
      getVoiceCloningProvider: () => ({
        createProfile,
        synthesize,
      }),
    }));
  });

  it('never forwards arbitrary generation prose as a provider language id', async () => {
    synthesize.mockResolvedValue({ audio: new Uint8Array([1]), format: 'wav' });
    const { synthesizeFacultyVoice } = await import('@/lib/voice-cloning/synthesis');

    await synthesizeFacultyVoice({
      profileId: 'vcp_ready',
      text: 'Hello class',
      language: 'Use clear beginner-friendly wording throughout.',
    });

    expect(synthesize).toHaveBeenCalledWith({
      providerReferenceId: 'ref-1',
      text: 'Hello class',
      language: 'hi',
      modelVariant: 'v3',
    });
  });

  it('re-registers a persisted profile after provider restart and retries synthesis once', async () => {
    synthesize
      .mockRejectedValueOnce(new VoiceProviderProfileNotFoundError('voice profile not found'))
      .mockResolvedValueOnce({ audio: new Uint8Array([1]), format: 'wav' });
    createProfile.mockResolvedValue({ providerReferenceId: 'ref-1' });
    const { synthesizeFacultyVoice } = await import('@/lib/voice-cloning/synthesis');

    const result = await synthesizeFacultyVoice({
      profileId: 'vcp_ready',
      text: 'Hello class',
      language: 'en-US',
    });

    expect(result).toMatchObject({ format: 'wav' });
    expect(referenceAudioExists).toHaveBeenCalledWith('/private/reference.wav');
    expect(createProfile).toHaveBeenCalledTimes(1);
    expect(createProfile).toHaveBeenCalledWith({
      profileId: 'vcp_ready',
      referenceAudioKey: '/private/reference.wav',
      language: 'hi',
      modelVariant: 'v3',
    });
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(synthesize).toHaveBeenNthCalledWith(1, {
      providerReferenceId: 'ref-1',
      text: 'Hello class',
      language: 'en',
      modelVariant: 'v3',
    });
    expect(synthesize).toHaveBeenNthCalledWith(2, {
      providerReferenceId: 'ref-1',
      text: 'Hello class',
      language: 'en',
      modelVariant: 'v3',
    });
  });

  it('does not re-register when the persisted private reference audio is missing', async () => {
    referenceAudioExists.mockResolvedValue(false);
    const { synthesizeFacultyVoice } = await import('@/lib/voice-cloning/synthesis');

    await expect(
      synthesizeFacultyVoice({
        profileId: 'vcp_ready',
        text: 'Hello class',
        language: 'en',
      }),
    ).rejects.toThrow('Voice profile reference audio not found');

    expect(createProfile).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });
});

describe('faculty voice model variants', () => {
  it('defaults new profiles to V3 and legacy persisted profiles to V2', () => {
    expect(DEFAULT_CHATTERBOX_MODEL_VARIANT).toBe('v3');
    expect(resolveVoiceProfileModelVariant({ modelVariant: undefined })).toBe('v2');
    expect(resolveVoiceProfileModelVariant({ modelVariant: 'v2' })).toBe('v2');
    expect(resolveVoiceProfileModelVariant({ modelVariant: 'v3' })).toBe('v3');
  });
});

describe('voice profile model preview API', () => {
  const createProfile = vi.fn();
  const generatePreview = vi.fn();
  const writeVoiceProfile = vi.fn();
  const readVoiceProfile = vi.fn();
  const referenceAudioExists = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    createProfile.mockReset();
    generatePreview.mockReset();
    writeVoiceProfile.mockReset();
    readVoiceProfile.mockReset();
    referenceAudioExists.mockReset();
    referenceAudioExists.mockResolvedValue(true);
    createProfile.mockImplementation(async ({ profileId }) => ({ providerReferenceId: profileId }));
    generatePreview.mockResolvedValue({ audio: new Uint8Array([1, 2]), format: 'wav' });
    writeVoiceProfile.mockResolvedValue(undefined);
    vi.doMock('@/lib/voice-cloning/config', () => ({
      FACULTY_VOICE_OWNER_ID: 'local-faculty',
      getVoiceCloningDefaultLanguage: () => 'en',
      getChatterboxDefaultModelVariant: () => 'v3',
      isVoiceCloningServerEnabled: () => true,
    }));
    vi.doMock('@/lib/voice-cloning/audio-validation', () => ({
      normalizeVoiceEnrollmentClips: vi.fn(async () => ({
        referenceAudio: new Uint8Array([9, 9]),
        durations: [3, 3, 3],
      })),
    }));
    vi.doMock('@/lib/voice-cloning/storage', () => ({
      createVoiceProfileId: () => 'vcp_new',
      deleteVoiceProfileAssets: vi.fn(),
      findCurrentVoiceProfile: vi.fn(async () => null),
      readVoiceProfile,
      referenceAudioExists,
      writeReferenceAudio: vi.fn(async () => '/private/reference.wav'),
      writeVoiceProfile,
    }));
    vi.doMock('@/lib/voice-cloning/provider', () => ({
      getVoiceCloningProvider: () => ({
        createProfile,
        generatePreview,
        deleteProfile: vi.fn(),
      }),
    }));
  });

  function readyProfile(modelVariant: 'v2' | 'v3' = 'v2'): VoiceProfile {
    return {
      id: 'vcp_ready',
      ownerId: 'local-faculty',
      displayName: 'Faculty Voice',
      provider: 'chatterbox',
      language: 'en',
      status: 'ready',
      modelVariant,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      consentTimestamp: '2026-08-11T00:00:00.000Z',
      consentVersion: 'faculty-self-voice-v1',
      referenceAudioKey: '/private/reference.wav',
      providerReferenceId: 'vcp_ready',
      profileVersion: 1,
      preview: { format: 'wav', base64: 'old', createdAt: '2026-08-11T00:00:00.000Z' },
    };
  }

  it('creates new faculty profiles with V3 by default', async () => {
    const { POST } = await import('@/app/api/voice-cloning/profile/route');
    const formData = new FormData();
    formData.set('consent', 'true');
    formData.set('clip0', new File([new Uint8Array([1])], 'clip0.webm', { type: 'audio/webm' }));
    formData.set('clip1', new File([new Uint8Array([1])], 'clip1.webm', { type: 'audio/webm' }));
    formData.set('clip2', new File([new Uint8Array([1])], 'clip2.webm', { type: 'audio/webm' }));

    const response = await POST(
      new Request('http://localhost/api/voice-cloning/profile', {
        method: 'POST',
        body: formData,
      }) as never,
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.profile.modelVariant).toBe('v3');
    expect(createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ modelVariant: 'v3', referenceAudioKey: '/private/reference.wav' }),
    );
    expect(generatePreview).toHaveBeenCalledWith(expect.objectContaining({ modelVariant: 'v3' }));
  });

  it('rejects unknown profile model variants clearly', async () => {
    const { POST } = await import('@/app/api/voice-cloning/profile/route');
    const formData = new FormData();
    formData.set('consent', 'true');
    formData.set('modelVariant', 'checkpoint-name');

    const response = await POST(
      new Request('http://localhost/api/voice-cloning/profile', {
        method: 'POST',
        body: formData,
      }) as never,
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toMatchObject({ success: false, errorCode: 'INVALID_REQUEST' });
    expect(createProfile).not.toHaveBeenCalled();
  });

  it('previews V2 and V3 from the same persisted reference without re-recording', async () => {
    readVoiceProfile.mockResolvedValue(readyProfile('v2'));
    const { PATCH } = await import('@/app/api/voice-cloning/profile/route');

    await PATCH(
      new Request('http://localhost/api/voice-cloning/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          profileId: 'vcp_ready',
          action: 'preview-model',
          modelVariant: 'v2',
        }),
      }) as never,
    );
    await PATCH(
      new Request('http://localhost/api/voice-cloning/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          profileId: 'vcp_ready',
          action: 'preview-model',
          modelVariant: 'v3',
        }),
      }) as never,
    );

    expect(referenceAudioExists).toHaveBeenCalledWith('/private/reference.wav');
    expect(createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ modelVariant: 'v2', referenceAudioKey: '/private/reference.wav' }),
    );
    expect(createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ modelVariant: 'v3', referenceAudioKey: '/private/reference.wav' }),
    );
  });

  it('persists selected model variant while preserving the reference audio', async () => {
    readVoiceProfile.mockResolvedValue({
      ...readyProfile('v2'),
      previewVariants: {
        v3: { format: 'wav', base64: 'new', createdAt: '2026-08-12T00:00:00.000Z' },
      },
    });
    const { PATCH } = await import('@/app/api/voice-cloning/profile/route');

    const response = await PATCH(
      new Request('http://localhost/api/voice-cloning/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          profileId: 'vcp_ready',
          action: 'accept-preview',
          modelVariant: 'v3',
        }),
      }) as never,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.profile.modelVariant).toBe('v3');
    expect(writeVoiceProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        modelVariant: 'v3',
        referenceAudioKey: '/private/reference.wav',
      }),
    );
  });
});

describe('Chatterbox provider model routing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/voice-cloning/config');
    vi.stubEnv('VOICE_CLONING_BASE_URL', 'http://voice.local');
    vi.stubEnv('VOICE_CLONING_TIMEOUT_MS', '1000');
  });

  it('sends explicit V2 and V3 model variants to the service', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).endsWith('/synthesize')) {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'audio/wav' },
        });
      }
      return new Response(JSON.stringify({ providerReferenceId: 'vcp_ready' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ChatterboxVoiceCloningProvider } =
      await import('@/lib/voice-cloning/providers/chatterbox');
    const provider = new ChatterboxVoiceCloningProvider();

    await provider.createProfile({
      profileId: 'vcp_ready',
      referenceAudioKey: '/private/reference.wav',
      language: 'en',
      modelVariant: 'v2',
    });
    await provider.synthesize({
      providerReferenceId: 'vcp_ready',
      text: 'Hello class',
      language: 'en',
      modelVariant: 'v3',
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      modelVariant: 'v2',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      modelVariant: 'v3',
    });
  });
});
