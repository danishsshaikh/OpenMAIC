export type VoiceProfileStatus = 'processing' | 'preview-ready' | 'ready' | 'failed' | 'deleted';

export interface VoiceProfile {
  id: string;
  ownerId: string;
  displayName: string;
  provider: string;
  language: string;
  status: VoiceProfileStatus;
  createdAt: string;
  updatedAt: string;
  consentTimestamp: string;
  consentVersion: string;
  referenceAudioKey?: string;
  providerReferenceId?: string;
  profileVersion: number;
  preview?: {
    format: string;
    base64: string;
    createdAt: string;
  };
  failureReason?: string;
}

export interface PublicVoiceProfile {
  id: string;
  displayName: string;
  provider: string;
  language: string;
  status: VoiceProfileStatus;
  createdAt: string;
  updatedAt: string;
  consentTimestamp: string;
  consentVersion: string;
  profileVersion: number;
  preview?: {
    format: string;
    base64: string;
    createdAt: string;
  };
}

export interface VoiceCloningProvider {
  healthCheck(): Promise<{ ok: boolean; provider: string; modelLoaded?: boolean }>;
  createProfile(input: {
    profileId: string;
    referenceAudioKey: string;
    language: string;
  }): Promise<{
    providerReferenceId: string;
  }>;
  generatePreview(input: {
    providerReferenceId: string;
    text: string;
    language: string;
  }): Promise<{ audio: Uint8Array; format: string }>;
  synthesize(input: {
    providerReferenceId: string;
    text: string;
    language: string;
  }): Promise<{ audio: Uint8Array; format: string }>;
  deleteProfile(input: { providerReferenceId: string }): Promise<void>;
}

export function toPublicVoiceProfile(profile: VoiceProfile | null): PublicVoiceProfile | null {
  if (!profile || profile.status === 'deleted') return null;
  return {
    id: profile.id,
    displayName: profile.displayName,
    provider: profile.provider,
    language: profile.language,
    status: profile.status,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    consentTimestamp: profile.consentTimestamp,
    consentVersion: profile.consentVersion,
    profileVersion: profile.profileVersion,
    ...(profile.preview ? { preview: profile.preview } : {}),
  };
}
