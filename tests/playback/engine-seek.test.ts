import { describe, expect, it, vi } from 'vitest';
import { PlaybackEngine } from '@/lib/playback/engine';
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

  it('seeks to an estimated action boundary while paused', () => {
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

    const progress = engine.seekTo(2500);

    expect(engine.getMode()).toBe('paused');
    expect(progress).toMatchObject({
      currentTimeMs: 2500,
      durationMs: 4000,
      actionIndex: 1,
    });
    expect(engine.getSnapshot().actionIndex).toBe(1);
  });

  it('delegates precise seek to the active generated speech audio', () => {
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
    const progress = engine.seekTo(5000);

    expect(seekTo).toHaveBeenCalledWith(5000);
    expect(progress.currentTimeMs).toBe(5000);
    expect(progress.durationMs).toBe(10000);
  });

  it('starts generated speech audio at the pending seek offset', () => {
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

    engine.seekTo(1000);
    engine.resume();

    expect(play).toHaveBeenCalledWith('tts-1', '/audio/tts-1.mp3', 1000);
  });
});
