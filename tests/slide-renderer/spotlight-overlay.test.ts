import { describe, expect, it } from 'vitest';
import { getStaticSpotlightFocusRect } from '../../packages/@openmaic/renderer/src/effects/spotlightGeometry';

describe('static spotlight geometry', () => {
  it('expands the focus rect using the same final padding as classroom spotlight', () => {
    const rect = getStaticSpotlightFocusRect({ x: 10, y: 20, w: 30, h: 40 });

    expect(rect).not.toBeNull();
    expect(rect!.x).toBeCloseTo(9.6);
    expect(rect!.y).toBeCloseTo(19.4);
    expect(rect!.w).toBeCloseTo(30.8);
    expect(rect!.h).toBeCloseTo(41.2);
    expect(rect!.rx).toBe(1);
  });

  it('clamps the focus rect to the slide coordinate space', () => {
    expect(getStaticSpotlightFocusRect({ x: 0.2, y: 0.3, w: 99.7, h: 99.8 })).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rx: 1,
    });
  });

  it('drops invalid target geometry so exports fall back to the base frame', () => {
    expect(getStaticSpotlightFocusRect({ x: 10, y: 10, w: 0, h: 12 })).toBeNull();
    expect(getStaticSpotlightFocusRect({ x: Number.NaN, y: 10, w: 12, h: 12 })).toBeNull();
  });

  it('keeps the rounded focus radius inside tiny targets', () => {
    const rect = getStaticSpotlightFocusRect({ x: 50, y: 50, w: 0.8, h: 0.6 });

    expect(rect).not.toBeNull();
    expect(rect!.x).toBeCloseTo(49.6);
    expect(rect!.y).toBeCloseTo(49.4);
    expect(rect!.w).toBeCloseTo(1.6);
    expect(rect!.h).toBeCloseTo(1.8);
    expect(rect!.rx).toBeCloseTo(0.8);
  });
});
