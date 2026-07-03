import { describe, expect, it, vi } from 'vitest';
import { PlaybackEngine, isPlaybackSceneSeekable } from '@/lib/playback/engine';
import type { ActionEngine } from '@/lib/action/engine';
import type { AudioPlayer } from '@/lib/utils/audio-player';
import type { Scene } from '@/lib/types/stage';

function scene(actions: NonNullable<Scene['actions']>): Scene {
  return {
    id: 'scene-1',
    stageId: 'stage-1',
    type: 'slide',
    title: 'Scene 1',
    order: 0,
    content: {
      type: 'slide',
      canvas: {
        viewportSize: { width: 1600, height: 900 },
        elements: [],
      },
    },
    actions,
  } as unknown as Scene;
}

function fakeActionEngine(): ActionEngine {
  return {
    clearEffects: vi.fn(),
    resetPlaybackVisualState: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  } as unknown as ActionEngine;
}

function fakeAudio(overrides: Partial<AudioPlayer> = {}): AudioPlayer {
  return {
    play: vi.fn().mockResolvedValue(false),
    pause: vi.fn(),
    stop: vi.fn(),
    resume: vi.fn(),
    isPlaying: vi.fn(() => false),
    hasActiveAudio: vi.fn(() => false),
    getCurrentTime: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    seekTo: vi.fn(() => false),
    onEnded: vi.fn(),
    setMuted: vi.fn(),
    setVolume: vi.fn(),
    setPlaybackRate: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  } as unknown as AudioPlayer;
}

