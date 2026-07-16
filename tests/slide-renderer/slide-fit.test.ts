import { describe, expect, it } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import {
  computeSlideFitTransform as computeClassroomSlideFitTransform,
  getSlideElementsBounds as getClassroomSlideElementsBounds,
  transformPercentageGeometry,
} from '@/components/slide-renderer/utils/slideFit';
import {
  computeSlideFitTransform as computeSnapshotSlideFitTransform,
  getSlideElementsBounds as getSnapshotSlideElementsBounds,
} from '../../packages/@openmaic/renderer/src/utils/slideFit';

function element(id: string, left: number, top: number, width: number, height: number): PPTElement {
  return { id, type: 'shape', left, top, width, height, rotate: 0 } as unknown as PPTElement;
}

function transformedBottom(elements: PPTElement[], viewportWidth: number, viewportHeight: number) {
  const fit = computeClassroomSlideFitTransform(elements, viewportWidth, viewportHeight);
  const bounds = getClassroomSlideElementsBounds(elements);
  if (!bounds) throw new Error('missing bounds');
  return bounds.bottom * fit.scale + fit.translateY;
}

describe('slide layout fitting', () => {
  it('keeps classroom and snapshot fit math aligned', () => {
    const elements = [
      element('a', 120, 120, 420, 220),
      element('b', 620, 120, 420, 220),
      element('c', 120, 560, 420, 240),
      element('d', 620, 560, 420, 240),
    ];

    expect(computeClassroomSlideFitTransform(elements, 1280, 720)).toEqual(
      computeSnapshotSlideFitTransform(elements, 1280, 720),
    );
    expect(getClassroomSlideElementsBounds(elements)).toEqual(
      getSnapshotSlideElementsBounds(elements),
    );
  });

  it('scales and recenters overflowing card groups inside the slide safe area', () => {
    const elements = [
      element('top-left', 120, 120, 420, 220),
      element('top-right', 620, 120, 420, 220),
      element('bottom-left', 120, 560, 420, 240),
      element('bottom-right', 620, 560, 420, 240),
    ];

    const fit = computeClassroomSlideFitTransform(elements, 1280, 720);

    expect(fit.scale).toBeLessThan(1);
    expect(transformedBottom(elements, 1280, 720)).toBeLessThanOrEqual(720 - 43.2 + 0.1);
  });

  it('leaves already-contained layouts unchanged', () => {
    const elements = [
      element('top-left', 180, 120, 360, 180),
      element('top-right', 620, 120, 360, 180),
      element('bottom-left', 180, 360, 360, 180),
      element('bottom-right', 620, 360, 360, 180),
    ];

    expect(computeClassroomSlideFitTransform(elements, 1280, 720)).toMatchObject({
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
  });

  it('applies the same fit to percentage overlay geometry', () => {
    const elements = [
      element('top-left', 120, 120, 420, 220),
      element('bottom-right', 620, 560, 420, 240),
    ];
    const fit = computeClassroomSlideFitTransform(elements, 1280, 720);
    const geometry = transformPercentageGeometry(
      { x: 48.4, y: 77.8, w: 32.8, h: 33.3, centerX: 64.8, centerY: 94.45 },
      fit,
      1280,
      720,
    );

    expect(geometry).not.toBeNull();
    expect(geometry!.centerY).toBeLessThan(95);
  });
});
