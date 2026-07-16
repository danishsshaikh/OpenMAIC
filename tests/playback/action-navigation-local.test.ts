import { describe, expect, it } from 'vitest';
import type { Action } from '@/lib/types/action';
import {
  buildActionNavigationTargets,
  canJumpWithinReconstructablePrefix,
  getActionLineProgress,
} from '@/lib/playback/action-navigation';
import {
  createActionResumePosition,
  getActionResumeRestoreCursor,
  readActionResumeState,
  saveActionResumePosition,
} from '@/lib/playback/action-resume';

const speech = (id: string, text = id): Action => ({ id, type: 'speech', text }) as Action;
const wb = (id: string): Action => ({ id, type: 'wb_draw_text', text: id }) as unknown as Action;
const widget = (id: string): Action => ({ id, type: 'widget_setState' }) as Action;

describe('local action navigation helpers', () => {
  it('maps speech lines to original action indices', () => {
    const actions = [speech('speech-1'), wb('wb-1'), speech('speech-2')];

    expect(buildActionNavigationTargets(actions)).toMatchObject([
      { actionIndex: 0, actionId: 'speech-1', lineNumber: 1, canJump: true },
      { actionIndex: 2, actionId: 'speech-2', lineNumber: 2, canJump: true },
    ]);
  });

  it('guards speech targets after unsafe actions', () => {
    const actions = [speech('speech-1'), widget('widget-1'), speech('speech-2')];

    expect(canJumpWithinReconstructablePrefix(actions, 0, 0)).toBe(true);
    expect(canJumpWithinReconstructablePrefix(actions, 0, 2)).toBe(false);
  });

  it('computes line progress from action cursor', () => {
    const actions = [speech('speech-1'), wb('wb-1'), speech('speech-2')];

    expect(getActionLineProgress(actions, 0)).toEqual({ currentLine: 1, totalLines: 2 });
    expect(getActionLineProgress(actions, 2)).toEqual({ currentLine: 2, totalLines: 2 });
  });

  it('restores valid action-level resume positions and ignores stale ones', () => {
    const storage = new Map<string, string>();
    const sessionStorageLike = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };
    const actions = [speech('speech-1'), wb('wb-1'), speech('speech-2')];
    const position = createActionResumePosition(actions, 2);

    expect(position).toEqual({ actionIndex: 2, actionId: 'speech-2', actionType: 'speech' });

    saveActionResumePosition(sessionStorageLike, 'resume-key', 'scene-1', position!);
    const state = readActionResumeState(sessionStorageLike, 'resume-key');

    expect(getActionResumeRestoreCursor(state, 'scene-1', actions)).toEqual({
      actionIndex: 2,
      position,
    });
    expect(getActionResumeRestoreCursor(state, 'scene-1', [speech('changed')])).toEqual({
      actionIndex: 0,
      position: null,
    });
  });
});
