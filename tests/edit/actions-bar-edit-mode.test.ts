// @vitest-environment jsdom

import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionsBar } from '@/components/edit/ActionsBar/ActionsBar';
import { useSettingsStore } from '@/lib/store/settings';
import { useStageStore } from '@/lib/store/stage';
import type { Action } from '@/lib/types/action';
import { makeScene, type Scene, type Stage } from '@/lib/types/stage';
import {
  buildNarrationSourceFromScene,
  getAudioSourceFingerprint,
  getNarrationSyncState,
  syncedNarrationMetadata,
  staleAudioMetadata,
} from '@/lib/audio/narration-sync';

const OLD_NARRATION =
  'Our core principles revolve around maximizing throughput. By intelligently breaking down complex computations into independent units of work, we can drastically reduce the time required to solve large-scale problems.';
const NEW_NARRATION = 'The revised core principle shown on this slide is minimizing efficiency.';
const TTS_SETTINGS = {
  language: 'English',
  ttsEnabled: true,
  ttsProviderId: 'openai-tts',
  ttsVoice: 'alloy',
  ttsSpeed: 1,
  ttsModelId: 'tts-model-a',
};

const mocks = vi.hoisted(() => ({
  audioExists: vi.fn(async () => true),
  audioObjectUrl: vi.fn(async () => null),
  fetchSceneActions: vi.fn(),
  regenerateSpeechAudio: vi.fn(async (_sceneOrder: number, action: { id: string }) => action.id),
  resolveSpeechAudioId: vi.fn(
    (_sceneOrder: number, action: { id?: string; audioId?: string }) =>
      action.audioId || `tts_${action.id}`,
  ),
  speechAudioId: vi.fn((_sceneOrder: number, actionId: string) => `tts_${actionId}`),
}));

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/audio/regenerate-speech-tts', () => ({
  audioExists: mocks.audioExists,
  audioObjectUrl: mocks.audioObjectUrl,
  regenerateSpeechAudio: mocks.regenerateSpeechAudio,
  resolveSpeechAudioId: mocks.resolveSpeechAudioId,
  speechAudioId: mocks.speechAudioId,
}));

vi.mock('@/lib/hooks/use-scene-generator', () => ({
  fetchSceneActions: mocks.fetchSceneActions,
}));

const initialStageState = useStageStore.getState();
const initialSettingsState = useSettingsStore.getState();
let mounted: { root: Root; container: HTMLDivElement } | null = null;
let consoleError: ReturnType<typeof vi.spyOn>;

