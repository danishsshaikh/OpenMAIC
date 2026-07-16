export interface SpotlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpotlightFocusRect extends SpotlightRect {
  rx: number;
}

export interface SpotlightDimRect extends SpotlightRect {
  key: 'top' | 'bottom' | 'left' | 'right';
}

const STATIC_SPOTLIGHT_PADDING_X = 0.4;
const STATIC_SPOTLIGHT_PADDING_Y = 0.6;
const STATIC_SPOTLIGHT_RADIUS = 1;

export function getStaticSpotlightFocusRect(rect: SpotlightRect): SpotlightFocusRect | null {
  if (
    !isFiniteNumber(rect.x) ||
    !isFiniteNumber(rect.y) ||
    !isFiniteNumber(rect.w) ||
    !isFiniteNumber(rect.h) ||
    rect.w <= 0 ||
    rect.h <= 0
  ) {
    return null;
  }

  const x = clampPercent(rect.x - STATIC_SPOTLIGHT_PADDING_X);
  const y = clampPercent(rect.y - STATIC_SPOTLIGHT_PADDING_Y);
  const right = clampPercent(rect.x + rect.w + STATIC_SPOTLIGHT_PADDING_X);
  const bottom = clampPercent(rect.y + rect.h + STATIC_SPOTLIGHT_PADDING_Y);
  const w = Math.max(0, right - x);
  const h = Math.max(0, bottom - y);

  if (w <= 0 || h <= 0) return null;

  return {
    x,
    y,
    w,
    h,
    rx: Math.min(STATIC_SPOTLIGHT_RADIUS, w / 2, h / 2),
  };
}

export function getStaticSpotlightDimRects(
  focusRect: SpotlightFocusRect | null,
): SpotlightDimRect[] {
  if (!focusRect) return [];

  const left = clampPercent(focusRect.x);
  const top = clampPercent(focusRect.y);
  const right = clampPercent(focusRect.x + focusRect.w);
  const bottom = clampPercent(focusRect.y + focusRect.h);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);

  if (width <= 0 || height <= 0) return [];

  const dimRects: SpotlightDimRect[] = [
    { key: 'top', x: 0, y: 0, w: 100, h: top },
    { key: 'bottom', x: 0, y: bottom, w: 100, h: Math.max(0, 100 - bottom) },
    { key: 'left', x: 0, y: top, w: left, h: height },
    { key: 'right', x: right, y: top, w: Math.max(0, 100 - right), h: height },
  ];

  return dimRects.filter((rect) => rect.w > 0 && rect.h > 0);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}
