import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export const MIN_SLIDE_TEXT_FIT_SCALE = 0.72;

export function computeTextFitScale(
  availableHeight: number,
  contentHeight: number,
  minScale = MIN_SLIDE_TEXT_FIT_SCALE,
) {
  if (
    !Number.isFinite(availableHeight) ||
    !Number.isFinite(contentHeight) ||
    availableHeight <= 0 ||
    contentHeight <= 0 ||
    contentHeight <= availableHeight + 1
  ) {
    return 1;
  }

  return Math.max(minScale, Math.min(1, availableHeight / contentHeight));
}

export function useTextAutoFit(watchKey: unknown) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const nextScale = computeTextFitScale(container.clientHeight, text.scrollHeight);
    setScale((previous) => (Math.abs(previous - nextScale) > 0.01 ? nextScale : previous));
  }, []);

  useLayoutEffect(() => {
    measure();
    const frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [measure, watchKey]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    });
    observer.observe(container);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [measure]);

  return { containerRef, textRef, textFitScale: scale };
}

export function getTextFitStyle(scale: number) {
  if (scale >= 0.995) return undefined;

  return {
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    width: `${100 / scale}%`,
    maxWidth: `${100 / scale}%`,
  };
}
