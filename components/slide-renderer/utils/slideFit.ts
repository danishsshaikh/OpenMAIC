import type { PPTElement } from '@openmaic/dsl';
import type { PercentageGeometry } from '@/lib/types/action';

export interface SlideFitTransform {
  scale: number;
  translateX: number;
  translateY: number;
  cssTransform: string;
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const EPSILON = 0.01;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getElementBounds(element: PPTElement): Bounds | null {
  if (!isFiniteNumber(element.left) || !isFiniteNumber(element.top)) return null;

  if (element.type === 'line') {
    const x1 = element.left + element.start[0];
    const y1 = element.top + element.start[1];
    const x2 = element.left + element.end[0];
    const y2 = element.top + element.end[1];
    const strokePadding = Math.max(12, element.width);
    return {
      left: Math.min(x1, x2) - strokePadding,
      top: Math.min(y1, y2) - strokePadding,
      right: Math.max(x1, x2) + strokePadding,
      bottom: Math.max(y1, y2) + strokePadding,
    };
  }

  if (!isFiniteNumber(element.width) || !isFiniteNumber(element.height)) return null;

  return {
    left: element.left,
    top: element.top,
    right: element.left + Math.max(0, element.width),
    bottom: element.top + Math.max(0, element.height),
  };
}

export function getSlideElementsBounds(elements: PPTElement[]): Bounds | null {
  const bounds = elements.map(getElementBounds).filter((bound): bound is Bounds => bound !== null);
  if (bounds.length === 0) return null;

  return bounds.reduce(
    (acc, bound) => ({
      left: Math.min(acc.left, bound.left),
      top: Math.min(acc.top, bound.top),
      right: Math.max(acc.right, bound.right),
      bottom: Math.max(acc.bottom, bound.bottom),
    }),
    bounds[0],
  );
}

export function computeSlideFitTransform(
  elements: PPTElement[],
  viewportWidth: number,
  viewportHeight: number,
): SlideFitTransform {
  const identity: SlideFitTransform = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    cssTransform: 'translate(0px, 0px) scale(1)',
  };

  if (viewportWidth <= 0 || viewportHeight <= 0 || elements.length === 0) return identity;

  const bounds = getSlideElementsBounds(elements);
  if (!bounds) return identity;

  const groupWidth = bounds.right - bounds.left;
  const groupHeight = bounds.bottom - bounds.top;
  if (groupWidth <= 0 || groupHeight <= 0) return identity;

  const padding = Math.min(48, Math.max(24, Math.min(viewportWidth, viewportHeight) * 0.06));
  const safeLeft = padding;
  const safeTop = padding;
  const safeRight = viewportWidth - padding;
  const safeBottom = viewportHeight - padding;
  const safeWidth = Math.max(1, safeRight - safeLeft);
  const safeHeight = Math.max(1, safeBottom - safeTop);

  const needsFit =
    bounds.left < safeLeft - EPSILON ||
    bounds.top < safeTop - EPSILON ||
    bounds.right > safeRight + EPSILON ||
    bounds.bottom > safeBottom + EPSILON;

  if (!needsFit) return identity;

  const scale = Math.min(1, safeWidth / groupWidth, safeHeight / groupHeight);
  const fittedWidth = groupWidth * scale;
  const fittedHeight = groupHeight * scale;
  const targetLeft = safeLeft + (safeWidth - fittedWidth) / 2;
  const targetTop = safeTop + (safeHeight - fittedHeight) / 2;
  const translateX = targetLeft - bounds.left * scale;
  const translateY = targetTop - bounds.top * scale;

  return {
    scale,
    translateX,
    translateY,
    cssTransform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
  };
}

export function transformPercentageGeometry(
  geometry: PercentageGeometry | null,
  fit: SlideFitTransform,
  viewportWidth: number,
  viewportHeight: number,
): PercentageGeometry | null {
  if (!geometry || viewportWidth <= 0 || viewportHeight <= 0) return geometry;
  if (fit.scale === 1 && fit.translateX === 0 && fit.translateY === 0) return geometry;

  const xPx = (geometry.x / 100) * viewportWidth;
  const yPx = (geometry.y / 100) * viewportHeight;
  const wPx = (geometry.w / 100) * viewportWidth;
  const hPx = (geometry.h / 100) * viewportHeight;
  const fittedX = xPx * fit.scale + fit.translateX;
  const fittedY = yPx * fit.scale + fit.translateY;
  const fittedW = wPx * fit.scale;
  const fittedH = hPx * fit.scale;

  const x = (fittedX / viewportWidth) * 100;
  const y = (fittedY / viewportHeight) * 100;
  const w = (fittedW / viewportWidth) * 100;
  const h = (fittedH / viewportHeight) * 100;

  return { x, y, w, h, centerX: x + w / 2, centerY: y + h / 2 };
}