describe('ActionsBar edit-mode narration sync regressions', () => {
  beforeEach(() => {
    useStageStore.setState(initialStageState, true);
    useSettingsStore.setState(initialSettingsState, true);
    mocks.audioExists.mockResolvedValue(true);
    mocks.audioObjectUrl.mockResolvedValue(null);
    mocks.fetchSceneActions.mockReset();
    mocks.regenerateSpeechAudio.mockReset();
    mocks.regenerateSpeechAudio.mockImplementation(
      async (_sceneOrder: number, action: { id: string }) => action.id,
    );
    mocks.resolveSpeechAudioId.mockClear();
    mocks.speechAudioId.mockClear();
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

  it('syncs stale narration from the latest edited slide content and passes returned narration to TTS', async () => {
    const scene = makeManualEditedStaleScene();
    const generated = { ...scene, actions: [speech('speech-1', NEW_NARRATION, '')] };
    const generation = deferredPromise<unknown>();
    mocks.fetchSceneActions.mockReturnValueOnce(generation.promise);
    setupStores(scene);

    mountActionsBar();
    await findText('edit.timeline.narrationStale');

    await act(async () => {
      requiredButton('edit.timeline.syncNarrationAudio').click();
      requiredButton('edit.timeline.syncNarrationAudio').click();
      await Promise.resolve();
    });

    expect(mocks.fetchSceneActions).toHaveBeenCalledTimes(1);
    expect(getScene('scene-1').sync?.status).toBe('syncing');

    const request = mocks.fetchSceneActions.mock.calls[0][0] as {
      content: unknown;
      previousSpeeches?: string[];
    };
    const requestSource = JSON.stringify(request.content);
    expect(requestSource).toContain('Minimizing Efficiency');
    expect(requestSource).not.toContain('Maximizing Efficiency');
    expect(requestSource).not.toContain('Better Resource Utilization');
    expect(requestSource).not.toContain('Faster Execution');
    expect(requestSource).not.toContain(OLD_NARRATION);
    expect(request.previousSpeeches).toEqual([]);
    expect(mocks.regenerateSpeechAudio).not.toHaveBeenCalled();

    await act(async () => {
      generation.resolve({ success: true, scene: generated });
      await generation.promise;
    });
    await waitForCondition(() => mocks.regenerateSpeechAudio.mock.calls.length === 1);

    expect(mocks.regenerateSpeechAudio).toHaveBeenCalledTimes(1);
    expect(mocks.regenerateSpeechAudio.mock.calls[0][1]).toMatchObject({
      id: 'speech-1',
      text: NEW_NARRATION,
    });
    expect(mocks.regenerateSpeechAudio.mock.calls[0][1]).not.toMatchObject({
      text: OLD_NARRATION,
    });

    const updated = getScene('scene-1');
    expect(updated.actions).toEqual([
      expect.objectContaining({
        id: 'speech-1',
        text: NEW_NARRATION,
        audioId: 'tts_speech-1',
      }),
    ]);
    expect(updated.sync?.narrationSourceFingerprint).toBe(
      buildNarrationSourceFromScene(updated).fingerprint,
    );
    expect(updated.sync?.audioSourceFingerprint).toBe(
      getAudioSourceFingerprint(updated, TTS_SETTINGS),
    );
    expect(getNarrationSyncState(updated, TTS_SETTINGS).status).toBe('synced');
  });

  it('regenerates audio from current narration without calling narration generation', async () => {
    setupStores(makeAudioStaleScene());

    mountActionsBar();
    await findText('edit.timeline.audioStale');

    await act(async () => {
      requiredButton('edit.timeline.regenSlideAudio').click();
      await Promise.resolve();
    });
    await waitForCondition(() => mocks.regenerateSpeechAudio.mock.calls.length === 1);

    expect(mocks.fetchSceneActions).not.toHaveBeenCalled();
    expect(mocks.regenerateSpeechAudio.mock.calls[0][1]).toMatchObject({
      id: 'speech-1',
      text: 'Explain shared memory',
    });
    expect(getNarrationSyncState(getScene('scene-1'), TTS_SETTINGS).status).toBe('synced');
  });

  it('keeps narration stale when generation returns the exact old narration for changed slide content', async () => {
    const scene = makeManualEditedStaleScene();
    mocks.fetchSceneActions.mockResolvedValue({
      success: true,
      scene: { ...scene, actions: [speech('speech-1', OLD_NARRATION, '')] },
    });
    setupStores(scene);

    mountActionsBar();
    await findText('edit.timeline.narrationStale');

    await act(async () => {
      requiredButton('edit.timeline.syncNarrationAudio').click();
      await Promise.resolve();
    });
    await waitForCondition(() =>
      Boolean(getScene('scene-1').sync?.error?.includes('unchanged narration')),
    );

    const unchanged = getScene('scene-1');
    expect(mocks.fetchSceneActions).toHaveBeenCalledTimes(1);
    expect(mocks.regenerateSpeechAudio).not.toHaveBeenCalled();
    expect(unchanged.actions).toEqual([
      expect.objectContaining({
        id: 'speech-1',
        text: OLD_NARRATION,
        audioId: 'tts_speech_1',
      }),
    ]);
    expect(unchanged.sync?.error).toContain('unchanged narration');
    expect(getNarrationSyncState(unchanged, TTS_SETTINGS).status).toBe('narration-stale');
  });

  it('uses local editor slide content before a remote save can replace the persisted scene', async () => {
    const persisted = makeManualInitialScene();
    const localEdit = makeManualEditedStaleScene();
    expect(buildNarrationSourceFromScene(persisted).text).toContain('Maximizing Efficiency');
    mocks.fetchSceneActions.mockResolvedValue({
      success: true,
      scene: { ...localEdit, actions: [speech('speech-1', NEW_NARRATION, '')] },
    });
    setupStores(localEdit);

    mountActionsBar();
    await findText('edit.timeline.narrationStale');

    await act(async () => {
      requiredButton('edit.timeline.syncNarrationAudio').click();
      await Promise.resolve();
    });
    await waitForCondition(() => mocks.fetchSceneActions.mock.calls.length === 1);

    const requestSource = JSON.stringify(mocks.fetchSceneActions.mock.calls[0][0].content);
    expect(requestSource).toContain('Minimizing Efficiency');
    expect(requestSource).not.toContain('Maximizing Efficiency');
  });

  it('resolves each bulk stale scene by id when its queued turn starts', async () => {
    const sceneOne = makeManualEditedStaleScene({
      id: 'scene-1',
      order: 1,
      outlineId: 'outline-1',
    });
    const sceneTwo = makeManualEditedStaleScene({
      id: 'scene-2',
      order: 2,
      outlineId: 'outline-2',
      points: ['Queued First Edit'],
      speechId: 'speech-2',
      audioId: 'tts_speech_2',
    });
    const firstGeneration = deferredPromise<unknown>();
    mocks.fetchSceneActions.mockImplementation((request: { content: unknown }) => {
      const source = JSON.stringify(request.content);
      if (source.includes('Minimizing Efficiency')) return firstGeneration.promise;
      if (source.includes('Newest Queue Claim')) {
        return Promise.resolve({
          success: true,
          scene: { ...getScene('scene-2'), actions: [speech('speech-2', 'Newest narration', '')] },
        });
      }
      return Promise.resolve({
        success: true,
        scene: { ...getScene('scene-2'), actions: [speech('speech-2', 'Stale narration', '')] },
      });
    });
    setupStores(sceneOne, [sceneOne, sceneTwo]);

    mountActionsBar();
    await findText('edit.timeline.narrationStale');

    await act(async () => {
      requiredButton('edit.timeline.syncAllStale').click();
      await Promise.resolve();
    });
    await waitForCondition(() => mocks.fetchSceneActions.mock.calls.length === 1);

    act(() => {
      replaceScene(
        makeManualEditedStaleScene({
          id: 'scene-2',
          order: 2,
          outlineId: 'outline-2',
          points: ['Newest Queue Claim'],
          speechId: 'speech-2',
          audioId: 'tts_speech_2',
          sync: getScene('scene-2').sync,
        }),
      );
    });

    await act(async () => {
      firstGeneration.resolve({
        success: true,
        scene: { ...getScene('scene-1'), actions: [speech('speech-1', NEW_NARRATION, '')] },
      });
      await firstGeneration.promise;
    });
    await waitForCondition(() => mocks.fetchSceneActions.mock.calls.length === 2);

    const secondRequestSource = JSON.stringify(mocks.fetchSceneActions.mock.calls[1][0].content);
    expect(secondRequestSource).toContain('Newest Queue Claim');
    expect(secondRequestSource).not.toContain('Queued First Edit');
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

function setupStores(scene: Scene, scenes: Scene[] = [scene]) {
  useStageStore.setState({
    stage: {
      id: 'stage-1',
      name: 'Stage',
      description: 'Stage',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      languageDirective: 'English',
    } satisfies Stage,
    scenes,
    currentSceneId: scene.id,
    mode: 'edit',
    outlines: scenes.map((item) => ({
      id: item.outlineId ?? `outline-${item.order}`,
      title: item.title,
      description: item.title,
      keyPoints: [item.title],
      order: item.order,
      type: 'slide',
    })),
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
    sync: syncedNarrationMetadata(scene, TTS_SETTINGS),
  };
}

function makeAudioStaleScene(): Scene {
  const scene = sceneFixture();
  return {
    ...scene,
    sync: staleAudioMetadata(scene, TTS_SETTINGS),
  };
}

function makeManualInitialScene(
  options: {
    id?: string;
    order?: number;
    outlineId?: string;
    points?: string[];
    speechId?: string;
    audioId?: string;
  } = {},
): Scene {
  return parallelModelsScene({
    ...options,
    points: options.points ?? [
      'Maximizing Efficiency',
      'Better Resource Utilization',
      'Faster Execution',
    ],
  });
}

function makeManualEditedStaleScene(
  options: {
    id?: string;
    order?: number;
    outlineId?: string;
    points?: string[];
    speechId?: string;
    audioId?: string;
    sync?: Scene['sync'];
  } = {},
): Scene {
  const initial = makeManualInitialScene({
    id: options.id,
    order: options.order,
    outlineId: options.outlineId,
    speechId: options.speechId,
    audioId: options.audioId,
  });
  const edited = parallelModelsScene({
    ...options,
    points: options.points ?? ['Minimizing Efficiency'],
  });
  return {
    ...edited,
    sync: options.sync ?? syncedNarrationMetadata(initial, TTS_SETTINGS),
  };
}

function parallelModelsScene(options: {
  id?: string;
  order?: number;
  outlineId?: string;
  points: string[];
  speechId?: string;
  audioId?: string;
}): Scene {
  const id = options.id ?? 'scene-1';
  const order = options.order ?? 1;
  const speechId = options.speechId ?? 'speech-1';
  return makeScene(
    {
      id,
      stageId: 'stage-1',
      title: 'Introduction to Parallel Models',
      order,
      outlineId: options.outlineId ?? `outline-${order}`,
      actions: [speech(speechId, OLD_NARRATION, options.audioId ?? 'tts_speech_1')],
    },
    {
      type: 'slide',
      canvas: {
        id: `${id}-canvas`,
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
            id: `${id}-title`,
            type: 'text',
            left: 80,
            top: 48,
            width: 700,
            height: 80,
            rotate: 0,
            content: '<h1>Introduction to Parallel Models</h1>',
            defaultFontName: 'Arial',
            defaultColor: '#111111',
          },
          {
            id: `${id}-principles`,
            type: 'text',
            left: 96,
            top: 160,
            width: 640,
            height: 220,
            rotate: 0,
            content: `<h2>Core Principles</h2><ul>${options.points
              .map((point) => `<li>${point}</li>`)
              .join('')}</ul>`,
            defaultFontName: 'Arial',
            defaultColor: '#111111',
          },
        ],
      },
    },
  );
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

function requiredButton(label: string): HTMLButtonElement {
  const button = mounted?.container.querySelector(
    `[aria-label="${cssEscape(label)}"]`,
  ) as HTMLButtonElement | null;
  if (!button) throw new Error(`Unable to find button: ${label}`);
  return button;
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error('Timed out waiting for condition');
}

function getScene(sceneId: string): Scene {
  const scene = useStageStore.getState().scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`Missing scene: ${sceneId}`);
  return scene;
}

function replaceScene(scene: Scene): void {
  useStageStore.setState((state) => ({
    scenes: state.scenes.map((item) => (item.id === scene.id ? scene : item)),
  }));
}

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
