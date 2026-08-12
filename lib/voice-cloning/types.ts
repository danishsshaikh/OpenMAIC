export type VoiceProfileStatus = 'processing' | 'preview-ready' | 'ready' | 'failed' | 'deleted';
export type ChatterboxModelVariant = 'v2' | 'v3';

export const CHATTERBOX_MODEL_VARIANTS = ['v2', 'v3'] as const;
export const DEFAULT_CHATTERBOX_MODEL_VARIANT: ChatterboxModelVariant = 'v3';
export const LEGACY_CHATTERBOX_MODEL_VARIANT: ChatterboxModelVariant = 'v2';

export interface VoicePreview {
  format: string;
  base64: string;
  createdAt: string;
}

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
  modelVariant?: ChatterboxModelVariant;
  profileVersion: number;
  preview?: VoicePreview;
  previewVariants?: Partial<Record<ChatterboxModelVariant, VoicePreview>>;
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
  modelVariant: ChatterboxModelVariant;
  profileVersion: number;
  preview?: VoicePreview;
  previewVariants?: Partial<Record<ChatterboxModelVariant, VoicePreview>>;
}

export interface VoiceCloningProvider {
  healthCheck(): Promise<{ ok: boolean; provider: string; modelLoaded?: boolean }>;
  createProfile(input: {
    profileId: string;
    referenceAudioKey: string;
    language: string;
    modelVariant: ChatterboxModelVariant;
  }): Promise<{
    providerReferenceId: string;
  }>;
  generatePreview(input: {
    providerReferenceId: string;
    text: string;
    language: string;
    modelVariant: ChatterboxModelVariant;
  }): Promise<{ audio: Uint8Array; format: string }>;
  synthesize(input: {
    providerReferenceId: string;
    text: string;
    language: string;
    modelVariant: ChatterboxModelVariant;
  }): Promise<{ audio: Uint8Array; format: string }>;
  deleteProfile(input: { providerReferenceId: string }): Promise<void>;
}

export function isChatterboxModelVariant(value: unknown): value is ChatterboxModelVariant {
  return value === 'v2' || value === 'v3';
}

export function resolveVoiceProfileModelVariant(profile: {
  modelVariant?: string | null;
}): ChatterboxModelVariant {
  return isChatterboxModelVariant(profile.modelVariant)
    ? profile.modelVariant
    : LEGACY_CHATTERBOX_MODEL_VARIANT;
}

export function resolveNewVoiceProfileModelVariant(value: unknown): ChatterboxModelVariant | null {
  if (value === undefined || value === null || value === '')
    return DEFAULT_CHATTERBOX_MODEL_VARIANT;
  return isChatterboxModelVariant(value) ? value : null;
}

export class VoiceProviderProfileNotFoundError extends Error {
  readonly providerReferenceId?: string;

  constructor(message: string, options: { providerReferenceId?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'VoiceProviderProfileNotFoundError';
    this.providerReferenceId = options.providerReferenceId;
  }
}

export function isVoiceProviderProfileNotFoundError(
  error: unknown,
): error is VoiceProviderProfileNotFoundError {
  return (
    error instanceof VoiceProviderProfileNotFoundError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'VoiceProviderProfileNotFoundError')
  );
}

export function toPublicVoiceProfile(profile: VoiceProfile | null): PublicVoiceProfile | null {
  if (!profile || profile.status === 'deleted') return null;
  return {
    id: profile.id,
    displayName: profile.displayName,
    provider: profile.provider,
    language: profile.language,
    status: profile.status,
    modelVariant: resolveVoiceProfileModelVariant(profile),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    consentTimestamp: profile.consentTimestamp,
    consentVersion: profile.consentVersion,
    profileVersion: profile.profileVersion,
    ...(profile.preview ? { preview: profile.preview } : {}),
    ...(profile.previewVariants ? { previewVariants: profile.previewVariants } : {}),
  };
}
