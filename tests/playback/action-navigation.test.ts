import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaybackEngine } from '@/lib/playback/engine';
import {
  buildActionNavigationTargets,
  canJumpWithinReconstructablePrefix,
  getActionLineProgress,
  getNextSafeSpeechActionIndex,
  getPreviousSafeSpeechActionIndex,
} from '@/lib/playback/action-navigation';
import { useSettingsStore } from '@/lib/store/settings';
import type { Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import type { ActionEngine } from '@/lib/action/engine';
import type { AudioPlayer } from '@/lib/utils/audio-player';

function speech(id: string, text = id): Action {
  return { id, type: 'speech', text } as Action;
}

function scene(actions: Action[]): Scene {
  return {
    id: 'scene-1',
    stageId: 'stage-1',
    type: 'slide',
    title: 'Scene 1',
    order: 1,
    content: { type: 'slide', canvas: {} },
    actions,
  } as unknown as Scene;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createActionEngine() {
  const executions: Array<{ action: Action; silent?: boolean }> = [];
  return {
    executions,
    engine: {
      execute: vi.fn(async (action: Action, options?: { silent?: boolean }) => {
        executions.push({ action, silent: options?.silent });
      }),
      clearEffects: vi.fn(),
      resetPlaybackVisualState: vi.fn(),
    } as unknown as ActionEngine,
  };
}

function createAudioPlayer(play?: (audioId: string, audioUrl?: string) => Promise<boolean>) {
  let ended: (() => void) | null = null;
  return {
    player: {
      play: vi.fn(play ?? (async () => false)),
      onEnded: vi.fn((callback: () => void) => {
        ended = callback;
      }),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isPlaying: vi.fn(() => false),
      hasActiveAudio: vi.fn(() => false),
    } as unknown as AudioPlayer,
    fireEnded: () => ended?.(),
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('action navigation helpers', () => {
  it('builds speech targets with action index metadata', () => {
    const actions = [
      speech('a', 'First'),
      { id: 'spot-1', type: 'spotlight', elementId: 'box' } as Action,
      speech('b', 'Second'),
    ];

    expect(buildActionNavigationTargets(actions)).toEqual([
      { actionIndex: 0, actionId: 'a', actionType: 'speech', lineNumber: 1, canJump: true },
      { actionIndex: 2, actionId: 'b', actionType: 'speech', lineNumber: 2, canJump: true },
    ]);
  });

  it('computes previous and next safe speech actions', () => {
    const actions = [speech('a'), { id: 'wb', type: 'wb_open' } as Action, speech('b')];

    expect(getPreviousSafeSpeechActionIndex(actions, 2)).toBe(0);
    expect(getNextSafeSpeechActionIndex(actions, 0)).toBe(2);
    expect(getActionLineProgress(actions, 2)).toEqual({ currentLine: 2, totalLines: 2 });
  });

  it('does not introduce timestamp or duration navigation state', () => {
    const targets = buildActionNavigationTargets([speech('a')]);
    expect(targets[0]).not.toHaveProperty('timestampMs');
    expect(targets[0]).not.toHaveProperty('durationMs');
    expect(targets[0]).not.toHaveProperty('progress');
  });

  it('guards targets and current cursors that require unsafe reconstruction', () => {
    const actions = [
      speech('a'),
      { id: 'widget-1', type: 'widget_setState', state: {} } as Action,
      speech('b'),
    ];

    expect(canJumpWithinReconstructablePrefix(actions, 0, 0)).toBe(true);
    expect(canJumpWithinReconstructablePrefix(actions, 0, 2)).toBe(false);
    expect(canJumpWithinReconstructablePrefix(actions, 2, 0)).toBe(false);
  });
});

describe('PlaybackEngine action navigation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects invalid and unsafe jump targets', async () => {
    const { engine: actionEngine } = createActionEngine();
    const { player } = createAudioPlayer();
    const engine = new PlaybackEngine(
      [
        scene([
          speech('a'),
          { id: 'discussion-1', type: 'discussion', topic: 'Talk' } as Action,
          speech('b'),
        ]),
      ],
      actionEngine,
      player,
    );

    expect(await engine.jumpToAction(-1)).toBe(false);
    expect(await engine.jumpToAction(99)).toBe(false);
    expect(await engine.jumpToAction(2)).toBe(false);
    expect('seekTo' in engine).toBe(false);
  });

  it.each([
    ['widget_setState', { id: 'u', type: 'widget_setState', state: {} }],
    ['discussion', { id: 'u', type: 'discussion', topic: 'Discuss' }],
    ['play_video', { id: 'u', type: 'play_video', elementId: 'video-1' }],
  ] as Array<[string, Action]>)(
    'guards targets requiring %s reconstruction',
    async (_type, unsafe) => {
      const { engine: actionEngine } = createActionEngine();
      const { player } = createAudioPlayer();
      const engine = new PlaybackEngine(
        [scene([speech('a'), unsafe, speech('b')])],
        actionEngine,
        player,
      );

      expect(engine.canJumpToAction(2)).toBe(false);
      expect(await engine.jumpToAction(2)).toBe(false);
    },
  );

  it('silently replays deterministic whiteboard actions before the target', async () => {
    const { engine: actionEngine, executions } = createActionEngine();
    const { player } = createAudioPlayer();
    const actions = [
      { id: 'open', type: 'wb_open' } as Action,
      { id: 'draw', type: 'wb_draw_text', content: 'A', x: 1, y: 2 } as Action,
      speech('target'),
    ];
    const engine = new PlaybackEngine([scene(actions)], actionEngine, player);

    expect(await engine.jumpToAction(2, { autoplay: false })).toBe(true);
    expect(actionEngine.resetPlaybackVisualState).toHaveBeenCalledTimes(1);
    expect(executions).toEqual([
      { action: actions[0], silent: true },
      { action: actions[1], silent: true },
    ]);
    expect(player.play).not.toHaveBeenCalled();
  });

  it('does not duplicate whiteboard actions after a backward jump and replay', async () => {
    const { engine: actionEngine, executions } = createActionEngine();
    const { player } = createAudioPlayer();
    const actions = [
      { id: 'draw', type: 'wb_draw_text', content: 'A', x: 1, y: 2 } as Action,
      speech('a'),
    ];
    const engine = new PlaybackEngine([scene(actions)], actionEngine, player);

    expect(await engine.jumpToAction(1, { autoplay: false })).toBe(true);
    expect(await engine.jumpToAction(1, { autoplay: false })).toBe(true);
    expect(actionEngine.resetPlaybackVisualState).toHaveBeenCalledTimes(2);
    expect(executions).toHaveLength(2);
    expect(executions.every((entry) => entry.action.id === 'draw' && entry.silent)).toBe(true);
  });

  it('stale generated-audio play resolution after jump cannot schedule old completion', async () => {
    vi.useFakeTimers();
    const firstPlay = deferred<boolean>();
    const { engine: actionEngine } = createActionEngine();
    const { player } = createAudioPlayer(vi.fn().mockReturnValueOnce(firstPlay.promise));
    const onSpeechEnd = vi.fn();
    const onComplete = vi.fn();
    const engine = new PlaybackEngine([scene([speech('a'), speech('b')])], actionEngine, player, {
      onSpeechEnd,
      onComplete,
    });

    engine.start();
    expect(await engine.jumpToAction(1, { autoplay: false })).toBe(true);
    firstPlay.resolve(false);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5000);

    expect(onSpeechEnd).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('stale reading timer after jump cannot advance old action', async () => {
    vi.useFakeTimers();
    const { engine: actionEngine } = createActionEngine();
    const { player } = createAudioPlayer(async () => false);
    const onSpeechEnd = vi.fn();
    const onComplete = vi.fn();
    const engine = new PlaybackEngine([scene([speech('a'), speech('b')])], actionEngine, player, {
      onSpeechEnd,
      onComplete,
    });

    engine.start();
    await flushPromises();
    expect(await engine.jumpToAction(1, { autoplay: false })).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);

    expect(onSpeechEnd).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('browser TTS callbacks are generation-token guarded', async () => {
    const spoken: Array<{ onend?: () => void; onerror?: (event: { error: string }) => void }> = [];
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        rate = 1;
        volume = 1;
        lang = 'en-US';
        voice?: SpeechSynthesisVoice;
        onend?: () => void;
        onerror?: (event: { error: string }) => void;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    vi.stubGlobal('window', {
      speechSynthesis: {
        getVoices: () => [{ voiceURI: 'v1', lang: 'en-US' }],
        cancel: vi.fn(),
        speak: vi.fn((utterance) => spoken.push(utterance)),
      },
    });
    const ttsProvidersConfig = useSettingsStore.getState().ttsProvidersConfig;
    useSettingsStore.setState({
      ttsEnabled: true,
      ttsProviderId: 'browser-native-tts',
      ttsProvidersConfig: {
        ...ttsProvidersConfig,
        'browser-native-tts': {
          ...ttsProvidersConfig['browser-native-tts'],
          enabled: true,
        },
      },
    });

    const { engine: actionEngine } = createActionEngine();
    const { player } = createAudioPlayer(async () => false);
    const onSpeechEnd = vi.fn();
    const engine = new PlaybackEngine(
      [scene([speech('a', 'Sentence.'), speech('b')])],
      actionEngine,
      player,
      {
        onSpeechEnd,
      },
    );

    engine.start();
    await flushPromises();
    expect(spoken).toHaveLength(1);
    expect(await engine.jumpToAction(1, { autoplay: false })).toBe(true);
    spoken[0].onend?.();

    expect(onSpeechEnd).not.toHaveBeenCalled();
  });

  it('jumping to the last line completes through normal completion flow', async () => {
    vi.useFakeTimers();
    const { engine: actionEngine } = createActionEngine();
    const { player } = createAudioPlayer(async () => false);
    const onComplete = vi.fn();
    const engine = new PlaybackEngine(
      [scene([speech('a'), speech('last')])],
      actionEngine,
      player,
      {
        onComplete,
      },
    );

    expect(await engine.jumpToAction(1, { autoplay: true })).toBe(true);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2500);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(engine.getMode()).toBe('idle');
  });
});