describe('PlaybackEngine seek', () => {
  it('classifies speech and whiteboard scenes as seekable', () => {
    expect(
      isPlaybackSceneSeekable([
        { id: 'speech-1', type: 'speech', text: 'A line.' },
        { id: 'wb-1', type: 'wb_open' },
        {
          id: 'wb-2',
          type: 'wb_draw_text',
          content: 'Written state',
          x: 0,
          y: 0,
        },
      ]),
    ).toBe(true);
  });

  it.each([
    ['widget action', { id: 'widget-1', type: 'widget_reveal', target: 'part-a' }],
    ['discussion action', { id: 'discussion-1', type: 'discussion', topic: 'Question?' }],
    ['play_video action', { id: 'video-1', type: 'play_video', elementId: 'video-1' }],
  ])('keeps a scene with %s seekable for internal best-effort controls', (_label, action) => {
    expect(
      isPlaybackSceneSeekable([
        { id: 'speech-1', type: 'speech', text: 'A line.' },
        action,
      ] as NonNullable<Scene['actions']>),
    ).toBe(true);
  });

  it('freezes estimated progress immediately when paused', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    try {
      const engine = new PlaybackEngine(
        [
          scene([
            { id: 'speech-1', type: 'speech', text: 'A longer line for estimated progress.' },
          ]),
        ],
        fakeActionEngine(),
        fakeAudio({
          play: vi.fn(() => new Promise<boolean>(() => {})),
        }),
        { getPlaybackSpeed: () => 1 },
      );

      engine.start();
      vi.setSystemTime(3000);
      engine.pause();
      const pausedProgress = engine.getProgress().currentTimeMs;

      vi.setSystemTime(9000);

      expect(engine.getProgress().currentTimeMs).toBe(pausedProgress);
    } finally {
      vi.useRealTimers();
    }
  });

  it('seeks to an estimated action boundary while paused', async () => {
    const engine = new PlaybackEngine(
      [
        scene([
          { id: 'speech-1', type: 'speech', text: 'First line.' },
          { id: 'speech-2', type: 'speech', text: 'Second line.' },
        ]),
      ],
      fakeActionEngine(),
      fakeAudio(),
      { getPlaybackSpeed: () => 1 },
    );

    expect(engine.getProgress()).toMatchObject({
      currentTimeMs: 0,
      durationMs: 4000,
      seekable: true,
    });

    const progress = await engine.seekTo(2500);

    expect(engine.getMode()).toBe('paused');
    expect(progress).toMatchObject({
      currentTimeMs: 2500,
      durationMs: 4000,
      actionIndex: 1,
    });
    expect(engine.getSnapshot().actionIndex).toBe(1);
  });

  it('delegates precise seek to the active generated speech audio', async () => {
    let currentTimeMs = 1000;
    const seekTo = vi.fn((timeMs: number) => {
      currentTimeMs = timeMs;
      return true;
    });
    const audio = fakeAudio({
      play: vi.fn().mockResolvedValue(true),
      hasActiveAudio: vi.fn(() => true),
      getCurrentTime: vi.fn(() => currentTimeMs),
      getDuration: vi.fn(() => 10000),
      seekTo,
    });
    const engine = new PlaybackEngine(
      [scene([{ id: 'speech-1', type: 'speech', text: 'Generated audio line.' }])],
      fakeActionEngine(),
      audio,
      { getPlaybackSpeed: () => 1 },
    );

    engine.start();
    const progress = await engine.seekTo(5000);

    expect(seekTo).toHaveBeenCalledWith(5000);
    expect(progress.currentTimeMs).toBe(5000);
    expect(progress.durationMs).toBe(10000);
  });

  it('clears transient effects during precise seek within active generated speech', async () => {
    let onEnded: () => void = () => {};
    const actionEngine = fakeActionEngine();
    const audio = fakeAudio({
      play: vi.fn().mockResolvedValue(true),
      hasActiveAudio: vi.fn(() => true),
      getDuration: vi.fn(() => 10000),
      seekTo: vi.fn(() => true),
      onEnded: vi.fn((callback) => {
        onEnded = callback;
      }),
    });
    const engine = new PlaybackEngine(
      [
        scene([
          { id: 'speech-1', type: 'speech', text: 'First line.' },
          { id: 'spotlight-1', type: 'spotlight', elementId: 'shape-1' },
          { id: 'speech-2', type: 'speech', text: 'Second line.' },
        ]),
      ],
      actionEngine,
      audio,
      { getPlaybackSpeed: () => 1 },
    );

    engine.start();
    onEnded();
    await Promise.resolve();
    await Promise.resolve();
    vi.mocked(actionEngine.clearEffects).mockClear();

    await engine.seekTo(11000);

    expect(actionEngine.clearEffects).toHaveBeenCalledTimes(1);
    expect(actionEngine.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'spotlight' }),
      { silent: true },
    );
  });

  it('keeps seek progress at the selected offset while active audio currentTime is still zero', async () => {
    const audio = fakeAudio({
      play: vi.fn().mockResolvedValue(true),
      hasActiveAudio: vi.fn(() => true),
      getCurrentTime: vi.fn(() => 0),
      getDuration: vi.fn(() => 10000),
      seekTo: vi.fn(() => true),
    });
    const engine = new PlaybackEngine(
      [scene([{ id: 'speech-1', type: 'speech', text: 'Generated audio line.' }])],
      fakeActionEngine(),
      audio,
      { getPlaybackSpeed: () => 1 },
    );

    engine.start();
    const progress = await engine.seekTo(5000);

    expect(progress.currentTimeMs).toBe(5000);
    expect(progress.durationMs).toBe(10000);
  });

  it('keeps observed generated-audio duration stable after the action is no longer active', () => {
    const engine = new PlaybackEngine(
      [scene([{ id: 'speech-1', type: 'speech', text: 'Short estimate.' }])],
      fakeActionEngine(),
      fakeAudio({
        play: vi.fn().mockResolvedValue(true),
        hasActiveAudio: vi.fn(() => true),
        getDuration: vi.fn(() => 10000),
      }),
      { getPlaybackSpeed: () => 1 },
    );

    engine.start();
    expect(engine.getProgress().durationMs).toBe(10000);

    engine.stop();

    expect(engine.getProgress().durationMs).toBe(10000);
  });

  it('starts generated speech audio at the pending seek offset', async () => {
    const play = vi.fn().mockResolvedValue(true);
    const engine = new PlaybackEngine(
      [
        scene([
          {
            id: 'speech-1',
            type: 'speech',
            text: 'Generated audio line with enough words for seeking.',
            audioId: 'tts-1',
            audioUrl: '/audio/tts-1.mp3',
          },
        ]),
      ],
      fakeActionEngine(),
      fakeAudio({ play }),
      { getPlaybackSpeed: () => 1 },
    );

    await engine.seekTo(1000);
    engine.resume();

    expect(play).toHaveBeenCalledWith('tts-1', '/audio/tts-1.mp3', 1000);
  });

  it('allows best-effort seek across widget actions', async () => {
    const actionEngine = fakeActionEngine();
    const engine = new PlaybackEngine(
      [
        scene([
          { id: 'speech-1', type: 'speech', text: 'First line.' },
          { id: 'widget-1', type: 'widget_reveal', target: 'part-a' },
          { id: 'speech-2', type: 'speech', text: 'Second line.' },
        ] as NonNullable<Scene['actions']>),
      ],
      actionEngine,
      fakeAudio(),
      { getPlaybackSpeed: () => 1 },
    );

    expect(engine.getProgress()).toMatchObject({ currentTimeMs: 0, seekable: true });

    const progress = await engine.seekTo(2500);

    expect(progress).toMatchObject({ currentTimeMs: 2500, seekable: true, actionIndex: 2 });
    expect(engine.getSnapshot().actionIndex).toBe(2);
    expect(actionEngine.resetPlaybackVisualState).toHaveBeenCalledTimes(1);
    expect(actionEngine.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'widget_reveal' }),
      { silent: true },
    );
  });

  it.each([
    ['discussion', { id: 'discussion-1', type: 'discussion', topic: 'Question?' }, 1, 2000],
    ['play_video', { id: 'video-1', type: 'play_video', elementId: 'video-1' }, 2, 2500],
  ])(
    'does not block best-effort seek in scenes with %s actions',
    async (_label, action, expectedActionIndex, expectedCurrentTimeMs) => {
      const actionEngine = fakeActionEngine();
      const engine = new PlaybackEngine(
        [
          scene([
            { id: 'speech-1', type: 'speech', text: 'First line.' },
            action,
            { id: 'speech-2', type: 'speech', text: 'Second line.' },
          ] as NonNullable<Scene['actions']>),
        ],
        actionEngine,
        fakeAudio(),
        { getPlaybackSpeed: () => 1 },
      );

      expect(engine.getProgress().seekable).toBe(true);

      const progress = await engine.seekTo(2500);

      expect(progress).toMatchObject({
        currentTimeMs: expectedCurrentTimeMs,
        seekable: true,
        actionIndex: expectedActionIndex,
      });
      expect(engine.getSnapshot().actionIndex).toBe(expectedActionIndex);
      expect(actionEngine.resetPlaybackVisualState).toHaveBeenCalledTimes(1);
    },
  );

  it('silently replays whiteboard actions before the target speech', async () => {
    const actionEngine = fakeActionEngine();
    const engine = new PlaybackEngine(
      [
        scene([
          { id: 'speech-1', type: 'speech', text: 'First line.' },
          { id: 'wb-1', type: 'wb_open' },
          {
            id: 'wb-2',
            type: 'wb_draw_text',
            content: 'Important state',
            x: 10,
            y: 20,
          },
          { id: 'spotlight-1', type: 'spotlight', elementId: 'shape-1' },
          { id: 'speech-2', type: 'speech', text: 'Second line.' },
        ] as NonNullable<Scene['actions']>),
      ],
      actionEngine,
      fakeAudio(),
      {
        getPlaybackSpeed: () => 1,
        onEffectFire: vi.fn(),
        onSpeechStart: vi.fn(),
      },
    );

    const progress = await engine.seekTo(2500);

    expect(progress).toMatchObject({ currentTimeMs: 2500, actionIndex: 4, seekable: true });
    expect(actionEngine.resetPlaybackVisualState).toHaveBeenCalledTimes(1);
    expect(actionEngine.execute).toHaveBeenCalledTimes(2);
    expect(actionEngine.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'wb_open' }),
      { silent: true },
    );
    expect(actionEngine.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'wb_draw_text' }),
      { silent: true },
    );
  });

  it('seeking backward resets whiteboard state without replaying later whiteboard actions', async () => {
    const actionEngine = fakeActionEngine();
    const engine = new PlaybackEngine(
      [
        scene([
          { id: 'speech-1', type: 'speech', text: 'First line.' },
          { id: 'wb-1', type: 'wb_open' },
          {
            id: 'wb-2',
            type: 'wb_draw_text',
            content: 'Important state',
            x: 10,
            y: 20,
          },
          { id: 'speech-2', type: 'speech', text: 'Second line.' },
        ] as NonNullable<Scene['actions']>),
      ],
      actionEngine,
      fakeAudio(),
      { getPlaybackSpeed: () => 1 },
    );

    await engine.seekTo(2500);
    vi.mocked(actionEngine.execute).mockClear();

    const progress = await engine.seekTo(0);

    expect(progress).toMatchObject({ currentTimeMs: 0, actionIndex: 0 });
    expect(actionEngine.resetPlaybackVisualState).toHaveBeenCalledTimes(2);
    expect(actionEngine.execute).not.toHaveBeenCalled();
  });

  it('does not schedule an old reading timer when stale audio play resolves after seek', async () => {
    vi.useFakeTimers();
    try {
      let resolveFirstPlay: (value: boolean) => void = () => {};
      const play = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              resolveFirstPlay = resolve;
            }),
        )
        .mockImplementationOnce(() => new Promise<boolean>(() => {}));
      const onSpeechEnd = vi.fn();
      const engine = new PlaybackEngine(
        [
          scene([
            { id: 'speech-1', type: 'speech', text: 'First line.' },
            { id: 'speech-2', type: 'speech', text: 'Second line.' },
          ]),
        ],
        fakeActionEngine(),
        fakeAudio({ play }),
        { getPlaybackSpeed: () => 1, onSpeechEnd },
      );

      engine.start();
      await engine.seekTo(2500);
      resolveFirstPlay(false);
      await vi.runAllTicks();
      vi.advanceTimersByTime(3000);

      expect(onSpeechEnd).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pause invalidates a pending audio play fallback timer', async () => {
    vi.useFakeTimers();
    try {
      let resolvePlay: (value: boolean) => void = () => {};
      const play = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolvePlay = resolve;
          }),
      );
      const onSpeechEnd = vi.fn();
      const engine = new PlaybackEngine(
        [scene([{ id: 'speech-1', type: 'speech', text: 'First line.' }])],
        fakeActionEngine(),
        fakeAudio({ play }),
        { getPlaybackSpeed: () => 1, onSpeechEnd },
      );

      engine.start();
      engine.pause();
      resolvePlay(false);
      await vi.runAllTicks();
      vi.advanceTimersByTime(3000);

      expect(onSpeechEnd).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
