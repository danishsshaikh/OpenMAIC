'use client';

import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { SpotlightEffectOptions } from '../types/effects';
import {
  getRelativeSpotlightRect,
  getStaticSpotlightFocusRect,
  getStaticSpotlightPixelRect,
  type SpotlightRect,
  type SpotlightFocusRect,
  type SpotlightViewportSize,
} from './spotlightGeometry';

const SPOTLIGHT_TRACE_PREFIX = '[SpotlightTargetTrace]';
const SPOTLIGHT_EXPORT_TRACE_PREFIX = '[SpotlightExportTrace]';

export interface SpotlightOverlayProps {
  options?: SpotlightEffectOptions;
  /** ID prefix the SlideElement uses on its root div. Default `slide-element-`. */
  elementIdPrefix?: string;
}

export function SpotlightOverlay({
  options,
  elementIdPrefix = 'slide-element-',
}: SpotlightOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);

  const spotlightElementId = options?.elementId;

  const measure = useCallback(() => {
    if (!spotlightElementId || !containerRef.current) {
      setRect(null);
      return;
    }

    const targetDomId = `${elementIdPrefix}${spotlightElementId}`;
    const lookupRoot = containerRef.current.parentElement;
    const domElement = findElementInRoot(lookupRoot, targetDomId, spotlightElementId);
    if (!domElement) {
      warnStaticSpotlightDiagnostic(options, 'target-missing', {
        elementId: spotlightElementId,
        targetDomId,
      });
      setRect(null);
      return;
    }

    const resolution = resolveSpotlightMeasurementNode({
      snapshotRoot: lookupRoot,
      targetElement: domElement,
      elementId: spotlightElementId,
    });
    const targetEl = resolution.measurementElement;

    const containerRect = containerRef.current.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const normalizedRect = getRelativeSpotlightRect(targetRect, containerRect);
    setViewport({ width: containerRect.width, height: containerRect.height });
    logSpotlightExportTrace(
      { static: true },
      {
        checkpoint: 'snapshot-target-resolution',
        elementId: spotlightElementId,
        selectorUsed: resolution.selectorUsed,
        resolutionReason: resolution.resolutionReason,
        resolvedNodeId: targetEl.id,
        resolvedDataElementId: targetEl.dataset.elementId,
        resolvedNodeTag: targetEl.tagName,
        resolvedNodeClass: targetEl.className,
        resolvedParentDataElementId: targetEl.parentElement?.dataset.elementId,
        snapshotResolvedTargetFlat: [
          [
            spotlightElementId,
            resolution.selectorUsed,
            targetEl.id,
            targetEl.dataset.elementId ?? '',
            targetEl.tagName,
            String(targetEl.className || '').slice(0, 80),
            targetEl.parentElement?.dataset.elementId ?? '',
          ].join(':'),
        ],
      },
    );
    logSpotlightExportTrace(
      { static: true },
      {
        checkpoint: 'snapshot-raw-geometry',
        elementId: spotlightElementId,
        targetRect: rectForLog(targetRect),
        containerRect: rectForLog(containerRect),
      },
    );

    if (containerRect.width === 0 || containerRect.height === 0) {
      warnStaticSpotlightDiagnostic(options, 'container-zero-size', {
        elementId: spotlightElementId,
        targetDomId,
        containerRect: rectForLog(containerRect),
        targetRect: rectForLog(targetRect),
      });
      setRect(null);
      return;
    }

    if (targetRect.width === 0 || targetRect.height === 0) {
      warnStaticSpotlightDiagnostic(options, 'target-zero-size', {
        elementId: spotlightElementId,
        targetDomId,
        targetTagName: targetEl.tagName,
        containerRect: rectForLog(containerRect),
        targetRect: rectForLog(targetRect),
      });
      setRect(null);
      return;
    }

    if (!normalizedRect) {
      warnStaticSpotlightDiagnostic(options, 'invalid-relative-geometry', {
        elementId: spotlightElementId,
        targetDomId,
        targetTagName: targetEl.tagName,
        targetRect: rectForLog(targetRect),
        containerRect: rectForLog(containerRect),
        localRect: localRectForLog(targetRect, containerRect),
      });
      setRect(null);
      return;
    }
    if (options?.static && staticSpotlightRectLooksOversized(normalizedRect)) {
      warnStaticSpotlightDiagnostic(options, 'oversized-focus-geometry', {
        elementId: spotlightElementId,
        targetDomId,
        targetTagName: targetEl.tagName,
        targetClassName: targetEl.className,
        targetRect: rectForLog(targetRect),
        containerRect: rectForLog(containerRect),
        normalizedRect: roundFocusRectForData(normalizedRect),
      });
      setRect(null);
      return;
    }

    const localRect = localRectForLog(targetRect, containerRect);
    logSpotlightExportTrace(
      { static: true },
      {
        checkpoint: 'snapshot-relative-geometry',
        elementId: spotlightElementId,
        localRect,
        normalizedRect: roundFocusRectForData(normalizedRect),
        snapshotRelativeRectFlat: [
          [
            spotlightElementId,
            localRect.x,
            localRect.y,
            localRect.width,
            localRect.height,
            roundRectNumber(normalizedRect.x),
            roundRectNumber(normalizedRect.y),
            roundRectNumber(normalizedRect.w),
            roundRectNumber(normalizedRect.h),
          ].join(':'),
        ],
      },
    );
    setRect(normalizedRect);
  }, [spotlightElementId, elementIdPrefix, options]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement requires effect
    measure();
  }, [measure]);

  const active = !!spotlightElementId && !!rect;
  const dimOpacity = clampOpacity(options?.dimOpacity ?? 0.7);
  const isStaticSpotlight = Boolean(options?.static);
  const staticFocusRect = rect ? getStaticSpotlightFocusRect(rect, viewport ?? undefined) : null;
  if (options?.static && rect && !staticFocusRect) {
    warnStaticSpotlightDiagnostic(options, 'invalid-focus-geometry', {
      elementId: spotlightElementId,
      rect,
      focusRect: staticFocusRect,
    });
  }

  useEffect(() => {
    if (!isStaticSpotlight || !spotlightElementId || !rect || !staticFocusRect || !viewport) {
      return;
    }
    const pixelRect = getStaticSpotlightPixelRect(staticFocusRect, viewport);
    const targetWidthRatio = pixelRect ? pixelRect.width / viewport.width : undefined;
    const targetHeightRatio = pixelRect ? pixelRect.height / viewport.height : undefined;
    const targetAreaRatio = pixelRect
      ? (pixelRect.width * pixelRect.height) / (viewport.width * viewport.height)
      : undefined;
    logSpotlightExportTrace(
      { static: true },
      {
        checkpoint: 'snapshot-pixel-geometry',
        elementId: spotlightElementId,
        outputWidth: Math.round(viewport.width),
        outputHeight: Math.round(viewport.height),
        pixelRect,
        targetWidthRatio,
        targetHeightRatio,
        targetAreaRatio,
        snapshotPixelRectFlat: [
          [
            spotlightElementId,
            Math.round(viewport.width),
            Math.round(viewport.height),
            pixelRect?.left ?? '',
            pixelRect?.top ?? '',
            pixelRect?.right ?? '',
            pixelRect?.bottom ?? '',
            targetAreaRatio == null ? '' : roundRectNumber(targetAreaRatio),
          ].join(':'),
        ],
      },
    );
    logSpotlightTargetTrace({
      checkpoint: 'snapshotResolvedTargetsFlat',
      targetElementId: spotlightElementId,
      order: [
        [
          spotlightElementId,
          roundRectNumber(rect.x),
          roundRectNumber(rect.y),
          roundRectNumber(rect.w),
          roundRectNumber(rect.h),
          `${Math.round(viewport.width)}x${Math.round(viewport.height)}`,
        ].join(':'),
      ],
    });
    logSpotlightTargetTrace({
      checkpoint: 'snapshotFocusRectsFlat',
      targetElementId: spotlightElementId,
      order: [
        [
          spotlightElementId,
          roundRectNumber(staticFocusRect.x),
          roundRectNumber(staticFocusRect.y),
          roundRectNumber(staticFocusRect.w),
          roundRectNumber(staticFocusRect.h),
          roundRectNumber(staticFocusRect.rx),
        ].join(':'),
      ],
    });
  }, [isStaticSpotlight, rect, spotlightElementId, staticFocusRect, viewport]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <AnimatePresence mode="wait">
        {active && staticFocusRect && viewport && options?.static ? (
          <div
            data-openmaic-static-spotlight="true"
            data-openmaic-static-spotlight-target={spotlightElementId}
            data-openmaic-static-spotlight-focus={
              staticFocusRect ? JSON.stringify(roundFocusRectForData(staticFocusRect)) : undefined
            }
            style={{ position: 'absolute', inset: 0 }}
          >
            <StaticSpotlightCanvas
              focusRect={staticFocusRect}
              viewport={viewport}
              dimOpacity={dimOpacity}
            />
            <div
              data-openmaic-static-spotlight-focus="true"
              style={{
                position: 'absolute',
                left: `${staticFocusRect.x}%`,
                top: `${staticFocusRect.y}%`,
                width: `${staticFocusRect.w}%`,
                height: `${staticFocusRect.h}%`,
                borderRadius: `${staticFocusRect.rx}%`,
                border: '1.2px solid rgba(255,255,255,0.7)',
              }}
            />
          </div>
        ) : active && rect ? (
          <motion.div
            key={`spotlight-${spotlightElementId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0 }}
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0 }}
            >
              <defs>
                <mask id={`mask-${spotlightElementId}`}>
                  <rect x="0" y="0" width="100" height="100" fill="white" />
                  <motion.rect
                    fill="black"
                    initial={{
                      x: rect.x - 8,
                      y: rect.y - 8,
                      width: rect.w + 16,
                      height: rect.h + 16,
                      rx: 4,
                    }}
                    animate={{
                      x: rect.x - 0.4,
                      y: rect.y - 0.6,
                      width: rect.w + 0.8,
                      height: rect.h + 1.2,
                      rx: 1,
                    }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  />
                </mask>
              </defs>

              <rect
                width="100"
                height="100"
                fill={`rgba(0,0,0,${dimOpacity})`}
                mask={`url(#mask-${spotlightElementId})`}
              />

              <motion.rect
                initial={{
                  x: rect.x - 4,
                  y: rect.y - 4,
                  width: rect.w + 8,
                  height: rect.h + 8,
                  opacity: 0,
                  rx: 2,
                }}
                animate={{
                  x: rect.x - 0.4,
                  y: rect.y - 0.6,
                  width: rect.w + 0.8,
                  height: rect.h + 1.2,
                  opacity: 1,
                  rx: 1,
                }}
                fill="none"
                stroke="rgba(255,255,255,0.7)"
                strokeWidth="1.2"
                style={{ vectorEffect: 'non-scaling-stroke' } as React.CSSProperties}
                transition={{ duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
              />
            </svg>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StaticSpotlightCanvas({
  focusRect,
  viewport,
  dimOpacity,
}: {
  focusRect: SpotlightFocusRect;
  viewport: SpotlightViewportSize;
  dimOpacity: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pixelRect = getStaticSpotlightPixelRect(focusRect, { width, height });
    ctx.setTransform?.(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!pixelRect) return;
    const holeAreaRatio = (pixelRect.width * pixelRect.height) / (width * height);
    logSpotlightExportTrace(
      { static: true },
      {
        checkpoint: 'snapshot-compositor',
        pixelRect,
        canvasWidth: width,
        canvasHeight: height,
        holeAreaRatio,
        strategy: 'single-canvas-evenodd',
        snapshotCompositorFlat: [
          [
            pixelRect.left,
            pixelRect.top,
            pixelRect.right,
            pixelRect.bottom,
            width,
            height,
            roundRectNumber(holeAreaRatio),
            'single-canvas-evenodd',
          ].join(':'),
        ],
      },
    );
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.rect(pixelRect.left, pixelRect.top, pixelRect.width, pixelRect.height);
    ctx.fillStyle = `rgba(0,0,0,${dimOpacity})`;
    ctx.fill('evenodd');
  }, [dimOpacity, focusRect, height, width]);

  return (
    <canvas
      data-openmaic-static-spotlight-layer="canvas"
      ref={canvasRef}
      width={width}
      height={height}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 0.7;
  return Math.max(0, Math.min(1, value));
}

function findElementInRoot(
  root: Element | null,
  targetDomId: string,
  elementId: string,
): HTMLElement | null {
  if (!root) return null;
  for (const candidate of root.querySelectorAll<HTMLElement>('[id]')) {
    if (candidate.id === targetDomId) return candidate;
  }
  for (const candidate of root.querySelectorAll<HTMLElement>('[data-element-id]')) {
    if (candidate.dataset.elementId === elementId) return candidate;
  }
  return null;
}

export function resolveSpotlightMeasurementNode({
  snapshotRoot,
  targetElement,
  elementId,
}: {
  snapshotRoot: Element | null;
  targetElement: HTMLElement;
  elementId: string;
}): {
  targetElement: HTMLElement;
  measurementElement: HTMLElement;
  selectorUsed: string;
  resolutionReason: string;
} {
  if (snapshotRoot && !snapshotRoot.contains(targetElement)) {
    return {
      targetElement,
      measurementElement: targetElement,
      selectorUsed: 'target-outside-snapshot-root',
      resolutionReason: 'target-outside-snapshot-root',
    };
  }

  const contentElement = targetElement.querySelector<HTMLElement>('.element-content');
  const contentRect = contentElement?.getBoundingClientRect();
  if (contentElement && hasUsableDomRect(contentRect)) {
    return {
      targetElement,
      measurementElement: contentElement,
      selectorUsed: '.element-content',
      resolutionReason: 'element-content',
    };
  }

  const textElement = targetElement.querySelector<HTMLElement>('.ProseMirror-static, .text');
  const textRect = textElement?.getBoundingClientRect();
  if (textElement && hasUsableDomRect(textRect)) {
    return {
      targetElement,
      measurementElement: textElement,
      selectorUsed: '.ProseMirror-static,.text',
      resolutionReason: 'text-descendant',
    };
  }

  return {
    targetElement,
    measurementElement: targetElement,
    selectorUsed: `#slide-element-${elementId}`,
    resolutionReason: 'target-wrapper-fallback',
  };
}

function warnStaticSpotlightDiagnostic(
  options: SpotlightEffectOptions | undefined,
  reason: string,
  details: Record<string, unknown>,
) {
  if (!options?.static) return;
  console.warn('[OpenMAIC renderer] Static spotlight skipped:', {
    reason,
    ...details,
  });
}

function logSpotlightTargetTrace(payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return;
  if (typeof console === 'undefined' || typeof console.info !== 'function') return;
  console.info(SPOTLIGHT_TRACE_PREFIX, payload);
}

function logSpotlightExportTrace(
  options: Pick<SpotlightEffectOptions, 'static'> | undefined,
  payload: Record<string, unknown>,
) {
  if (!options?.static) return;
  if (process.env.NODE_ENV === 'production') return;
  if (typeof console === 'undefined' || typeof console.info !== 'function') return;
  console.info(SPOTLIGHT_EXPORT_TRACE_PREFIX, payload);
}

function hasUsableDomRect(rect: DOMRect | undefined): boolean {
  return Boolean(
    rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0,
  );
}

function staticSpotlightRectLooksOversized(rect: SpotlightRect): boolean {
  const areaRatio = (rect.w * rect.h) / 10000;
  return rect.w >= 92 || rect.h >= 92 || areaRatio >= 0.72;
}

function rectForLog(rect: DOMRect): Record<string, number> {
  return {
    left: roundRectNumber(rect.left),
    top: roundRectNumber(rect.top),
    right: roundRectNumber(rect.right),
    bottom: roundRectNumber(rect.bottom),
    x: roundRectNumber(rect.x),
    y: roundRectNumber(rect.y),
    width: roundRectNumber(rect.width),
    height: roundRectNumber(rect.height),
  };
}

function localRectForLog(targetRect: DOMRect, containerRect: DOMRect): Record<string, number> {
  const x = targetRect.left - containerRect.left;
  const y = targetRect.top - containerRect.top;
  const right = targetRect.right - containerRect.left;
  const bottom = targetRect.bottom - containerRect.top;
  return {
    x: roundRectNumber(x),
    y: roundRectNumber(y),
    width: roundRectNumber(right - x),
    height: roundRectNumber(bottom - y),
  };
}

function roundRectNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundFocusRectForData(rect: SpotlightRect): SpotlightRect {
  return {
    x: roundRectNumber(rect.x),
    y: roundRectNumber(rect.y),
    w: roundRectNumber(rect.w),
    h: roundRectNumber(rect.h),
  };
}
