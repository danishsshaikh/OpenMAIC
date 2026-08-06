import { isSceneTypeEnabled } from '@/lib/config/feature-flags';
import type { SceneOutline } from '@/lib/types/generation';

export type GenerationSceneType = SceneOutline['type'];

export function getGenerationSceneTypeOptions(): GenerationSceneType[] {
  const options: GenerationSceneType[] = ['slide', 'quiz'];
  if (isSceneTypeEnabled('interactive')) options.push('interactive');
  if (isSceneTypeEnabled('pbl')) options.push('pbl');
  return options;
}
