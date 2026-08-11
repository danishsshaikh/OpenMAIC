import { getVoiceCloningBaseUrl, getVoiceCloningTimeoutMs } from '@/lib/voice-cloning/config';
import {
  VoiceProviderProfileNotFoundError,
  type VoiceCloningProvider,
} from '@/lib/voice-cloning/types';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getVoiceCloningTimeoutMs());
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(
        `Voice cloning service error ${response.status}: ${detail || response.statusText}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAudio(
  url: string,
  init: RequestInit,
  options: { providerReferenceId?: string } = {},
): Promise<{ audio: Uint8Array; format: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getVoiceCloningTimeoutMs());
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      if (response.status === 404 && detail.toLowerCase().includes('voice profile not found')) {
        throw new VoiceProviderProfileNotFoundError(
          `Voice cloning provider profile not found: ${options.providerReferenceId ?? 'unknown'}`,
          { providerReferenceId: options.providerReferenceId },
        );
      }
      throw new Error(
        `Voice cloning service error ${response.status}: ${detail || response.statusText}`,
      );
    }
    const contentType = response.headers.get('content-type') || '';
    const format = contentType.includes('wav')
      ? 'wav'
      : contentType.includes('mpeg')
        ? 'mp3'
        : 'wav';
    return { audio: new Uint8Array(await response.arrayBuffer()), format };
  } finally {
    clearTimeout(timeout);
  }
}

export class ChatterboxVoiceCloningProvider implements VoiceCloningProvider {
  private baseUrl(): string {
    const baseUrl = getVoiceCloningBaseUrl();
    if (!baseUrl) throw new Error('VOICE_CLONING_BASE_URL is required for Chatterbox');
    return baseUrl;
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; modelLoaded?: boolean }> {
    return fetchJson<{ ok: boolean; provider: string; modelLoaded?: boolean }>(
      `${this.baseUrl()}/health`,
    );
  }

  async createProfile(input: {
    profileId: string;
    referenceAudioKey: string;
    language: string;
  }): Promise<{ providerReferenceId: string }> {
    const result = await fetchJson<{ providerReferenceId?: string }>(`${this.baseUrl()}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        profileId: input.profileId,
        referenceAudioPath: input.referenceAudioKey,
        language: input.language,
      }),
    });
    return { providerReferenceId: result.providerReferenceId || input.profileId };
  }

  async generatePreview(input: {
    providerReferenceId: string;
    text: string;
    language: string;
  }): Promise<{ audio: Uint8Array; format: string }> {
    return this.synthesize(input);
  }

  async synthesize(input: {
    providerReferenceId: string;
    text: string;
    language: string;
  }): Promise<{ audio: Uint8Array; format: string }> {
    return fetchAudio(
      `${this.baseUrl()}/synthesize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          profileId: input.providerReferenceId,
          text: input.text,
          language: input.language,
        }),
      },
      { providerReferenceId: input.providerReferenceId },
    );
  }

  async deleteProfile(input: { providerReferenceId: string }): Promise<void> {
    await fetchJson<{ ok: boolean }>(
      `${this.baseUrl()}/profiles/${encodeURIComponent(input.providerReferenceId)}`,
      { method: 'DELETE' },
    );
  }
}
