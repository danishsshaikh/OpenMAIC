/**
 * Pure element-geometry resolution for the video-timeline compiler.
 *
 * Resolves a slide element's percentage geometry (0–100 space) so effect
 * segments (spotlight/laser) can carry the target's position into the IR. This
 * is a faithful reimplementation of the runtime's calculation — the app copy
 * (`lib/utils/geometry.ts`) imports a host-app path and the packaged copy
 * (`@openmaic/renderer`) pulls a render backend, so both are unreachable under
 * this module's purity boundary. The math is ~15 lines and must stay identical
 * to the runtime's, so it is mirrored here rather than imported.
 *
 * The runtime uses a fixed 1000px width base and a 16:9 (0.5625) height ratio,
 * independent of a slide's own `viewportSize`/`viewportRatio`, so we do the same
 * — the spotlight/laser overlays position against this same base.
 *
 * Pure: type-only import from `@openmaic/dsl`.
 */
import type { PPTElement, PPTShapeElement, PPTTextElement } from '@openmaic/dsl';
import type { PercentageGeometry } from './ir';

/** Height ratio the runtime derives the vertical base from (16:9). */
const VIEWPORT_RATIO = 0.5625;
const DEFAULT_VIEWPORT_SIZE = 1000;
const TEXT_PADDING_PX = 10;
const MIN_TEXT_BOX_WIDTH_PX = 24;
const MIN_TEXT_BOX_HEIGHT_PX = 18;
const AVG_GLYPH_WIDTH = 0.56;
const DEFAULT_FONT_SIZE_PX = 18;
const DEFAULT_LINE_HEIGHT = 1.5;

export interface SpotlightGeometryContext {
  viewportSize?: number;
  viewportRatio?: number;
  allElements?: readonly PPTElement[];
  sceneId?: string;
  actionId?: string;
}

interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SlideFitTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

interface TextBlock {
  text: string;
  fontSize: number;
}

/**
 * Percentage geometry (0–100) for a single positioned element. Returns null for
 * elements without `left/top/width/height` (e.g. some line elements), matching
 * the runtime helper.
 */
export function getElementPercentageGeometry(
  element: PPTElement,
  viewportSize = DEFAULT_VIEWPORT_SIZE,
  viewportRatio = VIEWPORT_RATIO,
): PercentageGeometry | null {
  if (
    !('left' in element) ||
    !('top' in element) ||
    !('width' in element) ||
    !('height' in element)
  ) {
    return null;
  }

  const { left, top, width, height } = element;

  const x = (left / viewportSize) * 100;
  const y = (top / (viewportSize * viewportRatio)) * 100;
  const w = (width / viewportSize) * 100;
  const h = (height / (viewportSize * viewportRatio)) * 100;

  return { x, y, w, h, centerX: x + w / 2, centerY: y + h / 2 };
}

function getPixelBoxPercentageGeometry(
  box: PixelBox,
  viewportSize = DEFAULT_VIEWPORT_SIZE,
  viewportRatio = VIEWPORT_RATIO,
): PercentageGeometry | null {
  if (
    !isFiniteNumber(box.left) ||
    !isFiniteNumber(box.top) ||
    !isFiniteNumber(box.width) ||
    !isFiniteNumber(box.height) ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return null;
  }

  const x = (box.left / viewportSize) * 100;
  const y = (box.top / (viewportSize * viewportRatio)) * 100;
  const w = (box.width / viewportSize) * 100;
  const h = (box.height / (viewportSize * viewportRatio)) * 100;
  return { x, y, w, h, centerX: x + w / 2, centerY: y + h / 2 };
}

/**
 * Find an element by id in a slide's element list and return its percentage
 * geometry, or null when the element is absent or has no position.
 */
export function findElementGeometry(
  elements: PPTElement[],
  elementId: string,
  viewportSize = DEFAULT_VIEWPORT_SIZE,
): PercentageGeometry | null {
  const element = elements.find((el) => el.id === elementId);
  if (!element) return null;
  return getElementPercentageGeometry(element, viewportSize);
}

export function findSpotlightGeometry(
  elements: readonly PPTElement[],
  elementId: string,
  context: SpotlightGeometryContext = {},
): PercentageGeometry | null {
  const element = elements.find((el) => el.id === elementId);
  if (!element) return null;

  const viewportSize = context.viewportSize ?? DEFAULT_VIEWPORT_SIZE;
  const viewportRatio = context.viewportRatio ?? VIEWPORT_RATIO;
  const fit = computeSlideFitTransform(
    context.allElements ?? elements,
    viewportSize,
    viewportRatio,
  );
  const rawBox = getElementPixelBox(element);
  const measuredBox = resolveSpotlightMeasurementBox(element, rawBox);
  const rawGeometry = getPixelBoxPercentageGeometry(rawBox, viewportSize, viewportRatio);
  const measuredGeometry = getPixelBoxPercentageGeometry(measuredBox, viewportSize, viewportRatio);
  const transformedGeometry = transformPercentageGeometry(
    measuredGeometry,
    fit,
    viewportSize,
    viewportSize * viewportRatio,
  );

  traceVideoSpotlightParity('compiler-target', {
    sceneId: context.sceneId,
    actionId: context.actionId,
    targetId: elementId,
    elementType: element.type,
    rawBox,
    measuredBox,
    rawGeometry,
    measuredGeometry,
    transformedGeometry,
    measurementReason: measuredBox === rawBox ? 'element-box' : 'visible-text-content',
  });

  return transformedGeometry;
}

