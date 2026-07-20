import { describe, expect, it } from 'vitest';
import type { Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import type { PPTElement } from '@openmaic/dsl';
import {
  applyNarrationSyncForSceneUpdate,
  buildNarrationSourceFromScene,
  buildVisualNarrationBlocksFromScene,
  getVisibleElementText,
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

  it('orders slide blocks by visual reading order instead of element array order', () => {
    const swapped = parallelismScene({
      dataLeft: 560,
      taskLeft: 80,
      dataTop: 120,
      taskTop: 120,
    });

    const blocks = buildVisualNarrationBlocksFromScene(swapped);

    expect(blocks.map((block) => block.text)).toEqual(['Task Parallelism', 'Data Parallelism']);
  });

  it('marks narration stale when card visual order swaps but not after a small same-order move', () => {
    const initial = {
      ...parallelismScene({ dataLeft: 80, taskLeft: 560, dataTop: 120, taskTop: 120 }),
      sync: undefined,
    } as Scene;
    const synced = { ...initial, sync: syncedNarrationMetadata(initial) } as Scene;
    const swapped = {
      ...synced,
      content: parallelismContent({ dataLeft: 560, taskLeft: 80, dataTop: 120, taskTop: 120 }),
    } as Scene;
    const smallMove = {
      ...synced,
      content: parallelismContent({ dataLeft: 85, taskLeft: 560, dataTop: 120, taskTop: 120 }),
    } as Scene;

    expect(getNarrationSyncState(swapped).status).toBe('narration-stale');
    expect(applyNarrationSyncForSceneUpdate(initial, swapped).sync?.status).toBe('narration-stale');
    expect(getNarrationSyncState(smallMove).status).toBe('synced');
    expect(applyNarrationSyncForSceneUpdate(initial, smallMove).sync?.status).toBe('synced');
  });

  it('keeps grouped card text together while detecting full-card reorder', () => {
    const initial = groupedParallelismScene({
      dataLeft: 80,
      taskLeft: 560,
      dataBulletOffset: 0,
    });
    const smallBulletMove = groupedParallelismScene({
      dataLeft: 80,
      taskLeft: 560,
      dataBulletOffset: 5,
    });
    const swapped = groupedParallelismScene({
      dataLeft: 560,
      taskLeft: 80,
      dataBulletOffset: 0,
    });

    expect(buildVisualNarrationBlocksFromScene(initial).map((block) => block.text)).toEqual([
      'Data Parallelism\nSame operation\nDifferent data items',
      'Task Parallelism\nIndependent tasks\nSeparate scheduling',
    ]);
    expect(buildVisualNarrationBlocksFromScene(smallBulletMove).map((block) => block.text)).toEqual(
      [
        'Data Parallelism\nSame operation\nDifferent data items',
        'Task Parallelism\nIndependent tasks\nSeparate scheduling',
      ],
    );
    expect(buildVisualNarrationBlocksFromScene(swapped).map((block) => block.text)).toEqual([
      'Task Parallelism\nIndependent tasks\nSeparate scheduling',
      'Data Parallelism\nSame operation\nDifferent data items',
    ]);
    expect(
      getNarrationSyncState({
        ...smallBulletMove,
        sync: syncedNarrationMetadata(initial),
      }).status,
    ).toBe('synced');
    expect(
      getNarrationSyncState({
        ...swapped,
        sync: syncedNarrationMetadata(initial),
      }).status,
    ).toBe('narration-stale');
  });

  it('extracts current renderer-backed text before stale compatibility fields', () => {
    const text = textElement('reduce-text', 'One to Many', 80, 120);
    const shape = {
      ...cardBackground('reduce-shape', 80, 120),
      content: '<p>Many to One</p>',
      text: {
        content: '<h2>MPI_Reduce</h2><p>One to Many</p>',
        defaultFontName: 'Arial',
        defaultColor: '#111111',
        align: 'middle' as const,
      },
    } as unknown as PPTElement;
    const scene = {
      id: 'collective',
      stageId: 'stage',
      order: 1,
      type: 'slide',
      title: 'Collective Communication',
      content: {
        type: 'slide',
        canvas: {
          id: 'slide',
          viewportSize: 1000,
          viewportRatio: 0.5625,
          theme: {
            backgroundColor: '#ffffff',
            themeColors: ['#5b9bd5'],
            fontColor: '#111111',
            fontName: 'Arial',
          },
          background: { type: 'solid', color: '#ffffff' },
          elements: [text, shape],
        },
      },
      actions: [],
    } as unknown as Scene;

    expect(getVisibleElementText(text as PPTElement)).toBe('One to Many');
    expect(getVisibleElementText(shape)).toBe('MPI_Reduce One to Many');
    expect(buildNarrationSourceFromScene(scene).text).toContain('One to Many');
    expect(buildNarrationSourceFromScene(scene).text).not.toContain('Many to One');
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

function parallelismScene(layout: {
  dataLeft: number;
  taskLeft: number;
  dataTop: number;
  taskTop: number;
}): Scene {
  return {
    id: 'parallelism',
    stageId: 'stage',
    order: 1,
    type: 'slide',
    title: 'Data vs. Task Parallelism',
    content: parallelismContent(layout),
    actions: [
      { id: 'spot-data', type: 'spotlight', elementId: 'data-card' },
      speech('speech-data', 'Data narration', 'tts_data'),
      { id: 'spot-task', type: 'spotlight', elementId: 'task-card' },
      speech('speech-task', 'Task narration', 'tts_task'),
    ],
  } as Scene;
}

function parallelismContent(layout: {
  dataLeft: number;
  taskLeft: number;
  dataTop: number;
  taskTop: number;
}): Scene['content'] {
  return {
    type: 'slide',
    canvas: {
      id: 'slide',
      viewportSize: 1000,
      viewportRatio: 0.5625,
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        textElement('data-card', 'Data Parallelism', layout.dataLeft, layout.dataTop),
        textElement('task-card', 'Task Parallelism', layout.taskLeft, layout.taskTop),
      ],
    },
  } as Scene['content'];
}

function groupedParallelismScene(layout: {
  dataLeft: number;
  taskLeft: number;
  dataBulletOffset: number;
}): Scene {
  return {
    ...parallelismScene({
      dataLeft: layout.dataLeft,
      taskLeft: layout.taskLeft,
      dataTop: 120,
      taskTop: 120,
    }),
    content: {
      type: 'slide',
      canvas: {
        id: 'slide',
        viewportSize: 1000,
        viewportRatio: 0.5625,
        background: { type: 'solid', color: '#ffffff' },
        elements: [
          cardBackground('data-bg', layout.dataLeft, 110),
          cardBackground('task-bg', layout.taskLeft, 110),
          textElement('data-heading', 'Data Parallelism', layout.dataLeft + 24, 130),
          textElement(
            'data-bullet-1',
            'Same operation',
            layout.dataLeft + 24 + layout.dataBulletOffset,
            190,
          ),
          textElement('data-bullet-2', 'Different data items', layout.dataLeft + 24, 230),
          textElement('task-heading', 'Task Parallelism', layout.taskLeft + 24, 130),
          textElement('task-bullet-1', 'Independent tasks', layout.taskLeft + 24, 190),
          textElement('task-bullet-2', 'Separate scheduling', layout.taskLeft + 24, 230),
        ],
      },
    } as Scene['content'],
  } as Scene;
}

function textElement(id: string, text: string, left: number, top: number) {
  return {
    id,
    type: 'text',
    left,
    top,
    width: 320,
    height: 36,
    rotate: 0,
    content: `<p>${text}</p>`,
    defaultFontName: 'Arial',
    defaultColor: '#111111',
  };
}

function cardBackground(id: string, left: number, top: number) {
  return {
    id,
    type: 'shape',
    left,
    top,
    width: 360,
    height: 180,
    rotate: 0,
    viewBox: [360, 180],
    path: '',
    fixedRatio: false,
    fill: '#ffffff',
  };
}
