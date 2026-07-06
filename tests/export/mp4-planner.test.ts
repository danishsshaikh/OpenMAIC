import { describe, expect, it } from 'vitest';
import { buildLocalMp4Manifest, sanitizeMp4PathPart } from '@/lib/export/mp4/planner';
import type { Scene } from '@/lib/types/stage';
import type { VideoFrameEntry } from '@/lib/export/video-frame-types';

describe('local MP4 export planner', () => {
  it('builds ordered speech-action segments in scene/action order', () => {
    const scenes = [
      scene({
        id: 's2',
        title: 'Second',
        order: 2,
        actions: [{ id: 'b', type: 'speech', text: 'Second line' }],
      }),
      scene({
        id: 's1',
        title: 'First',
        order: 1,
        actions: [
          { id: 'a1', type: 'speech', text: 'First line' },
          { id: 'spotlight', type: 'spotlight', elementId: 'shape-1' },
          { id: 'a2', type: 'speech', text: 'Another line' },
        ],
      }),
    ];
    const frames = [
      frame({ scene: scenes[1], index: 1, file: 'frames/001-first.png' }),
      frame({ scene: scenes[0], index: 2, file: 'frames/002-second.png' }),
    ];

    const plan = buildLocalMp4Manifest({
      stageTitle: 'Course',
      scenes,
      frames,
      frameWidth: 1280,
      frameHeight: 720,
      resolveAudioFile: ({ scene, speechIndex }) =>
        `audio/${scene.id}/speech-${String(speechIndex).padStart(3, '0')}.mp3`,
    });

    expect(plan.missingAudio).toEqual([]);
    expect(plan.manifest.segments.map((segment) => segment.actionId)).toEqual(['a1', 'a2', 'b']);
    expect(plan.manifest.segments.map((segment) => segment.frameFile)).toEqual([
      'frames/001-first.png',
      'frames/001-first.png',
      'frames/002-second.png',
    ]);
  });

  it('reports missing generated audio instead of creating Browser Native TTS segments', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'Intro',
        order: 1,
        actions: [{ id: 'a1', type: 'speech', text: 'Browser-only line' }],
      }),
    ];

    const plan = buildLocalMp4Manifest({
      stageTitle: 'Course',
      scenes,
      frames: [frame({ scene: scenes[0], index: 1, file: 'frames/001-intro.png' })],
      frameWidth: 1280,
      frameHeight: 720,
      resolveAudioFile: () => null,
    });

    expect(plan.manifest.segments).toEqual([]);
    expect(plan.missingAudio).toEqual([
      {
        sceneId: 's1',
        sceneTitle: 'Intro',
        actionId: 'a1',
        actionIndex: 0,
        reason: 'missing generated audioId/audioUrl',
      },
    ]);
  });

  it('records no-audio scenes as warnings without inventing long silence', () => {
    const scenes = [scene({ id: 's1', title: 'Quiz', order: 1, type: 'quiz', actions: [] })];

    const plan = buildLocalMp4Manifest({
      stageTitle: 'Course',
      scenes,
      frames: [frame({ scene: scenes[0], index: 1, file: 'frames/001-quiz-placeholder.png' })],
      frameWidth: 1280,
      frameHeight: 720,
      resolveAudioFile: () => null,
    });

    expect(plan.manifest.segments).toEqual([]);
    expect(plan.manifest.warnings).toEqual([
      {
        sceneId: 's1',
        sceneTitle: 'Quiz',
        reason: 'scene has no exportable generated narration audio and is omitted from MP4 timing',
      },
    ]);
  });

  it('sanitizes local MP4 path parts', () => {
    expect(sanitizeMp4PathPart('  Intro: A/B?  ')).toBe('intro-a-b');
  });
});

function scene({
  id,
  title,
  order,
  type = 'slide',
  actions = [],
}: {
  id: string;
  title: string;
  order: number;
  type?: Scene['type'];
  actions?: Scene['actions'];
}): Scene {
  return {
    id,
    stageId: 'stage-1',
    title,
    order,
    type,
    content:
      type === 'slide'
        ? {
            type: 'slide',
            canvas: { id, viewportSize: 1280, viewportRatio: 0.5625, elements: [] },
          }
        : type === 'quiz'
          ? { type: 'quiz', questions: [] }
          : type === 'interactive'
            ? { type: 'interactive', url: 'https://example.com' }
            : { type: 'pbl', projectConfig: {} },
    actions,
  } as Scene;
}

function frame({
  scene,
  index,
  file,
}: {
  scene: Scene;
  index: number;
  file: string;
}): VideoFrameEntry {
  return {
    index,
    sceneId: scene.id,
    sceneTitle: scene.title,
    sceneType: scene.type,
    file,
    renderMode: scene.type === 'slide' ? 'slide-snapshot' : 'placeholder',
    supportStatus: scene.type === 'slide' ? 'rendered' : 'placeholder',
    sceneFile: file.replace(/^frames\//, 'scenes/').replace(/\.png$/, '.json'),
    audio: [],
    html: { file: null, supported: false },
  };
}
