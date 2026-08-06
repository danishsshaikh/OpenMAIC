import { afterEach, describe, expect, it, vi } from 'vitest';

const FLAG_KEYS = [
  'NEXT_PUBLIC_FEATURE_INTERACTIVE_SCENES',
  'NEXT_PUBLIC_FEATURE_DETERMINISTIC_INTERACTIVES',
  'NEXT_PUBLIC_FEATURE_WORKSPACE_SCENES',
  'NEXT_PUBLIC_FEATURE_FLOW_SCENES',
] as const;

const originalEnv = new Map<string, string | undefined>(
  FLAG_KEYS.map((key) => [key, process.env[key]]),
);

async function loadOptions() {
  vi.resetModules();
  return import('@/lib/generation/scene-type-options');
}

function resetFlagEnv() {
  for (const key of FLAG_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

afterEach(() => {
  resetFlagEnv();
  vi.resetModules();
});

describe('getGenerationSceneTypeOptions', () => {
  it('shows simulation-backed interactive scenes with deterministic interactives enabled by default', async () => {
    const { getGenerationSceneTypeOptions } = await loadOptions();

    expect(getGenerationSceneTypeOptions()).toEqual(['slide', 'quiz', 'interactive']);
  });

  it('hides simulation when both deterministic and broad interactives are disabled', async () => {
    process.env.NEXT_PUBLIC_FEATURE_DETERMINISTIC_INTERACTIVES = 'false';
    const { getGenerationSceneTypeOptions } = await loadOptions();

    expect(getGenerationSceneTypeOptions()).toEqual(['slide', 'quiz']);
  });

  it('does not expose workspace or flow-scene options unless their own gates are enabled', async () => {
    process.env.NEXT_PUBLIC_FEATURE_INTERACTIVE_SCENES = 'true';
    process.env.NEXT_PUBLIC_FEATURE_FLOW_SCENES = 'true';
    let options = await loadOptions();

    expect(options.getGenerationSceneTypeOptions()).toEqual(['slide', 'quiz', 'interactive']);

    process.env.NEXT_PUBLIC_FEATURE_WORKSPACE_SCENES = 'true';
    options = await loadOptions();
    expect(options.getGenerationSceneTypeOptions()).toEqual([
      'slide',
      'quiz',
      'interactive',
      'pbl',
    ]);
  });
});
