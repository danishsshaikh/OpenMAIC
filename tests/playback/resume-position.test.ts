import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlaybackResumePosition,
  loadPlaybackResumePosition,
  savePlaybackResumePosition,
  PlaybackEngine,
} from '@/lib/playback';
import type { Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import type { ActionEngine } from '@/lib/action/engine';
import type { AudioPlayer } from '@/lib/utils/audio-player';

const scopeId = 'stage-1';

function scene(id: string, actions: Action[]): Scene {
  return {
    id,
    stageId: scopeId,
    type: 'slide',
    title: id,
    order: 0,
    content: { type: 'slide', canvas: { elements: [] } },
    actions,
  } as unknown as Scene;
}

function speech(id: string, text = id): Action {
  return { id, type: 'speech', text } as Action;
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
    onEnded: vi.fn(),
    setMuted: vi.fn(),
    setVolume: vi.fn(),
    setPlaybackRate: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  } as unknown as AudioPlayer;
}

function stubSessionStorage() {
  const values = new Map<string, string>();
  const sessionStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  };
  vi.stubGlobal('window', { sessionStorage });
  return { sessionStorage, values };
}

describe('playback resume position', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves action-level resume position per scene', () => {
    const { values } = stubSessionStorage();
    const currentScene = scene('scene-1', [speech('a'), speech('b', 'Second line')]);

    savePlaybackResumePosition(scopeId, currentScene, {
      sceneId: 'scene-1',
      sceneIndex: 0,
      actionIndex: 1,
      consumedDiscussions: [],
    });

    const raw = [...values.values()][0];
    expect(raw).toContain('"sceneId":"scene-1"');
    expect(raw).toContain('"actionIndex":1');
    expect(loadPlaybackResumePosition(scopeId, currentScene)).toMatchObject({
      sceneId: 'scene-1',
      actionIndex: 1,
      actionId: 'b',
      actionType: 'speech',
    });
  });

  it('restores action-level position for the same scene', () => {
    stubSessionStorage();
    const currentScene = scene('scene-1', [speech('a', 'First line'), speech('b', 'Second line')]);
    savePlaybackResumePosition(scopeId, currentScene, {
      sceneId: 'scene-1',
      sceneIndex: 0,
      actionIndex: 1,
      consumedDiscussions: [],
    });
    const resume = loadPlaybackResumePosition(scopeId, currentScene);
    const onSpeechStart = vi.fn();
    const engine = new PlaybackEngine([currentScene], fakeActionEngine(), fakeAudio(), {
      onSpeechStart,
    });

    expect(resume).not.toBeNull();
    expect(engine.restoreActionPosition(resume!.actionIndex)).toBe(true);
    engine.continuePlayback();

    expect(onSpeechStart).toHaveBeenCalledWith('Second line');
  });

  it('does not store timing or scrubber fields', () => {
    const { values } = stubSessionStorage();
    const currentScene = scene('scene-1', [speech('a')]);

    savePlaybackResumePosition(scopeId, currentScene, {
      sceneId: 'scene-1',
      sceneIndex: 0,
      actionIndex: 0,
      consumedDiscussions: [],
    });

    const raw = [...values.values()][0];
    expect(raw).not.toContain('milliseconds');
    expect(raw).not.toContain('currentTime');
    expect(raw).not.toContain('duration');
    expect(raw).not.toContain('percentage');
    expect(raw).not.toContain('progress');
  });

  it('drops malformed sessionStorage data safely', () => {
    const { sessionStorage } = stubSessionStorage();
    sessionStorage.getItem.mockReturnValue('{bad json');

    expect(loadPlaybackResumePosition(scopeId, scene('scene-1', [speech('a')]))).toBeNull();
  });

  it('drops stale action index after scene actions change', () => {
    stubSessionStorage();
    const originalScene = scene('scene-1', [speech('a'), speech('b')]);
    savePlaybackResumePosition(scopeId, originalScene, {
      sceneId: 'scene-1',
      sceneIndex: 0,
      actionIndex: 1,
      consumedDiscussions: [],
    });

    expect(loadPlaybackResumePosition(scopeId, scene('scene-1', [speech('a')]))).toBeNull();
  });

  it('drops stale action identity after scene actions change', () => {
    stubSessionStorage();
    const originalScene = scene('scene-1', [speech('a', 'Original')]);
    savePlaybackResumePosition(scopeId, originalScene, {
      sceneId: 'scene-1',
      sceneIndex: 0,
      actionIndex: 0,
      consumedDiscussions: [],
    });

    expect(
      loadPlaybackResumePosition(scopeId, scene('scene-1', [speech('a', 'Edited')])),
    ).toBeNull();
  });

  it.each([
    ['widget', { id: 'widget-1', type: 'widget_reveal', target: 'part-a' } as Action],
    ['discussion', { id: 'discussion-1', type: 'discussion', topic: 'Question?' } as Action],
    ['video', { id: 'video-1', type: 'play_video', elementId: 'video-1' } as Action],
    ['whiteboard', { id: 'wb-1', type: 'wb_open' } as Action],
  ])('does not resume through %s actions', (_label, unsafeAction) => {
    stubSessionStorage();
    const currentScene = scene('scene-1', [speech('a'), unsafeAction, speech('b')]);

    savePlaybackResumePosition(scopeId, currentScene, {
      sceneId: 'scene-1',
      sceneIndex: 0,
      actionIndex: 2,
      consumedDiscussions: [],
    });

    expect(loadPlaybackResumePosition(scopeId, currentScene)).toBeNull();
  });

  it('clears a completed scene resume position', () => {
    stubSessionStorage();
    const currentScene = scene('scene-1', [speech('a')]);
    savePlaybackResumePosition(scopeId, currentScene, {
      sceneId: 'scene-1',
      sceneIndex: 0,
      actionIndex: 0,
      consumedDiscussions: [],
    });

    clearPlaybackResumePosition(scopeId, 'scene-1');

    expect(loadPlaybackResumePosition(scopeId, currentScene)).toBeNull();
  });

  it('does not add timestamp seek behavior to the engine', () => {
    const engine = new PlaybackEngine(
      [scene('scene-1', [speech('a')])],
      fakeActionEngine(),
      fakeAudio(),
    );

    expect('seekTo' in engine).toBe(false);
  });
});