/** An element's placement: percentage geometry + rotation (degrees). */
export interface ElementPlacement {
  geometry: PercentageGeometry;
  /** Rotation in degrees; 0 for elements that carry no `rotate`. */
  rotate: number;
}

/**
 * Find an element and return both its percentage geometry and rotation, or null
 * when the element is absent or unpositioned. Used to place `play_video` clips
 * (position + size + rotation) into the IR so an emitter needs no scene DSL.
 */
export function findElementPlacement(
  elements: PPTElement[],
  elementId: string,
  viewportSize = DEFAULT_VIEWPORT_SIZE,
): ElementPlacement | null {
  const element = elements.find((el) => el.id === elementId);
  if (!element) return null;
  const geometry = getElementPercentageGeometry(element, viewportSize);
  if (!geometry) return null;
  const rotate = 'rotate' in element && typeof element.rotate === 'number' ? element.rotate : 0;
  return { geometry, rotate };
}

function resolveSpotlightMeasurementBox(element: PPTElement, fallback: PixelBox): PixelBox {
  if (isTextElement(element)) {
    return getTextElementVisibleBox(element) ?? fallback;
  }

  if (isShapeElement(element) && element.text?.content) {
    return fallback;
  }

  return fallback;
}

function getElementPixelBox(element: PPTElement): PixelBox {
  if (
    !('height' in element) ||
    !isFiniteNumber(element.left) ||
    !isFiniteNumber(element.top) ||
    !isFiniteNumber(element.width) ||
    !isFiniteNumber(element.height)
  ) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  return {
    left: element.left,
    top: element.top,
    width: Math.max(0, element.width),
    height: Math.max(0, element.height),
  };
}

function getTextElementVisibleBox(element: PPTTextElement): PixelBox | null {
  if (typeof element.content !== 'string' || element.content.trim().length === 0) return null;

  const blocks = extractTextBlocks(element.content);
  if (blocks.length === 0) return null;

  const paragraphGap = element.paragraphSpace ?? 5;
  const innerWidth = Math.max(1, element.width - TEXT_PADDING_PX * 2);
  let textHeight = 0;
  let longestLineWidth = 0;

  for (const block of blocks) {
    const lineHeight = inferLineHeightPx(element.lineHeight, block.fontSize);
    const estimatedWidth = estimateTextWidth(block.text, block.fontSize);
    longestLineWidth = Math.max(longestLineWidth, estimatedWidth);
    textHeight += Math.max(1, Math.ceil(estimatedWidth / innerWidth)) * lineHeight;
  }
  textHeight += Math.max(0, blocks.length - 1) * Math.max(0, paragraphGap);
  const visibleWidth = clamp(
    Math.ceil(Math.min(element.width, longestLineWidth + TEXT_PADDING_PX * 2)),
    MIN_TEXT_BOX_WIDTH_PX,
    Math.max(MIN_TEXT_BOX_WIDTH_PX, element.width),
  );
  const visibleHeight = clamp(
    Math.ceil(textHeight + TEXT_PADDING_PX * 2),
    MIN_TEXT_BOX_HEIGHT_PX,
    Math.max(MIN_TEXT_BOX_HEIGHT_PX, element.height),
  );

  const verticalOffset =
    element.vAlign === 'middle'
      ? Math.max(0, (element.height - visibleHeight) / 2)
      : element.vAlign === 'bottom'
        ? Math.max(0, element.height - visibleHeight)
        : 0;

  return {
    left: element.left,
    top: element.top + verticalOffset,
    width: visibleWidth,
    height: visibleHeight,
  };
}

