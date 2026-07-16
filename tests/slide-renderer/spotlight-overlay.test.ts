import { describe, expect, it } from 'vitest';
import {
  getStaticSpotlightDimRects,
  getStaticSpotlightFocusRect,
} from '../../packages/@openmaic/renderer/src/effects/spotlightGeometry';

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

  it('builds ordinary dim rectangles around the focus rect for static snapshots', () => {
    const focus = getStaticSpotlightFocusRect({ x: 25, y: 20, w: 30, h: 25 });
    const dimRects = getStaticSpotlightDimRects(focus);

    expect(dimRects.map((rect) => rect.key)).toEqual(['top', 'bottom', 'left', 'right']);
    expect(dimRects[0]).toMatchObject({ x: 0, y: 0, w: 100 });
    expect(dimRects[0].h).toBeCloseTo(19.4);
    expect(dimRects[1]).toMatchObject({ x: 0, w: 100 });
    expect(dimRects[1].y).toBeCloseTo(45.6);
    expect(dimRects[1].h).toBeCloseTo(54.4);
    expect(dimRects[2]).toMatchObject({ x: 0 });
    expect(dimRects[2].y).toBeCloseTo(19.4);
    expect(dimRects[2].w).toBeCloseTo(24.6);
    expect(dimRects[2].h).toBeCloseTo(26.2);
    expect(dimRects[3].x).toBeCloseTo(55.4);
    expect(dimRects[3].y).toBeCloseTo(19.4);
    expect(dimRects[3].w).toBeCloseTo(44.6);
    expect(dimRects[3].h).toBeCloseTo(26.2);
  });

  it('does not create dim rectangles for invalid focus geometry', () => {
    expect(getStaticSpotlightDimRects(null)).toEqual([]);
    expect(getStaticSpotlightDimRects({ x: 10, y: 10, w: 0, h: 12, rx: 0 })).toEqual([]);
  });
});
