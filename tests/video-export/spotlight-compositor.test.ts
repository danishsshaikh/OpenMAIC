import { describe, expect, it } from 'vitest';
import {
  applyStaticSpotlightDimToRgba,
  getRelativeSpotlightRect,
  getStaticSpotlightFocusRect,
  getStaticSpotlightPixelRect,
  type SpotlightPixelRect,
} from '../../packages/@openmaic/renderer/src/effects/spotlightGeometry';

const WIDTH = 16;
const HEIGHT = 12;
const DIM_OPACITY = 0.7;
const BASE_VALUE = 200;
const DIMMED_VALUE = 60;

describe('static spotlight compositor', () => {
  it('keeps focus pixels unchanged and outside pixels uniformly dimmed', () => {
    const { base, out, focus } = renderFixture();

    expect(pixel(out, focus.left, focus.top)).toEqual(pixel(base, focus.left, focus.top));
    expect(pixel(out, focus.right - 1, focus.bottom - 1)).toEqual(
      pixel(base, focus.right - 1, focus.bottom - 1),
    );
    expect(pixel(out, 0, 0)).toEqual([DIMMED_VALUE, DIMMED_VALUE, DIMMED_VALUE, 255]);
    expect(pixel(out, WIDTH - 1, HEIGHT - 1)).toEqual([
      DIMMED_VALUE,
      DIMMED_VALUE,
      DIMMED_VALUE,
      255,
    ]);
  });

  it('has no top or bottom boundary rays extending outward', () => {
    const { out, focus } = renderFixture();

    expect(rowValues(out, focus.top - 1)).toEqual(repeated(DIMMED_VALUE, WIDTH));
    expect(rowValues(out, focus.bottom)).toEqual(repeated(DIMMED_VALUE, WIDTH));
  });

  it('has no left or right boundary rays extending outward', () => {
    const { out, focus } = renderFixture();

    expect(columnValues(out, focus.left - 1)).toEqual(repeated(DIMMED_VALUE, HEIGHT));
    expect(columnValues(out, focus.right)).toEqual(repeated(DIMMED_VALUE, HEIGHT));
  });

  it('does not double-dim overlaps or leave one-pixel bright gaps', () => {
    const { out, focus } = renderFixture();
    const outside = [
      ...rowValues(out, 0),
      ...rowValues(out, focus.top - 1),
      ...rowValues(out, focus.bottom),
      ...columnValues(out, 0),
      ...columnValues(out, focus.left - 1),
      ...columnValues(out, focus.right),
    ];

    expect(new Set(outside)).toEqual(new Set([DIMMED_VALUE]));
  });

  it('uses shared floor/ceil output-pixel bounds', () => {
    const focus = getStaticSpotlightPixelRect(
      { x: 24.2, y: 20.1, w: 39.5, h: 44.4 },
      { width: WIDTH, height: HEIGHT },
    );

    expect(focus).toEqual({
      left: 3,
      top: 2,
      right: 11,
      bottom: 8,
      width: 8,
      height: 6,
    });
  });

  it('is invariant under snapshot mount translation', () => {
    const target = { left: 40, top: 30, right: 120, bottom: 90, width: 80, height: 60 };
    const container = { left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100 };
    const shiftedTarget = {
      left: 1040,
      top: 30,
      right: 1120,
      bottom: 90,
      width: 80,
      height: 60,
    };
    const shiftedContainer = {
      left: 1010,
      top: 20,
      right: 1210,
      bottom: 120,
      width: 200,
      height: 100,
    };

    expect(getRelativeSpotlightRect(target, container)).toEqual(
      getRelativeSpotlightRect(shiftedTarget, shiftedContainer),
    );
  });

  it('leaves non-spotlight and invalid spotlight frames byte-equivalent to the base', () => {
    const base = rgbaFixture();
    const unchanged = applyStaticSpotlightDimToRgba(
      base,
      { width: WIDTH, height: HEIGHT },
      null,
      0.7,
    );
    const invalid = getStaticSpotlightPixelRect(
      { x: 20, y: 20, w: 0, h: 20 },
      {
        width: WIDTH,
        height: HEIGHT,
      },
    );

    expect([...unchanged]).toEqual([...base]);
    expect(invalid).toBeNull();
  });

  it('keeps laser-only rendering outside the spotlight compositor path', () => {
    const base = rgbaFixture();
    const laserOnly = applyStaticSpotlightDimToRgba(
      base,
      { width: WIDTH, height: HEIGHT },
      null,
      DIM_OPACITY,
    );

    expect([...laserOnly]).toEqual([...base]);
  });
});

function renderFixture(): {
  base: Uint8ClampedArray;
  out: Uint8ClampedArray;
  focus: SpotlightPixelRect;
} {
  const focusPercent = getStaticSpotlightFocusRect(
    { x: 31.25, y: 25, w: 25, h: 33.33 },
    { width: WIDTH, height: HEIGHT },
  );
  const focus = getStaticSpotlightPixelRect(focusPercent, { width: WIDTH, height: HEIGHT });
  if (!focus) throw new Error('expected valid focus rect');
  const base = rgbaFixture();
  return {
    base,
    focus,
    out: applyStaticSpotlightDimToRgba(base, { width: WIDTH, height: HEIGHT }, focus, DIM_OPACITY),
  };
}

function rgbaFixture(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = BASE_VALUE;
    data[index + 1] = BASE_VALUE;
    data[index + 2] = BASE_VALUE;
    data[index + 3] = 255;
  }
  return data;
}

function pixel(data: Uint8ClampedArray, x: number, y: number): number[] {
  const index = (y * WIDTH + x) * 4;
  return [data[index], data[index + 1], data[index + 2], data[index + 3]];
}

function rowValues(data: Uint8ClampedArray, y: number): number[] {
  return Array.from({ length: WIDTH }, (_, x) => pixel(data, x, y)[0]);
}

function columnValues(data: Uint8ClampedArray, x: number): number[] {
  return Array.from({ length: HEIGHT }, (_, y) => pixel(data, x, y)[0]);
}

function repeated(value: number, length: number): number[] {
  return Array.from({ length }, () => value);
}
