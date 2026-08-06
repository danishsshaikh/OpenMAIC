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

export interface SpotlightViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SpotlightViewportSize {
  width: number;
  height: number;
}

export interface SpotlightPixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const STATIC_SPOTLIGHT_PADDING_X = 0.4;
const STATIC_SPOTLIGHT_PADDING_Y = 0.6;
const STATIC_SPOTLIGHT_RADIUS = 1;

export function getRelativeSpotlightRect(
  targetRect: SpotlightViewportRect,
  containerRect: SpotlightViewportRect,
): SpotlightRect | null {
  if (!isFiniteViewportRect(targetRect) || !isFiniteViewportRect(containerRect)) {
    return null;
  }
  if (containerRect.width <= 0 || containerRect.height <= 0) return null;
  if (targetRect.width <= 0 || targetRect.height <= 0) return null;

  const localLeft = targetRect.left - containerRect.left;
  const localTop = targetRect.top - containerRect.top;
  const localRight = targetRect.right - containerRect.left;
  const localBottom = targetRect.bottom - containerRect.top;
  const localWidth = localRight - localLeft;
  const localHeight = localBottom - localTop;

  if (
    !isFiniteNumber(localLeft) ||
    !isFiniteNumber(localTop) ||
    !isFiniteNumber(localWidth) ||
    !isFiniteNumber(localHeight) ||
    localWidth <= 0 ||
    localHeight <= 0
  ) {
    return null;
  }

  return {
    x: (localLeft / containerRect.width) * 100,
    y: (localTop / containerRect.height) * 100,
    w: (localWidth / containerRect.width) * 100,
    h: (localHeight / containerRect.height) * 100,
  };
}

export function getStaticSpotlightFocusRect(
  rect: SpotlightRect,
  viewport?: SpotlightViewportSize,
): SpotlightFocusRect | null {
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

  let x = clampPercent(rect.x - STATIC_SPOTLIGHT_PADDING_X);
  let y = clampPercent(rect.y - STATIC_SPOTLIGHT_PADDING_Y);
  let right = clampPercent(rect.x + rect.w + STATIC_SPOTLIGHT_PADDING_X);
  let bottom = clampPercent(rect.y + rect.h + STATIC_SPOTLIGHT_PADDING_Y);

  if (viewport && viewport.width > 0 && viewport.height > 0) {
    const leftPx = Math.floor((x / 100) * viewport.width);
    const topPx = Math.floor((y / 100) * viewport.height);
    const rightPx = Math.ceil((right / 100) * viewport.width);
    const bottomPx = Math.ceil((bottom / 100) * viewport.height);
    x = clampPercent((leftPx / viewport.width) * 100);
    y = clampPercent((topPx / viewport.height) * 100);
    right = clampPercent((rightPx / viewport.width) * 100);
    bottom = clampPercent((bottomPx / viewport.height) * 100);
  }
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

export function getStaticSpotlightPixelRect(
  focusRect: Pick<SpotlightRect, 'x' | 'y' | 'w' | 'h'> | null,
  viewport: SpotlightViewportSize,
): SpotlightPixelRect | null {
  if (
    !focusRect ||
    !isFiniteNumber(viewport.width) ||
    !isFiniteNumber(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !isFiniteNumber(focusRect.x) ||
    !isFiniteNumber(focusRect.y) ||
    !isFiniteNumber(focusRect.w) ||
    !isFiniteNumber(focusRect.h) ||
    focusRect.w <= 0 ||
    focusRect.h <= 0
  ) {
    return null;
  }

  const left = Math.max(0, Math.floor((focusRect.x / 100) * viewport.width));
  const top = Math.max(0, Math.floor((focusRect.y / 100) * viewport.height));
  const right = Math.min(
    viewport.width,
    Math.ceil(((focusRect.x + focusRect.w) / 100) * viewport.width),
  );
  const bottom = Math.min(
    viewport.height,
    Math.ceil(((focusRect.y + focusRect.h) / 100) * viewport.height),
  );

  if (left >= right || top >= bottom) return null;

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function applyStaticSpotlightDimToRgba(
  base: Uint8ClampedArray,
  viewport: SpotlightViewportSize,
  focusRect: SpotlightPixelRect | null,
  dimOpacity: number,
): Uint8ClampedArray {
  const width = Math.max(0, Math.floor(viewport.width));
  const height = Math.max(0, Math.floor(viewport.height));
  const out = new Uint8ClampedArray(base);
  if (!focusRect || width <= 0 || height <= 0) return out;

  const alpha = Math.max(0, Math.min(1, dimOpacity));
  const factor = 1 - alpha;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        x >= focusRect.left &&
        x < focusRect.right &&
        y >= focusRect.top &&
        y < focusRect.bottom
      ) {
        continue;
      }
      const index = (y * width + x) * 4;
      out[index] = Math.round(out[index] * factor);
      out[index + 1] = Math.round(out[index + 1] * factor);
      out[index + 2] = Math.round(out[index + 2] * factor);
    }
  }
  return out;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isFiniteViewportRect(rect: SpotlightViewportRect): boolean {
  return (
    isFiniteNumber(rect.left) &&
    isFiniteNumber(rect.top) &&
    isFiniteNumber(rect.right) &&
    isFiniteNumber(rect.bottom) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height)
  );
}
