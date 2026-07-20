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
let consoleInfo: ReturnType<typeof vi.spyOn>;

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
    consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
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
    consoleInfo.mockRestore();
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
      content: { narrationSource?: { text?: string } };
      previousSpeeches?: string[];
    };
    const requestSource = JSON.stringify(request.content);
    const narrationSourceText = request.content.narrationSource?.text ?? '';
    expect(narrationSourceText).toContain('Minimizing Efficiency');
    expect(narrationSourceText).not.toContain('Maximizing Efficiency');
    expect(narrationSourceText).not.toContain('Better Resource Utilization');
    expect(narrationSourceText).not.toContain('Faster Execution');
    expect(narrationSourceText).not.toContain(OLD_NARRATION);
    expect(narrationSourceText).not.toContain('text-');
    expect(narrationSourceText).not.toContain('width');
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
    const updatedActions = updated.actions ?? [];
    expect(updatedActions).toEqual([
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

    const requestContent = mocks.fetchSceneActions.mock.calls[0][0].content as {
      narrationSource?: { text?: string };
    };
    const narrationSourceText = requestContent.narrationSource?.text ?? '';
    expect(narrationSourceText).toContain('Minimizing Efficiency');
    expect(narrationSourceText).not.toContain('Maximizing Efficiency');
  });

  it('syncs swapped visual cards in spotlight target order without reordering elements', async () => {
    const scene = makeSwappedParallelismScene();
    mocks.fetchSceneActions.mockResolvedValue({
      success: true,
      scene: {
        ...scene,
        actions: [
          { id: 'new-spot-task', type: 'spotlight', elementId: 'task-card' },
          speech(
            'new-speech-task',
            'First, let us look at Task Parallelism and how independent tasks are scheduled.',
            '',
          ),
          { id: 'new-spot-data', type: 'spotlight', elementId: 'data-card' },
          speech(
            'new-speech-data',
            'Next, Data Parallelism applies the same operation across multiple data items.',
            '',
          ),
        ],
      },
    });
    setupStores(scene);

    expect(buildNarrationSourceFromScene(scene).visualBlocks.map((block) => block.text)).toEqual([
      'Task Parallelism',
      'Data Parallelism',
    ]);
    expect(getNarrationSyncState(scene, TTS_SETTINGS).status).toBe('narration-stale');

    mountActionsBar();
    await findText('edit.timeline.narrationStale');

    await act(async () => {
      requiredButton('edit.timeline.syncNarrationAudio').click();
      await Promise.resolve();
    });
    await waitForCondition(() => mocks.regenerateSpeechAudio.mock.calls.length === 2);

    const requestContent = mocks.fetchSceneActions.mock.calls[0][0].content as {
      narrationSource?: {
        text?: string;
        blocks?: Array<{ targetElementId: string; text: string }>;
      };
      choreography?: Array<{ targetElementId: string; targetText: string }>;
      elements?: Array<{ id: string }>;
    };
    expect(requestContent.narrationSource?.text).toMatch(/Task Parallelism[\s\S]*Data Parallelism/);
    expect(requestContent.narrationSource?.blocks?.[0]).toMatchObject({
      targetElementId: 'task-card',
      text: 'Task Parallelism',
    });
    expect(requestContent.narrationSource?.blocks?.[1]).toMatchObject({
      targetElementId: 'data-card',
      text: 'Data Parallelism',
    });
    expect(requestContent.choreography?.[0]).toMatchObject({
      targetElementId: 'task-card',
      targetText: 'Task Parallelism',
    });
    expect(requestContent.choreography?.[1]).toMatchObject({
      targetElementId: 'data-card',
      targetText: 'Data Parallelism',
    });

    expect(mocks.regenerateSpeechAudio.mock.calls[0][1]).toMatchObject({
      id: 'speech-task',
      text: 'First, let us look at Task Parallelism and how independent tasks are scheduled.',
    });
    expect(mocks.regenerateSpeechAudio.mock.calls[1][1]).toMatchObject({
      id: 'speech-data',
      text: 'Next, Data Parallelism applies the same operation across multiple data items.',
    });

    const updated = getScene('scene-1');
    const updatedActions = updated.actions ?? [];
    expect(updatedActions).toEqual([
      expect.objectContaining({ id: 'spot-task', type: 'spotlight', elementId: 'task-card' }),
      expect.objectContaining({
        id: 'speech-task',
        text: 'First, let us look at Task Parallelism and how independent tasks are scheduled.',
        audioId: 'tts_speech-task',
      }),
      expect.objectContaining({ id: 'spot-data', type: 'spotlight', elementId: 'data-card' }),
      expect.objectContaining({
        id: 'speech-data',
        text: 'Next, Data Parallelism applies the same operation across multiple data items.',
        audioId: 'tts_speech-data',
      }),
    ]);
    expect(new Set(updatedActions.map((action) => action.id)).size).toBe(updatedActions.length);
    expect(
      ((updated.content as { canvas: { elements: Array<{ id: string }> } }).canvas.elements ?? [])
        .map((element) => element.id)
        .slice(0, 2),
    ).toEqual(['data-card', 'task-card']);

    act(() => {
      mounted?.root.render(
        React.createElement(
          StrictMode,
          null,
          React.createElement(ActionsBar, { sceneId: 'scene-1' }),
        ),
      );
    });
    expect((getScene('scene-1').actions ?? []).map((action) => action.id)).toEqual([
      'spot-task',
      'speech-task',
      'spot-data',
      'speech-data',
    ]);
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

    const secondRequestContent = mocks.fetchSceneActions.mock.calls[1][0].content as {
      narrationSource?: { text?: string };
    };
    const secondRequestSource = secondRequestContent.narrationSource?.text ?? '';
    expect(secondRequestSource).toContain('Newest Queue Claim');
    expect(secondRequestSource).not.toContain('Queued First Edit');
  });

  it('uses latest swapped visual order when a bulk queued scene starts', async () => {
    const sceneOne = makeManualEditedStaleScene({
      id: 'scene-1',
      order: 1,
      outlineId: 'outline-1',
    });
    const sceneTwo = makeSwappedParallelismScene({
      id: 'scene-2',
      order: 2,
      outlineId: 'outline-2',
      dataLeft: 80,
      taskLeft: 560,
      sync: {
        status: 'narration-stale',
        narrationSourceFingerprint: 'previous-order',
        audioSourceFingerprint: 'previous-audio',
      },
    });
    const firstGeneration = deferredPromise<unknown>();
    mocks.fetchSceneActions.mockImplementation((request: { content: unknown }) => {
      const source = JSON.stringify(request.content);
      if (source.includes('Minimizing Efficiency')) return firstGeneration.promise;
      return Promise.resolve({
        success: true,
        scene: {
          ...getScene('scene-2'),
          actions: [
            { id: 'new-spot-task', type: 'spotlight', elementId: 'task-card' },
            speech('new-speech-task', 'Bulk Task narration.', ''),
            { id: 'new-spot-data', type: 'spotlight', elementId: 'data-card' },
            speech('new-speech-data', 'Bulk Data narration.', ''),
          ],
        },
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
        makeSwappedParallelismScene({
          id: 'scene-2',
          order: 2,
          outlineId: 'outline-2',
          dataLeft: 560,
          taskLeft: 80,
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

    const secondRequestContent = mocks.fetchSceneActions.mock.calls[1][0].content as {
      narrationSource?: { text?: string; blocks?: Array<{ targetElementId: string }> };
    };
    expect(secondRequestContent.narrationSource?.text).toMatch(
      /Task Parallelism[\s\S]*Data Parallelism/,
    );
    expect(
      secondRequestContent.narrationSource?.blocks?.map((block) => block.targetElementId),
    ).toEqual(['task-card', 'data-card']);
  });

  it('emits visible bulk sync order checkpoints through the real Sync all stale click path', async () => {
    const scene = makeMpiConceptsScene();
    mocks.fetchSceneActions.mockResolvedValue({
      success: true,
      scene: {
        ...scene,
        actions: [
          { id: 'new-spot-communicators', type: 'spotlight', elementId: 'communicators-card' },
          speech('new-speech-communicators', 'Communicators narration.', ''),
          { id: 'new-spot-processes', type: 'spotlight', elementId: 'processes-card' },
          speech('new-speech-processes', 'Processes narration.', ''),
          { id: 'new-spot-rank', type: 'spotlight', elementId: 'rank-card' },
          speech('new-speech-rank', 'Rank narration.', ''),
        ],
      },
    });
    setupStores(scene);

    mountActionsBar();
    await findText('edit.timeline.narrationStale');

    await act(async () => {
      requiredButton('edit.timeline.syncAllStale').click();
      await Promise.resolve();
    });
    await waitForCondition(() => mocks.regenerateSpeechAudio.mock.calls.length === 3);

    const logs = narrationOrderLogs();
    expect(logs.map((payload) => payload.checkpoint)).toEqual([
      'bulk-queue',
      'current-scene',
      'visual-block-order',
      'generation-input-order',
      'generated-action-order',
      'final-action-order',
      'saved-action-order',
      'tts-input-order',
    ]);
    expect(logs[0].sceneIds).toEqual(['scene-1']);

    const currentScene = checkpoint(logs, 'current-scene');
    expect(currentScene.sceneFound).toBe(true);
    expect(textPreviewOrder(currentScene.elementArrayOrder)).toEqual([
      'Processes',
      'Communicators',
      'Rank',
    ]);

    expect(textPreviewOrder(checkpoint(logs, 'visual-block-order').blocks)).toEqual([
      'Communicators',
      'Processes',
      'Rank',
    ]);
    expect(textPreviewOrder(checkpoint(logs, 'generation-input-order').targets)).toEqual([
      'Communicators',
      'Processes',
      'Rank',
    ]);
    expect(targetActionOrder(checkpoint(logs, 'generated-action-order').actions)).toEqual([
      'communicators-card',
      'processes-card',
      'rank-card',
    ]);
    expect(targetActionOrder(checkpoint(logs, 'final-action-order').actions)).toEqual([
      'communicators-card',
      'processes-card',
      'rank-card',
    ]);
    expect(targetActionOrder(checkpoint(logs, 'saved-action-order').actions)).toEqual([
      'communicators-card',
      'processes-card',
      'rank-card',
    ]);
    expect(checkpoint(logs, 'tts-input-order').speechPreviews).toEqual([
      'Communicators narration.',
      'Processes narration.',
      'Rank narration.',
    ]);
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

function makeSwappedParallelismScene(
  options: {
    id?: string;
    order?: number;
    outlineId?: string;
    dataLeft?: number;
    taskLeft?: number;
    sync?: Scene['sync'];
  } = {},
): Scene {
  const initial = parallelismScene({
    id: options.id,
    order: options.order,
    outlineId: options.outlineId,
    dataLeft: 80,
    taskLeft: 560,
  });
  const swapped = parallelismScene({
    id: options.id,
    order: options.order,
    outlineId: options.outlineId,
    dataLeft: options.dataLeft ?? 560,
    taskLeft: options.taskLeft ?? 80,
  });
  return {
    ...swapped,
    sync: options.sync ?? syncedNarrationMetadata(initial, TTS_SETTINGS),
  };
}

function parallelismScene(options: {
  id?: string;
  order?: number;
  outlineId?: string;
  dataLeft: number;
  taskLeft: number;
}): Scene {
  const id = options.id ?? 'scene-1';
  const order = options.order ?? 1;
  return makeScene(
    {
      id,
      stageId: 'stage-1',
      title: 'Data vs. Task Parallelism',
      order,
      outlineId: options.outlineId ?? `outline-${order}`,
      actions: [
        { id: 'spot-data', type: 'spotlight', elementId: 'data-card' } as Action,
        speech('speech-data', 'First, let us look at Data Parallelism.', 'tts_speech_data'),
        { id: 'spot-task', type: 'spotlight', elementId: 'task-card' } as Action,
        speech(
          'speech-task',
          'Next, Task Parallelism schedules independent tasks.',
          'tts_speech_task',
        ),
      ],
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
            id: 'data-card',
            type: 'text',
            left: options.dataLeft,
            top: 140,
            width: 340,
            height: 120,
            rotate: 0,
            content: '<h2>Data Parallelism</h2>',
            defaultFontName: 'Arial',
            defaultColor: '#111111',
          },
          {
            id: 'task-card',
            type: 'text',
            left: options.taskLeft,
            top: 140,
            width: 340,
            height: 120,
            rotate: 0,
            content: '<h2>Task Parallelism</h2>',
            defaultFontName: 'Arial',
            defaultColor: '#111111',
          },
        ],
      },
    },
  );
}

function makeMpiConceptsScene(): Scene {
  const initial = mpiConceptsScene({ processesLeft: 100, communicatorsLeft: 400, rankLeft: 700 });
  const edited = mpiConceptsScene({ processesLeft: 400, communicatorsLeft: 100, rankLeft: 700 });
  return {
    ...edited,
    sync: syncedNarrationMetadata(initial, TTS_SETTINGS),
  };
}

function mpiConceptsScene(layout: {
  processesLeft: number;
  communicatorsLeft: number;
  rankLeft: number;
}): Scene {
  return makeScene(
    {
      id: 'scene-1',
      stageId: 'stage-1',
      title: 'Core MPI Concepts',
      order: 1,
      outlineId: 'outline-1',
      actions: [
        { id: 'spot-processes', type: 'spotlight', elementId: 'processes-card' } as Action,
        speech('speech-processes', 'Processes old narration.', 'tts_processes'),
        { id: 'spot-communicators', type: 'spotlight', elementId: 'communicators-card' } as Action,
        speech('speech-communicators', 'Communicators old narration.', 'tts_communicators'),
        { id: 'spot-rank', type: 'spotlight', elementId: 'rank-card' } as Action,
        speech('speech-rank', 'Rank old narration.', 'tts_rank'),
      ],
    },
    {
      type: 'slide',
      canvas: {
        id: 'mpi-canvas',
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme: {
          backgroundColor: '#ffffff',
          themeColors: ['#5b9bd5'],
          fontColor: '#111111',
          fontName: 'Arial',
        },
        elements: [
          mpiTextElement('processes-card', 'Processes', layout.processesLeft),
          mpiTextElement('communicators-card', 'Communicators', layout.communicatorsLeft),
          mpiTextElement('rank-card', 'Rank', layout.rankLeft),
        ],
      },
    },
  );
}

function mpiTextElement(id: string, text: string, left: number) {
  return {
    id,
    type: 'text' as const,
    left,
    top: 150,
    width: 220,
    height: 96,
    rotate: 0,
    content: `<h2>${text}</h2>`,
    defaultFontName: 'Arial',
    defaultColor: '#111111',
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

function narrationOrderLogs(): Array<Record<string, unknown>> {
  return consoleInfo.mock.calls
    .filter((call: unknown[]) => call[0] === '[NarrationSyncOrder]')
    .map((call: unknown[]) => call[1] as Record<string, unknown>);
}

function checkpoint(logs: Array<Record<string, unknown>>, name: string) {
  const found = logs.find((payload) => payload.checkpoint === name);
  expect(found).toBeTruthy();
  return found as Record<string, unknown>;
}

function textPreviewOrder(value: unknown) {
  return (value as Array<{ textPreview?: string }>).map((item) => item.textPreview);
}

function targetActionOrder(value: unknown) {
  return (value as Array<{ targetElementId?: string }>)
    .filter((action) => action.targetElementId)
    .map((action) => action.targetElementId);
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
