// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { buildLocalMp4SpeechSegmentVisualPlan } from '@/lib/export/mp4/planner';
import type { Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import {
  getRelativeSpotlightRect,
  getStaticSpotlightFocusRect,
  getStaticSpotlightPixelRect,
} from '../../packages/@openmaic/renderer/src/effects/spotlightGeometry';
import { resolveSpotlightMeasurementNode } from '../../packages/@openmaic/renderer/src/effects/SpotlightOverlay';

describe('MP4 spotlight export target resolution', () => {
  it('measures the precise text content node instead of the full slide wrapper', () => {
    const { root, target, content } = spotlightDomFixture({
      wrapper: rect(0, 0, 1280, 720),
      content: rect(115, 250, 310, 135),
    });

    const resolution = resolveSpotlightMeasurementNode({
      snapshotRoot: root,
      targetElement: target,
      elementId: 'shared-list',
    });
    const relative = getRelativeSpotlightRect(
      resolution.measurementElement.getBoundingClientRect(),
      rect(0, 0, 1280, 720),
    );
    const focus = getStaticSpotlightFocusRect(relative!, { width: 1280, height: 720 });
    const pixel = getStaticSpotlightPixelRect(focus, { width: 1280, height: 720 });

    expect(resolution.measurementElement).toBe(content);
    expect(resolution.selectorUsed).toBe('.element-content');
    expect(relative).toMatchObject({
      x: 8.984375,
      y: 34.72222222222222,
      w: 24.21875,
      h: 18.75,
    });
    expect(pixel).not.toBeNull();
    expect((pixel!.width * pixel!.height) / (1280 * 720)).toBeLessThan(0.08);
  });

  it('would expose the Memory Hierarchy regression if export measured the wrapper', () => {
    const wrapperRelative = getRelativeSpotlightRect(rect(0, 0, 1280, 720), rect(0, 0, 1280, 720));
    const preciseRelative = getRelativeSpotlightRect(
      rect(115, 250, 310, 135),
      rect(0, 0, 1280, 720),
    );

    expect(wrapperRelative).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect((preciseRelative!.w * preciseRelative!.h) / 10000).toBeLessThan(0.05);
  });

  it('keeps current narration-sync precise targets through the MP4 planner', () => {
    const scene = memoryHierarchyScene();
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes: [scene],
      frames: [
        {
          index: 1,
          sceneId: scene.id,
          sceneTitle: scene.title,
          sceneType: 'slide',
          renderMode: 'slide-snapshot',
          supportStatus: 'rendered',
          file: 'frames/001-memory.png',
          sceneFile: 'scenes/001-memory.json',
          audio: [],
          html: { supported: false, file: null },
        },
      ],
    });

    expect(plan.segments.map((segment) => segment.effects?.spotlight?.elementId)).toEqual([
      'shared-list',
      'private-list',
    ]);
    expect(plan.visualFrames.map((frame) => frame.effects?.spotlight?.elementId)).toEqual([
      'shared-list',
      'private-list',
    ]);
    expect(plan.segments.map((segment) => segment.effects?.spotlight?.elementId)).not.toContain(
      'shared-card',
    );
    expect(plan.segments.map((segment) => segment.effects?.spotlight?.elementId)).not.toContain(
      'private-card',
    );
    const exportLogs = consoleInfo.mock.calls
      .filter((call) => call[0] === '[SpotlightExportTrace]')
      .map((call) => call[1] as Record<string, unknown>);
    expect(exportLogs.map((log) => log.checkpoint)).toEqual(
      expect.arrayContaining(['saved-action-target', 'planner-effect-target']),
    );
    expect(exportLogs.filter((log) => log.checkpoint === 'planner-effect-target')).toEqual([
      expect.objectContaining({ elementId: 'shared-list' }),
      expect.objectContaining({ elementId: 'private-list' }),
    ]);

    consoleInfo.mockRestore();
  });

  it('keeps Runtime and Environment section targets precise through planner and geometry', () => {
    const scene = runtimeEnvironmentScene();
    const plan = buildLocalMp4SpeechSegmentVisualPlan({
      scenes: [scene],
      frames: [
        {
          index: 1,
          sceneId: scene.id,
          sceneTitle: scene.title,
          sceneType: 'slide',
          renderMode: 'slide-snapshot',
          supportStatus: 'rendered',
          file: 'frames/001-runtime.png',
          sceneFile: 'scenes/001-runtime.json',
          audio: [],
          html: { supported: false, file: null },
        },
      ],
    });

    expect(plan.segments.map((segment) => segment.effects?.spotlight?.elementId)).toEqual([
      'library-list',
      'environment-list',
      'advanced-tuning-list',
    ]);
    for (const elementId of ['library-list', 'environment-list', 'advanced-tuning-list']) {
      const element = slideElement(scene, elementId);
      const relative = getRelativeSpotlightRect(
        rect(element.left, element.top, element.width, element.height),
        rect(0, 0, 1000, 562.5),
      );
      const focus = getStaticSpotlightFocusRect(relative!, { width: 1280, height: 720 });
      const pixel = getStaticSpotlightPixelRect(focus, { width: 1280, height: 720 });
      expect(pixel).not.toBeNull();
      expect((pixel!.width * pixel!.height) / (1280 * 720)).toBeLessThan(0.18);
    }
  });
});

