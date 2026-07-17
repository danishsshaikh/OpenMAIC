import { describe, expect, it } from 'vitest';
import type { Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import {
  applyNarrationSyncForSceneUpdate,
  getNarrationSyncState,
  staleAudioMetadata,
  syncedNarrationMetadata,
} from '@/lib/audio/narration-sync';

describe('narration/audio sync fingerprints', () => {
  it('marks narration stale when slide semantic text changes', () => {
    const previous = sceneWithText('s1', 'Old concept', [speech('a', 'Old concept', 'tts_a')]);
    const next = { ...previous, content: slideContent('New concept') } as Scene;

    const out = applyNarrationSyncForSceneUpdate(previous, next);

    expect(out.sync?.status).toBe('narration-stale');
    expect(out.actions?.[0]).toMatchObject({ audioId: 'tts_a' });
  });

  it('does not mark narration stale for layout-only slide changes', () => {
    const previous = sceneWithText('s1', 'Same concept', [speech('a', 'Same concept', 'tts_a')]);
    const next = {
      ...previous,
      content: slideContent('Same concept', { left: 260, fill: '#ff0000' }),
    } as Scene;

    const out = applyNarrationSyncForSceneUpdate(previous, next);

    expect(out.sync?.status).toBe('synced');
  });

  it('marks audio stale when narration text changes and preserves old audio', () => {
    const previous = sceneWithText('s1', 'Same concept', [speech('a', 'Old words', 'tts_a')]);
    const next = {
      ...previous,
      actions: [speech('a', 'New words', 'tts_a')],
    } as Scene;

    const out = applyNarrationSyncForSceneUpdate(previous, next);

    expect(out.sync?.status).toBe('audio-stale');
    expect(out.actions?.[0]).toMatchObject({ audioId: 'tts_a' });
  });

  it('marks audio stale when language or voice fingerprint changes', () => {
    const scene = sceneWithText('s1', 'Same concept', [speech('a', 'Same concept', 'tts_a')]);
    const synced = {
      ...scene,
      sync: syncedNarrationMetadata(scene, { language: 'English', ttsVoice: 'alice' }),
    } as Scene;

    expect(getNarrationSyncState(synced, { language: 'Spanish', ttsVoice: 'alice' }).status).toBe(
      'audio-stale',
    );
    expect(getNarrationSyncState(synced, { language: 'English', ttsVoice: 'bob' }).status).toBe(
      'audio-stale',
    );
  });

  it('detects legacy audio without automatically marking it stale', () => {
    const scene = sceneWithText('legacy', 'Legacy slide', [speech('a', 'Legacy slide', 'tts_a')]);

    expect(getNarrationSyncState(scene).status).toBe('unknown-legacy');
  });

  it('keeps explicit audio-stale metadata actionable until sync succeeds', () => {
    const scene = sceneWithText('s1', 'Slide text', [speech('a', 'Slide text', 'tts_a')]);
    const stale = { ...scene, sync: staleAudioMetadata(scene) } as Scene;

    expect(getNarrationSyncState(stale).status).toBe('audio-stale');
  });
});

function sceneWithText(id: string, text: string, actions: Action[]): Scene {
  return {
    id,
    stageId: 'stage',
    order: 1,
    type: 'slide',
    title: 'Slide',
    content: slideContent(text),
    actions,
  } as Scene;
}

function slideContent(text: string, overrides: Record<string, unknown> = {}): Scene['content'] {
  return {
    type: 'slide',
    canvas: {
      id: 'slide',
      viewportSize: 1000,
      viewportRatio: 0.5625,
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        {
          id: 'text_1',
          type: 'text',
          left: 100,
          top: 100,
          width: 300,
          height: 80,
          rotate: 0,
          content: `<p>${text}</p>`,
          defaultFontName: 'Arial',
          defaultColor: '#111111',
          ...overrides,
        },
      ],
    },
  } as Scene['content'];
}

function speech(id: string, text: string, audioId?: string): Action {
  return { id, type: 'speech', text, ...(audioId ? { audioId } : {}) } as Action;
}
