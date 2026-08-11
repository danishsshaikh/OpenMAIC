import { getVoiceCloningProviderId } from '@/lib/voice-cloning/config';
import type { VoiceCloningProvider } from '@/lib/voice-cloning/types';
import { ChatterboxVoiceCloningProvider } from '@/lib/voice-cloning/providers/chatterbox';

export function getVoiceCloningProvider(): VoiceCloningProvider {
  const provider = getVoiceCloningProviderId();
  if (provider === 'chatterbox') return new ChatterboxVoiceCloningProvider();
  throw new Error(`Unsupported voice cloning provider: ${provider}`);
}