function spotlightDomFixture(bounds: { wrapper: DOMRect; content: DOMRect }) {
  const root = document.createElement('div');
  const target = document.createElement('div');
  target.id = 'slide-element-shared-list';
  target.dataset.elementId = 'shared-list';
  target.className = 'slide-element';
  target.getBoundingClientRect = () => bounds.wrapper;
  const content = document.createElement('div');
  content.className = 'element-content slide-renderer-prose';
  content.getBoundingClientRect = () => bounds.content;
  target.appendChild(content);
  root.appendChild(target);
  document.body.appendChild(root);
  return { root, target, content };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function memoryHierarchyScene(): Scene {
  return slideScene({
    id: 'memory',
    title: 'Memory Hierarchy: Global vs. Private',
    actions: [
      { id: 'spot-shared', type: 'spotlight', elementId: 'shared-list' },
      { id: 'speech-shared', type: 'speech', text: 'Shared scope narration.' },
      { id: 'spot-private', type: 'spotlight', elementId: 'private-list' },
      { id: 'speech-private', type: 'speech', text: 'Private scope narration.' },
    ] as Action[],
    elements: [
      element('memory-title', 'text', 56, 52, 820, 72),
      element('memory-subtitle', 'text', 56, 138, 760, 48),
      element('shared-card', 'shape', 90, 245, 410, 270),
      element('shared-heading', 'text', 230, 332, 180, 48),
      element('shared-list', 'text', 116, 350, 240, 112),
      element('private-card', 'shape', 570, 245, 410, 270),
      element('private-heading', 'text', 730, 332, 180, 48),
      element('private-list', 'text', 600, 350, 250, 112),
    ],
  });
}

function runtimeEnvironmentScene(): Scene {
  return slideScene({
    id: 'runtime',
    title: 'Runtime & Environment Variables',
    actions: [
      { id: 'spot-library', type: 'spotlight', elementId: 'library-list' },
      { id: 'speech-library', type: 'speech', text: 'Library narration.' },
      { id: 'spot-environment', type: 'spotlight', elementId: 'environment-list' },
      { id: 'speech-environment', type: 'speech', text: 'Environment narration.' },
      { id: 'spot-tuning', type: 'spotlight', elementId: 'advanced-tuning-list' },
      { id: 'speech-tuning', type: 'speech', text: 'Advanced tuning narration.' },
    ] as Action[],
    elements: [
      element('runtime-title', 'text', 64, 56, 760, 72),
      element('library-card', 'shape', 64, 172, 410, 260),
      element('library-heading', 'text', 92, 204, 250, 48),
      element('library-list', 'text', 110, 294, 300, 120),
      element('environment-card', 'shape', 530, 172, 410, 260),
      element('environment-heading', 'text', 558, 204, 310, 48),
      element('environment-list', 'text', 584, 294, 300, 120),
      element('advanced-tuning-block', 'text', 64, 455, 310, 48),
      element('advanced-tuning-list', 'text', 96, 510, 660, 88),
    ],
  });
}

function slideScene(input: {
  id: string;
  title: string;
  actions: Action[];
  elements: Array<Record<string, unknown>>;
}): Scene {
  return {
    id: input.id,
    stageId: 'stage',
    title: input.title,
    type: 'slide',
    order: 1,
    actions: input.actions,
    content: {
      type: 'slide',
      canvas: {
        id: `${input.id}-canvas`,
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme: {
          backgroundColor: '#ffffff',
          themeColors: ['#2b58a8'],
          fontColor: '#111111',
          fontName: 'Arial',
        },
        elements: input.elements,
      },
    },
  } as unknown as Scene;
}

function element(
  id: string,
  type: 'text' | 'shape',
  left: number,
  top: number,
  width: number,
  height: number,
) {
  return { id, type, left, top, width, height, rotate: 0 };
}

function slideElement(scene: Scene, elementId: string) {
  if (scene.content.type !== 'slide') throw new Error('expected slide');
  const found = scene.content.canvas.elements.find((item) => item.id === elementId);
  if (!found) throw new Error(`missing element ${elementId}`);
  return found as unknown as { left: number; top: number; width: number; height: number };
}
