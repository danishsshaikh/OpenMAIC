import { describe, expect, it, vi } from 'vitest';
import { PlaybackEngine } from '@/lib/playback/engine';
import {
  canJumpWithinReconstructablePrefix,
  getActionLineProgress,
} from '@/lib/playback/action-navigation';
import type { ActionEngine } from '@/lib/action/engine';
import type { AudioPlayer } from '@/lib/utils/audio-player';
import type { Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';

function speech(id: string, text = id, audioId?: string): Action {
  return { id, type: 'speech', text, ...(audioId ? { audioId } : {}) } as Action;
}

function scene(actions: Action[]): Scene {
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

function fakeAudio(play: AudioPlayer['play'] = vi.fn().mockResolvedValue(false)): AudioPlayer {
  return {
    play,
    pause: vi.fn(),
    stop: vi.fn(),
    resume: vi.fn(),
    isPlaying: vi.fn(() => false),
    hasActiveAudio: vi.fn(() => false),
    getCurrentTime: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    onEnded: vi.fn(),
    setMuted: vi.fn(),
    setVolume: vi.fn(),
    setPlaybackRate: vi.fn(),
    destroy: vi.fn(),
  } as unknown as AudioPlayer;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PlaybackEngine action-boundary seek compatibility', () => {
  it('classifies speech and deterministic whiteboard prefixes as jumpable', () => {
    const actions = [
      speech('speech-1', 'A line.'),
      { id: 'wb-1', type: 'wb_open' },
      { id: 'wb-2', type: 'wb_draw_text', content: 'Written state', x: 0, y: 0 },
      speech('speech-2', 'Second line.'),
    ] as Action[];

    expect(canJumpWithinReconstructablePrefix(actions, 0, 0)).toBe(true);
    expect(canJumpWithinReconstructablePrefix(actions, 0, 3)).toBe(true);
    expect(getActionLineProgress(actions, 3)).toEqual({ currentLine: 2, totalLines: 2 });
  });

  it.each([
    ['widget action', { id: 'widget-1', type: 'widget_reveal', target: 'part-a' }],
    ['discussion action', { id: 'discussion-1', type: 'discussion', topic: 'Question?' }],
    ['play_video action', { id: 'video-1', type: 'play_video', elementId: 'video-1' }],
  ] as Array<[string, Action]>)(
    'does not jump across %s reconstruction',
    async (_label, unsafe) => {
      const actions = [speech('speech-1', 'A line.'), unsafe, speech('speech-2', 'Second line.')];
      const actionEngine = fakeActionEngine();
      const engine = new PlaybackEngine([scene(actions)], actionEngine, fakeAudio());

      expect(engine.canJumpToAction(2)).toBe(false);
      expect(await engine.jumpToAction(2)).toBe(false);
      expect(engine.getSnapshot().actionIndex).toBe(0);
      expect(actionEngine.resetPlaybackVisualState).not.toHaveBeenCalled();
    },
  );

  it('positions playback at the requested speech action and reports snapshot progress', async () => {
    const onProgress = vi.fn();
    const engine = new PlaybackEngine(
      [scene([speech('speech-1', 'First line.'), speech('speech-2', 'Second line.')])],
      fakeActionEngine(),
      fakeAudio(),
      { onProgress },
    );

    expect(await engine.jumpToAction(1, { autoplay: false })).toBe(true);

    expect(engine.getMode()).toBe('idle');
    expect(engine.getSnapshot()).toMatchObject({ sceneIndex: 0, actionIndex: 1 });
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ sceneIndex: 0, actionIndex: 1 }),
    );
    expect('getProgress' in engine).toBe(false);
    expect('seekTo' in engine).toBe(false);
  });

  it('silently replays reconstructable whiteboard state before the target speech', async () => {
    const actionEngine = fakeActionEngine();
    const actions = [
      speech('speech-1', 'First line.'),
      { id: 'wb-1', type: 'wb_open' },
      { id: 'wb-2', type: 'wb_draw_text', content: 'Important state', x: 10, y: 20 },
      speech('speech-2', 'Second line.'),
    ] as Action[];
    const engine = new PlaybackEngine([scene(actions)], actionEngine, fakeAudio());

    expect(await engine.jumpToAction(3, { autoplay: false })).toBe(true);

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

  it('autoplay continues from the jumped-to speech action with canonical audioId playback', async () => {
    const play = vi.fn().mockResolvedValue(true);
    const engine = new PlaybackEngine(
      [
        scene([
          speech('speech-1', 'First line.', 'audio-1'),
          speech('speech-2', 'Second line.', 'audio-2'),
        ]),
      ],
      fakeActionEngine(),
      fakeAudio(play),
    );

    expect(await engine.jumpToAction(1, { autoplay: true })).toBe(true);
    await flushPromises();

    expect(engine.getMode()).toBe('playing');
    expect(play).toHaveBeenCalledWith('audio-2', undefined);
    expect(engine.getSnapshot().actionIndex).toBe(2);
  });
});
