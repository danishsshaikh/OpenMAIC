import { describe, expect, it } from 'vitest';
import {
  computeTextFitScale as computeClassroomTextFitScale,
  MIN_SLIDE_TEXT_FIT_SCALE as CLASSROOM_MIN_SCALE,
} from '@/components/slide-renderer/components/element/TextElement/textAutoFit';
import {
  computeTextFitScale as computeSnapshotTextFitScale,
  MIN_SLIDE_TEXT_FIT_SCALE as SNAPSHOT_MIN_SCALE,
} from '../../packages/@openmaic/renderer/src/utils/textAutoFit';

describe('slide text auto-fit', () => {
  function expectBoth(availableHeight: number, contentHeight: number, expected: number) {
    expect(computeClassroomTextFitScale(availableHeight, contentHeight)).toBeCloseTo(expected, 3);
    expect(computeSnapshotTextFitScale(availableHeight, contentHeight)).toBeCloseTo(expected, 3);
  }

  it('keeps text at full size when it fits', () => {
    expectBoth(180, 160, 1);
    expectBoth(180, 181, 1);
  });

  it('shrinks overflowing bounded text proportionally', () => {
    expectBoth(160, 200, 0.8);
  });

  it('clamps to the readable minimum scale for dense generated cards', () => {
    expect(CLASSROOM_MIN_SCALE).toBe(SNAPSHOT_MIN_SCALE);
    expectBoth(120, 240, CLASSROOM_MIN_SCALE);
  });

  it('ignores invalid measurements safely', () => {
    expectBoth(0, 200, 1);
    expectBoth(200, 0, 1);
    expectBoth(Number.NaN, 200, 1);
  });
});
