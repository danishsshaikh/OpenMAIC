import { describe, expect, it } from 'vitest';
import {
  getRelativeSpotlightRect,
  getStaticSpotlightDimRects,
  getStaticSpotlightFocusRect,
} from '../../packages/@openmaic/renderer/src/effects/spotlightGeometry';

describe('static spotlight geometry', () => {
  it('normalizes target bounds relative to the container origin', () => {
    const atOrigin = getRelativeSpotlightRect(
      rect({ left: 200, top: 250, width: 400, height: 200 }),
      rect({ left: 0, top: 0, width: 1600, height: 900 }),
    );
    const offscreen = getRelativeSpotlightRect(
      rect({ left: 10200, top: 550, width: 400, height: 200 }),
      rect({ left: 10000, top: 300, width: 1600, height: 900 }),
    );

    expect(offscreen).toEqual(atOrigin);
    expect(atOrigin).toEqual({
      x: 12.5,
      y: 27.77777777777778,
      w: 25,
      h: 22.22222222222222,
    });
  });

  it('keeps relative geometry invariant for negative offsets and page scroll translations', () => {
    const negativeOffset = getRelativeSpotlightRect(
      rect({ left: -780, top: -120, width: 300, height: 180 }),
      rect({ left: -1000, top: -400, width: 1000, height: 562.5 }),
    );
    const scrolled = getRelativeSpotlightRect(
      rect({ left: 220, top: 880, width: 300, height: 180 }),
      rect({ left: 0, top: 600, width: 1000, height: 562.5 }),
    );

    expect(negativeOffset).toEqual(scrolled);
    expect(scrolled).toEqual({ x: 22, y: 49.77777777777778, w: 30, h: 32 });
  });

  it('normalizes scaled target and container rectangles without dividing by scale twice', () => {
    const unscaled = getRelativeSpotlightRect(
      rect({ left: 120, top: 80, width: 240, height: 120 }),
      rect({ left: 0, top: 0, width: 1200, height: 675 }),
    );
    const scaled = getRelativeSpotlightRect(
      rect({ left: 560, top: 410, width: 120, height: 60 }),
      rect({ left: 500, top: 370, width: 600, height: 337.5 }),
    );

    expect(scaled).toEqual(unscaled);
  });

  it('lets focus padding clamp targets near slide edges', () => {
    const topLeft = getStaticSpotlightFocusRect(
      getRelativeSpotlightRect(
        rect({ left: 0, top: 0, width: 50, height: 40 }),
        rect({ left: 0, top: 0, width: 1000, height: 500 }),
      )!,
    );
    const bottomRight = getStaticSpotlightFocusRect(
      getRelativeSpotlightRect(
        rect({ left: 950, top: 460, width: 50, height: 40 }),
        rect({ left: 0, top: 0, width: 1000, height: 500 }),
      )!,
    );

    expect(topLeft).toMatchObject({ x: 0, y: 0 });
    expect(topLeft!.w).toBeCloseTo(5.4);
    expect(topLeft!.h).toBeCloseTo(8.6);
    expect(bottomRight!.x + bottomRight!.w).toBe(100);
    expect(bottomRight!.y + bottomRight!.h).toBe(100);
  });

  it('drops invalid viewport geometry before static focus generation', () => {
    expect(
      getRelativeSpotlightRect(
        rect({ left: 10, top: 10, width: 100, height: 100 }),
        rect({ left: 0, top: 0, width: 0, height: 500 }),
      ),
    ).toBeNull();
    expect(
      getRelativeSpotlightRect(
        rect({ left: 10, top: 10, width: 0, height: 100 }),
        rect({ left: 0, top: 0, width: 1000, height: 500 }),
      ),
    ).toBeNull();
    expect(
      getRelativeSpotlightRect(
        rect({ left: Number.NaN, top: 10, width: 100, height: 100 }),
        rect({ left: 0, top: 0, width: 1000, height: 500 }),
      ),
    ).toBeNull();
    expect(
      getRelativeSpotlightRect(
        rect({ left: 10, top: 10, width: 100, height: 100 }),
        rect({ left: 0, top: 0, width: Infinity, height: 500 }),
      ),
    ).toBeNull();
  });

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

function rect({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}
