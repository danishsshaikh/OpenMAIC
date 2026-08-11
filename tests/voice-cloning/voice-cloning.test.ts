import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFeatureFlagBoolean } from '@/lib/config/feature-flags';
import {
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
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      consentTimestamp: '2026-08-11T00:00:00.000Z',
      consentVersion: 'faculty-self-voice-v1',
      profileVersion: 1,
    });
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
    });
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(synthesize).toHaveBeenNthCalledWith(1, {
      providerReferenceId: 'ref-1',
      text: 'Hello class',
      language: 'en',
    });
    expect(synthesize).toHaveBeenNthCalledWith(2, {
      providerReferenceId: 'ref-1',
      text: 'Hello class',
      language: 'en',
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
