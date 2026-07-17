'use client';

import { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { SpotlightEffectOptions } from '../types/effects';
import {
  getRelativeSpotlightRect,
  getStaticSpotlightDimRects,
  getStaticSpotlightFocusRect,
  type SpotlightRect,
} from './spotlightGeometry';

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

    const contentEl = domElement.querySelector('.element-content');
    const targetEl = contentEl ?? domElement;

    const containerRect = containerRef.current.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const normalizedRect = getRelativeSpotlightRect(targetRect, containerRect);
    setViewport({ width: containerRect.width, height: containerRect.height });

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

    setRect(normalizedRect);
  }, [spotlightElementId, elementIdPrefix, options]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement requires effect
    measure();
  }, [measure]);

  const active = !!spotlightElementId && !!rect;
  const dimOpacity = clampOpacity(options?.dimOpacity ?? 0.7);
  const staticFocusRect = rect ? getStaticSpotlightFocusRect(rect, viewport ?? undefined) : null;
  const staticDimRects = getStaticSpotlightDimRects(staticFocusRect);
  if (options?.static && rect && (!staticFocusRect || staticDimRects.length === 0)) {
    warnStaticSpotlightDiagnostic(options, 'invalid-focus-geometry', {
      elementId: spotlightElementId,
      rect,
      focusRect: staticFocusRect,
      staticRectCount: staticDimRects.length,
    });
  }

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
        {active && staticFocusRect && staticDimRects.length > 0 && options?.static ? (
          <div
            data-openmaic-static-spotlight="true"
            data-openmaic-static-spotlight-target={spotlightElementId}
            data-openmaic-static-spotlight-focus={
              staticFocusRect ? JSON.stringify(roundFocusRectForData(staticFocusRect)) : undefined
            }
            style={{ position: 'absolute', inset: 0 }}
          >
            {/* html2canvas-pro does not reliably preserve SVG masks or oversized
               shadows. Static export uses ordinary dim rectangles so the
               original target content remains uncovered in the rasterized PNG. */}
            {staticDimRects.map((dimRect) => (
              <div
                key={dimRect.key}
                data-openmaic-static-spotlight-dim={dimRect.key}
                style={{
                  position: 'absolute',
                  left: `${dimRect.x}%`,
                  top: `${dimRect.y}%`,
                  width: `${dimRect.w}%`,
                  height: `${dimRect.h}%`,
                  backgroundColor: `rgba(0,0,0,${dimOpacity})`,
                }}
              />
            ))}
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
