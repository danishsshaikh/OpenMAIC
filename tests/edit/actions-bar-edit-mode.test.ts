// @vitest-environment jsdom

import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionsBar } from '@/components/edit/ActionsBar/ActionsBar';
import { useSettingsStore } from '@/lib/store/settings';
import { useStageStore } from '@/lib/store/stage';
import type { Action } from '@/lib/types/action';
import { makeScene, type Scene, type Stage } from '@/lib/types/stage';
import { syncedNarrationMetadata, staleAudioMetadata } from '@/lib/audio/narration-sync';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/audio/regenerate-speech-tts', () => ({
  audioExists: vi.fn(async () => true),
  audioObjectUrl: vi.fn(async () => null),
  regenerateSpeechAudio: vi.fn(async (_sceneOrder: number, action: { id: string }) => action.id),
  resolveSpeechAudioId: vi.fn(
    (_sceneOrder: number, action: { id?: string; audioId?: string }) =>
      action.audioId || `tts_${action.id}`,
  ),
  speechAudioId: vi.fn((_sceneOrder: number, actionId: string) => `tts_${actionId}`),
}));

vi.mock('@/lib/hooks/use-scene-generator', () => ({
  fetchSceneActions: vi.fn(),
}));

const initialStageState = useStageStore.getState();
const initialSettingsState = useSettingsStore.getState();
let mounted: { root: Root; container: HTMLDivElement } | null = null;
let consoleError: ReturnType<typeof vi.spyOn>;

describe('ActionsBar edit-mode narration sync regressions', () => {
  beforeEach(() => {
    useStageStore.setState(initialStageState, true);
    useSettingsStore.setState(initialSettingsState, true);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setupStores(makeSyncedScene());
  });

  afterEach(() => {
    if (mounted) {
      act(() => mounted?.root.unmount());
      mounted.container.remove();
      mounted = null;
    }
    expectNoExternalStoreLoopErrors();
    consoleError.mockRestore();
    useStageStore.setState(initialStageState, true);
    useSettingsStore.setState(initialSettingsState, true);
  });

  it('toggles edit mode on and renders under StrictMode without getSnapshot loops', async () => {
    useStageStore.setState({ mode: 'playback' });

    mount(
      React.createElement(
        StrictMode,
        null,
        React.createElement(EditModeHarness, { sceneId: 'scene-1' }),
      ),
    );

    expect(hasText('edit.timeline.addAction')).toBe(false);

    act(() => {
      useStageStore.getState().setMode('edit');
    });

    await findText('edit.timeline.addAction');
    expect(hasText('edit.cue.speech')).toBe(true);
  });

  it('ignores unrelated settings updates without entering an external-store loop', async () => {
    mountActionsBar();
    await findText('edit.timeline.addAction');

    act(() => {
      useSettingsStore.setState({ chatAreaWidth: 444 });
    });

    await findText('edit.timeline.addAction');
  });

  it('updates audio fingerprint inputs when the stage language changes', async () => {
    mountActionsBar();
    await findText('edit.timeline.addAction');
    expect(hasText('edit.timeline.audioStale')).toBe(false);

    act(() => {
      useStageStore.setState((state) => ({
        stage: state.stage ? { ...state.stage, languageDirective: 'Spanish' } : state.stage,
      }));
    });

    await findText('edit.timeline.audioStale');
    expect(hasLabel('edit.timeline.regenSlideAudio')).toBe(true);
    expect(hasLabel('edit.timeline.syncAllStale')).toBe(true);
  });

  it('updates audio fingerprint inputs when provider model and speed change', async () => {
    mountActionsBar();
    await findText('edit.timeline.addAction');
    expect(hasText('edit.timeline.audioStale')).toBe(false);

    act(() => {
      useSettingsStore.setState((state) => ({
        ttsSpeed: 1.25,
        ttsProvidersConfig: {
          ...state.ttsProvidersConfig,
          'openai-tts': {
            ...state.ttsProvidersConfig['openai-tts'],
            modelId: 'tts-model-b',
          },
        },
      }));
    });

    await findText('edit.timeline.audioStale');
    await findText('edit.tts.statusReady');
    expect(hasLabel('edit.tts.regenerate')).toBe(true);
  });

  it('renders stale narration and audio controls', async () => {
    setupStores(makeAudioStaleScene());

    mountActionsBar();

    await findText('edit.timeline.audioStale');
    expect(hasText('edit.timeline.regenAudio')).toBe(true);
    expect(hasText('edit.timeline.syncAll')).toBe(true);
  });
});

