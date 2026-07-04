import { describe, expect, it } from 'vitest';
import type { Scene } from '@/lib/types/stage';
import {
  buildVideoFrameExportPlan,
  sanitizeVideoFrameFilenamePart,
  VideoFramePlanError,
} from '@/lib/export/video-frame-planner';
import {
  VIDEO_FRAME_EXPORT_TYPE,
  VIDEO_FRAME_EXPORT_VERSION,
} from '@/lib/export/video-frame-types';

describe('video frame export planner', () => {
  it('sorts scenes by order and writes ordered frame names', () => {
    const plan = buildVideoFrameExportPlan({
      stageTitle: 'Physics',
      exportedAt: '2026-07-04T00:00:00.000Z',
      scenes: [
        scene({ id: 'b', title: 'Second', order: 2 }),
        scene({ id: 'a', title: 'First', order: 1 }),
      ],
    });

    expect(plan.frames.map((frame) => frame.sceneId)).toEqual(['a', 'b']);
    expect(plan.frames.map((frame) => frame.file)).toEqual([
      'frames/001-first.png',
      'frames/002-second.png',
    ]);
    expect(plan.frames.map((frame) => frame.sceneFile)).toEqual([
      'scenes/001-first.json',
      'scenes/002-second.json',
    ]);
  });

  it('uses slide snapshots for slide scenes and placeholders for interactive scene types', () => {
    const plan = buildVideoFrameExportPlan({
      stageTitle: 'Mixed Course',
      scenes: [
        scene({ id: 'slide', title: 'Lecture', order: 1, type: 'slide' }),
        scene({ id: 'quiz', title: 'Quiz', order: 2, type: 'quiz' }),
        scene({ id: 'interactive', title: 'Widget', order: 3, type: 'interactive' }),
        scene({ id: 'pbl', title: 'Project', order: 4, type: 'pbl' }),
      ],
    });

    expect(plan.frames.map((frame) => frame.renderMode)).toEqual([
      'slide-snapshot',
      'placeholder',
      'placeholder',
      'placeholder',
    ]);
    expect(plan.frames.map((frame) => frame.file)).toEqual([
      'frames/001-lecture.png',
      'frames/002-quiz-placeholder.png',
      'frames/003-widget-placeholder.png',
      'frames/004-project-placeholder.png',
    ]);
  });

  it('preserves duplicate scene titles with order-prefixed safe filenames', () => {
    const plan = buildVideoFrameExportPlan({
      stageTitle: 'Duplicate Titles',
      scenes: [
        scene({ id: 'a', title: 'Intro', order: 1 }),
        scene({ id: 'b', title: 'Intro', order: 2 }),
      ],
    });

    expect(plan.frames.map((frame) => frame.file)).toEqual([
      'frames/001-intro.png',
      'frames/002-intro.png',
    ]);
  });

  it('sanitizes unsafe filename characters', () => {
    expect(sanitizeVideoFrameFilenamePart('  Newton: A/B? <Draft>  ')).toBe('newton-a-b-draft');
    expect(sanitizeVideoFrameFilenamePart('***')).toBe('scene');
  });

  it('includes frame metadata in manifest', () => {
    const plan = buildVideoFrameExportPlan({
      stageTitle: 'Manifest Course',
      exportedAt: '2026-07-04T00:00:00.000Z',
      scenes: [scene({ id: 's1', title: 'Intro', order: 1 })],
    });

    expect(plan.manifest).toMatchObject({
      version: VIDEO_FRAME_EXPORT_VERSION,
      exportType: VIDEO_FRAME_EXPORT_TYPE,
      stageTitle: 'Manifest Course',
      exportedAt: '2026-07-04T00:00:00.000Z',
      frames: [
        {
          index: 1,
          sceneId: 's1',
          sceneTitle: 'Intro',
          sceneType: 'slide',
          file: 'frames/001-intro.png',
          renderMode: 'slide-snapshot',
          sceneFile: 'scenes/001-intro.json',
          audio: [],
          html: {
            file: null,
            supported: false,
            reason: 'No reusable standalone HTML exporter exists for this scene type yet',
          },
        },
      ],
      media: [],
    });
  });

  it('plans interactive HTML sidecars when embedded HTML exists', () => {
    const plan = buildVideoFrameExportPlan({
      stageTitle: 'Interactive Course',
      scenes: [
        scene({
          id: 'interactive',
          title: 'Robot Helper: Quiz?',
          order: 7,
          type: 'interactive',
          html: '<!doctype html><html><body>Widget</body></html>',
        }),
      ],
    });

    expect(plan.frames[0].html).toEqual({
      file: 'html/001-robot-helper-quiz/index.html',
      supported: true,
    });
  });

  it('marks quiz and PBL HTML sidecars unsupported when no reusable exporter exists', () => {
    const plan = buildVideoFrameExportPlan({
      stageTitle: 'Unsupported HTML',
      scenes: [
        scene({ id: 'quiz', title: 'Quiz', order: 1, type: 'quiz' }),
        scene({ id: 'pbl', title: 'Project', order: 2, type: 'pbl' }),
      ],
    });

    expect(plan.frames.map((frame) => frame.html)).toEqual([
      {
        file: null,
        supported: false,
        reason: 'No reusable standalone HTML exporter exists for this scene type yet',
      },
      {
        file: null,
        supported: false,
        reason: 'No reusable standalone HTML exporter exists for this scene type yet',
      },
    ]);
  });

  it('plans speech audio sidecar entries without requiring cached audio', () => {
    const plan = buildVideoFrameExportPlan({
      stageTitle: 'Narrated Course',
      scenes: [
        scene({
          id: 's1',
          title: 'Intro',
          order: 1,
          actions: [
            { id: 'a1', type: 'speech', text: 'Hello', audioId: 'audio-1' },
            { id: 'a2', type: 'speech', text: 'No audio yet' },
            { id: 'a3', type: 'spotlight', elementId: 'shape-1' },
          ],
        }),
      ],
    });

    expect(plan.frames[0].audio).toEqual([
      {
        actionId: 'a1',
        actionIndex: 0,
        text: 'Hello',
        file: 'audio/001-intro/speech-001.mp3',
        missing: false,
      },
      {
        actionId: 'a2',
        actionIndex: 1,
        text: 'No audio yet',
        file: null,
        missing: true,
        reason: 'no audioId',
      },
    ]);
  });

  it('rejects empty scene lists', () => {
    expect(() => buildVideoFrameExportPlan({ stageTitle: 'Empty', scenes: [] })).toThrow(
      VideoFramePlanError,
    );
  });
});

function scene({
  id,
  title,
  order,
  type = 'slide',
  actions,
  html,
}: {
  id: string;
  title: string;
  order: number;
  type?: 'slide' | 'quiz' | 'interactive' | 'pbl';
  actions?: Scene['actions'];
  html?: string;
}): Scene {
  const content =
    type === 'slide'
      ? {
          type: 'slide',
          canvas: {
            id,
            viewportSize: 1280,
            viewportRatio: 0.5625,
            elements: [],
          },
        }
      : type === 'quiz'
        ? { type: 'quiz', questions: [] }
        : type === 'interactive'
          ? { type: 'interactive', url: 'https://example.com', ...(html ? { html } : {}) }
          : { type: 'pbl', projectConfig: {} };

  return {
    id,
    stageId: 'stage-1',
    title,
    order,
    type,
    content,
    actions,
  } as Scene;
}
