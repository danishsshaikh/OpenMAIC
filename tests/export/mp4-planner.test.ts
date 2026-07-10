import { describe, expect, it } from 'vitest';
import {
  buildLocalMp4SpeechSegmentVisualPlan,
  buildLocalMp4Manifest,
  buildLocalMp4VisualFrameFile,
  clampOpacity,
  normalizeLaserColor,
  sanitizeMp4PathPart,
  speechAudioLookupIds,
} from '@/lib/export/mp4/planner';
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
    expect(plan.manifest.segments[0]).not.toHaveProperty('text');
  });

  it('assigns spotlight to the following speech segment only', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'Intro',
        order: 1,
        actions: [
          { id: 'speech-1', type: 'speech', text: 'First' },
          { id: 'spotlight-1', type: 'spotlight', elementId: 'card-1', dimOpacity: 0.4 },
          { id: 'speech-2', type: 'speech', text: 'Second' },
          { id: 'speech-3', type: 'speech', text: 'Third' },
        ],
        elements: [{ id: 'card-1', left: 10, top: 10, width: 100, height: 80 }],
      }),
    ];

    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes,
      frames: [frame({ scene: scenes[0], index: 1, file: 'frames/001-intro.png' })],
    });

    expect(plan.segments.map((segment) => segment.effects)).toEqual([
      undefined,
      { spotlight: { elementId: 'card-1', dimOpacity: 0.4 } },
      undefined,
    ]);
    expect(plan.stats.assignedEffects).toBe(1);
  });

  it('assigns laser to the following speech segment as a static target marker', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'Intro',
        order: 1,
        actions: [
          { id: 'laser-1', type: 'laser', elementId: 'card-1', color: 'red' },
          { id: 'speech-1', type: 'speech', text: 'Point here' },
        ],
        elements: [{ id: 'card-1', left: 10, top: 10, width: 100, height: 80 }],
      }),
    ];

    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes,
      frames: [frame({ scene: scenes[0], index: 1, file: 'frames/001-intro.png' })],
    });

    expect(plan.segments[0].effects).toEqual({
      laser: { elementId: 'card-1', color: '#ff0000' },
    });
  });

  it('combines compatible pending effects on the same speech segment', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'Intro',
        order: 1,
        actions: [
          { id: 'spotlight-1', type: 'spotlight', elementId: 'card-1' },
          { id: 'laser-1', type: 'laser', elementId: 'card-2', color: '#00ff00' },
          { id: 'speech-1', type: 'speech', text: 'Compare these' },
        ],
        elements: [
          { id: 'card-1', left: 10, top: 10, width: 100, height: 80 },
          { id: 'card-2', left: 130, top: 10, width: 100, height: 80 },
        ],
      }),
    ];

    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes,
      frames: [frame({ scene: scenes[0], index: 1, file: 'frames/001-intro.png' })],
    });

    expect(plan.segments[0].effects).toEqual({
      spotlight: { elementId: 'card-1', dimOpacity: undefined },
      laser: { elementId: 'card-2', color: '#00ff00' },
    });
  });

  it('uses the latest pending effect of the same type before speech', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'Intro',
        order: 1,
        actions: [
          { id: 'spotlight-1', type: 'spotlight', elementId: 'card-1' },
          { id: 'spotlight-2', type: 'spotlight', elementId: 'card-2' },
          { id: 'speech-1', type: 'speech', text: 'Latest wins' },
        ],
        elements: [
          { id: 'card-1', left: 10, top: 10, width: 100, height: 80 },
          { id: 'card-2', left: 130, top: 10, width: 100, height: 80 },
        ],
      }),
    ];

    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes,
      frames: [frame({ scene: scenes[0], index: 1, file: 'frames/001-intro.png' })],
    });

    expect(plan.segments[0].effects).toEqual({
      spotlight: { elementId: 'card-2', dimOpacity: undefined },
    });
  });

  it('does not carry effects across scene boundaries', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'First',
        order: 1,
        actions: [{ id: 'spotlight-1', type: 'spotlight', elementId: 'card-1' }],
        elements: [{ id: 'card-1', left: 10, top: 10, width: 100, height: 80 }],
      }),
      scene({
        id: 's2',
        title: 'Second',
        order: 2,
        actions: [{ id: 'speech-1', type: 'speech', text: 'New scene' }],
      }),
    ];

    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes,
      frames: [
        frame({ scene: scenes[0], index: 1, file: 'frames/001-first.png' }),
        frame({ scene: scenes[1], index: 2, file: 'frames/002-second.png' }),
      ],
    });

    expect(plan.segments[0].effects).toBeUndefined();
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({
        sceneId: 's1',
        actionIndex: 0,
        actionType: 'spotlight',
        reason: 'teaching effect omitted: no following speech segment',
      }),
    );
  });

  it('omits visual-only effects with no following speech as diagnostics', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'Intro',
        order: 1,
        actions: [{ id: 'laser-1', type: 'laser', elementId: 'card-1' }],
        elements: [{ id: 'card-1', left: 10, top: 10, width: 100, height: 80 }],
      }),
    ];

    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes,
      frames: [frame({ scene: scenes[0], index: 1, file: 'frames/001-intro.png' })],
    });

    expect(plan.segments).toEqual([]);
    expect(plan.warnings).toEqual([
      expect.objectContaining({
        sceneIndex: 1,
        actionIndex: 0,
        actionType: 'laser',
        reason: 'teaching effect omitted: no following speech segment',
      }),
    ]);
    expect(plan.stats.omittedEffects).toBe(1);
  });

  it('omits missing effect targets without failing the segment plan', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'Intro',
        order: 1,
        actions: [
          { id: 'spotlight-1', type: 'spotlight', elementId: 'missing-card' },
          { id: 'speech-1', type: 'speech', text: 'Fallback to base frame' },
        ],
      }),
    ];

    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes,
      frames: [frame({ scene: scenes[0], index: 1, file: 'frames/001-intro.png' })],
    });

    expect(plan.segments[0].effects).toBeUndefined();
    expect(plan.warnings).toEqual([
      expect.objectContaining({
        actionIndex: 0,
        actionType: 'spotlight',
        reason: 'teaching effect omitted: target missing',
      }),
    ]);
  });

  it('creates distinct frame identities for different effects and reuses identical ones', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'Intro',
        order: 1,
        actions: [
          { id: 'spotlight-1', type: 'spotlight', elementId: 'card-1' },
          { id: 'speech-1', type: 'speech', text: 'First' },
          { id: 'spotlight-2', type: 'spotlight', elementId: 'card-2' },
          { id: 'speech-2', type: 'speech', text: 'Second' },
          { id: 'spotlight-3', type: 'spotlight', elementId: 'card-1' },
          { id: 'speech-3', type: 'speech', text: 'Third' },
        ],
        elements: [
          { id: 'card-1', left: 10, top: 10, width: 100, height: 80 },
          { id: 'card-2', left: 130, top: 10, width: 100, height: 80 },
        ],
      }),
    ];

    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes,
      frames: [frame({ scene: scenes[0], index: 1, file: 'frames/001-intro.png' })],
    });

    expect(plan.segments[0].frameKey).toBe(plan.segments[2].frameKey);
    expect(plan.segments[0].frameKey).not.toBe(plan.segments[1].frameKey);
    expect(plan.visualFrames).toHaveLength(2);
  });

  it('keeps existing speech-only planning on base frames', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'Intro',
        order: 1,
        actions: [
          { id: 'speech-1', type: 'speech', text: 'First' },
          { id: 'speech-2', type: 'speech', text: 'Second' },
        ],
      }),
    ];

    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes,
      frames: [frame({ scene: scenes[0], index: 1, file: 'frames/001-intro.png' })],
    });

    expect(plan.segments.map((segment) => segment.frameFile)).toEqual([
      'frames/001-intro.png',
      'frames/001-intro.png',
    ]);
    expect(plan.visualFrames).toHaveLength(1);
    expect(plan.stats).toMatchObject({
      spotlightActions: 0,
      laserActions: 0,
      assignedEffects: 0,
      omittedEffects: 0,
      uniqueEffectFrames: 0,
    });
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

  it('reports missing cached audio separately when a speech action has an audioId', () => {
    const scenes = [
      scene({
        id: 's1',
        title: 'Intro',
        order: 1,
        actions: [{ id: 'a1', type: 'speech', text: 'Generated line', audioId: 'tts_s1_a1' }],
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

    expect(plan.missingAudio).toEqual([
      {
        sceneId: 's1',
        sceneTitle: 'Intro',
        actionId: 'a1',
        actionIndex: 0,
        reason: 'generated audio file not found',
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
        sceneIndex: 1,
        reason: 'scene has no exportable generated narration audio and is omitted from MP4 timing',
      },
    ]);
  });

  it('sanitizes local MP4 path parts', () => {
    expect(sanitizeMp4PathPart('  Intro: A/B?  ')).toBe('intro-a-b');
  });

  it('checks stamped, canonical, and legacy generated TTS cache ids', () => {
    expect(speechAudioLookupIds(3, { id: 'speech-1', audioId: 'custom-audio' })).toEqual([
      'custom-audio',
      'tts_s3_speech-1',
      'tts_speech-1',
    ]);
    expect(speechAudioLookupIds(3, { id: 'speech-1', audioId: 'tts_s3_speech-1' })).toEqual([
      'tts_s3_speech-1',
      'tts_speech-1',
    ]);
  });

  it('builds deterministic effect frame file names without classroom text', () => {
    expect(
      buildLocalMp4VisualFrameFile('frames/001-intro.png', {
        spotlight: { elementId: 'card-1', dimOpacity: 0.5 },
      }),
    ).toMatch(/^frames\/001-intro-fx-[a-z0-9]+\.png$/);
  });

  it('normalizes visual effect values for snapshot rendering', () => {
    expect(clampOpacity(-1)).toBe(0);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity(Number.NaN)).toBeUndefined();
    expect(normalizeLaserColor('red')).toBe('#ff0000');
    expect(normalizeLaserColor('not-a-color')).toBeUndefined();
  });
});

function scene({
  id,
  title,
  order,
  type = 'slide',
  actions = [],
  elements = [],
}: {
  id: string;
  title: string;
  order: number;
  type?: Scene['type'];
  actions?: Scene['actions'];
  elements?: Array<{ id: string; left: number; top: number; width: number; height: number }>;
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
            canvas: { id, viewportSize: 1280, viewportRatio: 0.5625, elements },
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