function extractTextBlocks(html: string): TextBlock[] {
  const blockMatches = [...html.matchAll(/<(p|div|li|h[1-6]|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  const rawBlocks = blockMatches.length
    ? blockMatches.map((match) => match[2])
    : html
        .replace(/<br\s*\/?>/gi, '\n')
        .split(/\n+/)
        .filter(Boolean);

  return rawBlocks
    .map((block) => {
      const text = decodeHtmlEntities(block.replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim();
      return { text, fontSize: inferFontSizePx(block) };
    })
    .filter((block) => block.text.length > 0);
}

function inferFontSizePx(html: string): number {
  let fontSize = 0;
  for (const match of html.matchAll(/font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)(px|pt)?/gi)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = match[2]?.toLowerCase();
    fontSize = Math.max(fontSize, unit === 'pt' ? value * (4 / 3) : value);
  }
  return fontSize || DEFAULT_FONT_SIZE_PX;
}

function inferLineHeightPx(lineHeight: number | undefined, fontSize: number): number {
  if (!Number.isFinite(lineHeight) || !lineHeight || lineHeight <= 0) {
    return fontSize * DEFAULT_LINE_HEIGHT;
  }
  return lineHeight < 4 ? fontSize * lineHeight : lineHeight;
}

function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    if (/\s/.test(char)) {
      width += fontSize * 0.33;
    } else if (/[A-Z0-9#()&/]/.test(char)) {
      width += fontSize * 0.62;
    } else if (/[,.:;]/.test(char)) {
      width += fontSize * 0.28;
    } else {
      width += fontSize * AVG_GLYPH_WIDTH;
    }
  }
  return width;
}

function computeSlideFitTransform(
  elements: readonly PPTElement[],
  viewportSize: number,
  viewportRatio: number,
): SlideFitTransform {
  const identity = { scale: 1, translateX: 0, translateY: 0 };
  const viewportHeight = viewportSize * viewportRatio;
  const bounds = elements.map(getElementPixelBox).filter((box) => box.width > 0 && box.height > 0);
  if (bounds.length === 0) return identity;

  const left = Math.min(...bounds.map((box) => box.left));
  const top = Math.min(...bounds.map((box) => box.top));
  const right = Math.max(...bounds.map((box) => box.left + box.width));
  const bottom = Math.max(...bounds.map((box) => box.top + box.height));
  const groupWidth = right - left;
  const groupHeight = bottom - top;
  if (groupWidth <= 0 || groupHeight <= 0) return identity;

  const padding = Math.min(48, Math.max(24, Math.min(viewportSize, viewportHeight) * 0.06));
  const safeLeft = padding;
  const safeTop = padding;
  const safeRight = viewportSize - padding;
  const safeBottom = viewportHeight - padding;
  const safeWidth = Math.max(1, safeRight - safeLeft);
  const safeHeight = Math.max(1, safeBottom - safeTop);
  const needsFit =
    left < safeLeft - 0.01 ||
    top < safeTop - 0.01 ||
    right > safeRight + 0.01 ||
    bottom > safeBottom + 0.01;
  if (!needsFit) return identity;

  const scale = Math.min(1, safeWidth / groupWidth, safeHeight / groupHeight);
  const fittedWidth = groupWidth * scale;
  const fittedHeight = groupHeight * scale;
  const targetLeft = safeLeft + (safeWidth - fittedWidth) / 2;
  const targetTop = safeTop + (safeHeight - fittedHeight) / 2;
  return {
    scale,
    translateX: targetLeft - left * scale,
    translateY: targetTop - top * scale,
  };
}

function transformPercentageGeometry(
  geometry: PercentageGeometry | null,
  fit: SlideFitTransform,
  viewportWidth: number,
  viewportHeight: number,
): PercentageGeometry | null {
  if (!geometry) return null;
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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isTextElement(element: PPTElement): element is PPTTextElement {
  return element.type === 'text';
}

function isShapeElement(element: PPTElement): element is PPTShapeElement {
  return element.type === 'shape';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function traceVideoSpotlightParity(checkpoint: string, payload: Record<string, unknown>): void {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_VIDEO_SPOTLIGHT_PARITY_TRACE !== 'true'
  ) {
    return;
  }
  console.info('[VideoSpotlightParity]', { checkpoint, ...payload });
  const actionId = String(payload.actionId ?? '');
  const targetId = String(payload.targetId ?? '');
  const measured = String(payload.measurementReason ?? '');
  console.info('videoSpotlightSavedTargetFlat', [actionId, `saved:${targetId}`].join(' | '));
  console.info(
    'videoSpotlightCompilerTargetFlat',
    [actionId, `saved:${targetId}`, `compiled:${targetId}`, `measured:${measured}`].join(' | '),
  );
  console.info(
    'videoSpotlightRawRectFlat',
    [actionId, `raw:${formatGeometryFlat(payload.rawGeometry)}`].join(' | '),
  );
  console.info(
    'videoSpotlightNormalizedRectFlat',
    [actionId, `normalized:${formatGeometryFlat(payload.transformedGeometry)}`].join(' | '),
  );
}

function formatGeometryFlat(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const geometry = value as Partial<PercentageGeometry>;
  return [geometry.x, geometry.y, geometry.w, geometry.h]
    .map((part) => (typeof part === 'number' ? Number(part.toFixed(4)) : ''))
    .join(',');
}