function mountActionsBar() {
  mount(
    React.createElement(StrictMode, null, React.createElement(ActionsBar, { sceneId: 'scene-1' })),
  );
}

function mount(node: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  mounted = { root, container };
}

function EditModeHarness({ sceneId }: { sceneId: string }) {
  const mode = useStageStore((state) => state.mode);
  return mode === 'edit' ? React.createElement(ActionsBar, { sceneId }) : null;
}

function setupStores(scene: Scene) {
  useStageStore.setState({
    stage: {
      id: 'stage-1',
      name: 'Stage',
      description: 'Stage',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      languageDirective: 'English',
    } satisfies Stage,
    scenes: [scene],
    currentSceneId: scene.id,
    mode: 'edit',
    outlines: [
      {
        id: 'outline-1',
        title: 'Scene',
        description: 'Scene',
        keyPoints: ['Scene'],
        order: 1,
        type: 'slide',
      },
    ],
  });
  useSettingsStore.setState((state) => ({
    ttsEnabled: true,
    ttsProviderId: 'openai-tts',
    ttsVoice: 'alloy',
    ttsSpeed: 1,
    selectedAgentIds: [],
    ttsProvidersConfig: {
      ...state.ttsProvidersConfig,
      'openai-tts': {
        ...state.ttsProvidersConfig['openai-tts'],
        modelId: 'tts-model-a',
      },
    },
  }));
}

function makeSyncedScene(): Scene {
  const scene = sceneFixture();
  return {
    ...scene,
    sync: syncedNarrationMetadata(scene, {
      language: 'English',
      ttsEnabled: true,
      ttsProviderId: 'openai-tts',
      ttsVoice: 'alloy',
      ttsSpeed: 1,
      ttsModelId: 'tts-model-a',
    }),
  };
}

function makeAudioStaleScene(): Scene {
  const scene = sceneFixture();
  return {
    ...scene,
    sync: staleAudioMetadata(scene, {
      language: 'English',
      ttsEnabled: true,
      ttsProviderId: 'openai-tts',
      ttsVoice: 'alloy',
      ttsSpeed: 1,
      ttsModelId: 'tts-model-a',
    }),
  };
}

function sceneFixture(): Scene {
  return makeScene(
    {
      id: 'scene-1',
      stageId: 'stage-1',
      title: 'Scene',
      order: 1,
      outlineId: 'outline-1',
      actions: [speech('speech-1', 'Explain shared memory', 'tts_speech_1')],
    },
    {
      type: 'slide',
      canvas: {
        id: 'slide-canvas',
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme: {
          backgroundColor: '#ffffff',
          themeColors: ['#5b9bd5'],
          fontColor: '#111111',
          fontName: 'Arial',
        },
        elements: [
          {
            id: 'text-1',
            type: 'text',
            left: 80,
            top: 80,
            width: 300,
            height: 80,
            rotate: 0,
            content: '<p>Shared memory</p>',
            defaultFontName: 'Arial',
            defaultColor: '#111111',
          },
        ],
      },
    },
  );
}

function speech(id: string, text: string, audioId: string): Action {
  return { id, type: 'speech', text, audioId } as Action;
}

function expectNoExternalStoreLoopErrors() {
  const messages = consoleError.mock.calls.map((call: unknown[]) => call.map(String).join(' '));
  expect(messages.some((message: string) => message.includes('getSnapshot should be cached'))).toBe(
    false,
  );
  expect(
    messages.some((message: string) => message.includes('Maximum update depth exceeded')),
  ).toBe(false);
  expect(messages.some((message: string) => message.includes('infinite loop'))).toBe(false);
}

function hasText(text: string): boolean {
  return mounted?.container.textContent?.includes(text) ?? false;
}

function hasLabel(label: string): boolean {
  return !!mounted?.container.querySelector(`[aria-label="${cssEscape(label)}"]`);
}

async function findText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (hasText(text)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error(`Unable to find text: ${text}`);
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
