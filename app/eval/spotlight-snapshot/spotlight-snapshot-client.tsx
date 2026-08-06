'use client';

import { useEffect, useState } from 'react';
import type { PPTShapeElement, Slide } from '@openmaic/dsl';
import { slideToPng } from '@openmaic/renderer/snapshot';

type PixelSample = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
  luminance: number;
};

type SnapshotFrameResult = {
  dataUrl: string;
  dataUrlLength: number;
  width: number;
  height: number;
  targetSamples: PixelSample[];
  lowerTargetSamples: PixelSample[];
  dimmedCardSamples: PixelSample[];
  outsideSamples: PixelSample[];
  focusEdgeSamples: PixelSample[];
  outsideRegionLuminance: Record<'top' | 'bottom' | 'left' | 'right', number>;
  seamStats: {
    horizontalMaxDelta: number;
    verticalMaxDelta: number;
  };
  targetLuminance: number;
  lowerTargetLuminance: number;
  dimmedCardLuminance: number;
  outsideLuminance: number;
  focusEdgeLuminance: number;
};

export type SpotlightSnapshotResult = {
  base: SnapshotFrameResult;
  spotlight: SnapshotFrameResult;
  spotlightAtOrigin: SnapshotFrameResult;
  spotlightFarOffset: SnapshotFrameResult;
  afterSpotlightBase: SnapshotFrameResult;
  mountEquivalenceMaxDelta: number;
  dataUrlLength: number;
};

declare global {
  interface Window {
    __spotlightSnapshotReady?: boolean;
    __renderSpotlightSnapshot?: () => Promise<SpotlightSnapshotResult>;
  }
}

const WIDTH = 400;
const HEIGHT = 225;

const MISD_BOUNDS = { left: 42, top: 48, right: 184, bottom: 178 };
const MIMD_BOUNDS = { left: 216, top: 48, right: 358, bottom: 178 };

const targetShape: PPTShapeElement = {
  id: 'misd-card',
  type: 'shape',
  left: MISD_BOUNDS.left,
  top: MISD_BOUNDS.top,
  width: MISD_BOUNDS.right - MISD_BOUNDS.left,
  height: MISD_BOUNDS.bottom - MISD_BOUNDS.top,
  rotate: 0,
  viewBox: [142, 130],
  path: 'M 0 0 L 142 0 L 142 130 L 0 130 Z',
  fixedRatio: false,
  fill: '#ffffff',
  outline: { width: 1, color: '#cbd5e1' },
  opacity: 1,
  text: {
    content:
      '<p><strong>MISD</strong></p><p>Multiple instruction</p><p>Single data stream</p><p>One control unit coordinates many processors.</p>',
    defaultFontName: 'Arial',
    defaultColor: '#111111',
    align: 'top',
  },
};

const mimdShape: PPTShapeElement = {
  ...targetShape,
  id: 'mimd-card',
  left: MIMD_BOUNDS.left,
  width: MIMD_BOUNDS.right - MIMD_BOUNDS.left,
  text: {
    content:
      '<p><strong>MIMD</strong></p><p>Multiple instruction</p><p>Multiple data streams</p><p>Independent processors execute separate programs.</p>',
    defaultFontName: 'Arial',
    defaultColor: '#111111',
    align: 'top',
  },
};

const slide: Slide = {
  id: 'spotlight-snapshot-eval-slide',
  viewportSize: WIDTH,
  viewportRatio: HEIGHT / WIDTH,
  background: { type: 'solid', color: '#ffffff' },
  theme: {
    backgroundColor: '#ffffff',
    themeColors: ['#5b9bd5'],
    fontColor: '#111111',
    fontName: 'Arial',
  },
  elements: [targetShape, mimdShape],
};

export function SpotlightSnapshotEvalClient() {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    window.__renderSpotlightSnapshot = async () => {
      const base = await renderSnapshotFrame();
      const spotlight = await renderSnapshotFrame({
        spotlight: {
          elementId: targetShape.id,
          dimOpacity: 0.7,
          static: true,
        },
      });
      const spotlightAtOrigin = await renderSnapshotFrame(
        {
          spotlight: {
            elementId: targetShape.id,
            dimOpacity: 0.7,
            static: true,
          },
        },
        0,
      );
      const spotlightFarOffset = await renderSnapshotFrame(
        {
          spotlight: {
            elementId: targetShape.id,
            dimOpacity: 0.7,
            static: true,
          },
        },
        10000,
      );
      const afterSpotlightBase = await renderSnapshotFrame();
      setPreview(spotlight.dataUrl);

      return {
        base,
        spotlight,
        spotlightAtOrigin,
        spotlightFarOffset,
        afterSpotlightBase,
        mountEquivalenceMaxDelta: maxSampleLuminanceDelta(spotlightAtOrigin, spotlightFarOffset),
        dataUrlLength: spotlight.dataUrlLength,
      };
    };
    window.__spotlightSnapshotReady = true;

    return () => {
      delete window.__renderSpotlightSnapshot;
      delete window.__spotlightSnapshotReady;
    };
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Spotlight snapshot eval</h1>
      <div
        aria-hidden="true"
        id="slide-element-misd-card"
        data-element-id="misd-card"
        style={{
          position: 'absolute',
          left: 275,
          top: 145,
          width: 164,
          height: 99,
          background: '#000000',
          border: '1px solid #999999',
        }}
      />
      {preview ? <img alt="Spotlight snapshot result" src={preview} /> : null}
    </main>
  );
}

async function renderSnapshotFrame(
  effects?: NonNullable<Parameters<typeof slideToPng>[1]>['effects'],
  debugMountLeft?: number,
) {
  const dataUrl = (await slideToPng(slide, {
    width: WIDTH,
    pixelRatio: 1,
    format: 'dataUrl',
    backgroundColor: '#ffffff',
    effects,
    ...(debugMountLeft !== undefined ? { debugMountLeft } : {}),
  })) as string;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('failed to decode spotlight snapshot'));
    image.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2d canvas context unavailable');
  context.drawImage(image, 0, 0);

  const targetSamples = [
    samplePixel(context, 66, 68),
    samplePixel(context, 162, 68),
    samplePixel(context, 66, 104),
    samplePixel(context, 162, 104),
  ];
  const lowerTargetSamples = [
    samplePixel(context, 66, 140),
    samplePixel(context, 162, 140),
    samplePixel(context, 66, 166),
    samplePixel(context, 162, 166),
  ];
  const dimmedCardSamples = [
    samplePixel(context, 240, 68),
    samplePixel(context, 336, 68),
    samplePixel(context, 240, 140),
    samplePixel(context, 336, 166),
  ];
  const outsideSamples = [
    samplePixel(context, 30, 30),
    samplePixel(context, 370, 30),
    samplePixel(context, 30, 200),
    samplePixel(context, 370, 200),
  ];
  const focusEdgeSamples = [
    samplePixel(context, MISD_BOUNDS.left, MISD_BOUNDS.top),
    samplePixel(context, MISD_BOUNDS.right - 1, MISD_BOUNDS.top),
    samplePixel(context, MISD_BOUNDS.left, MISD_BOUNDS.bottom - 1),
    samplePixel(context, MISD_BOUNDS.right - 1, MISD_BOUNDS.bottom - 1),
  ];
  const outsideRegionLuminance = {
    top: averageLuminance(sampleGrid(context, 20, 12, 380, 32, 8)),
    bottom: averageLuminance(sampleGrid(context, 20, 194, 380, 214, 8)),
    left: averageLuminance(sampleGrid(context, 10, 56, 28, 170, 8)),
    right: averageLuminance(sampleGrid(context, 372, 56, 390, 170, 8)),
  };
  const seamStats = {
    horizontalMaxDelta: Math.max(
      lineMaxDelta(context, 0, MISD_BOUNDS.top - 2, MISD_BOUNDS.left - 4, MISD_BOUNDS.top - 2),
      lineMaxDelta(
        context,
        MISD_BOUNDS.right + 4,
        MISD_BOUNDS.top - 2,
        WIDTH - 1,
        MISD_BOUNDS.top - 2,
      ),
      lineMaxDelta(
        context,
        0,
        MISD_BOUNDS.bottom + 2,
        MISD_BOUNDS.left - 4,
        MISD_BOUNDS.bottom + 2,
      ),
      lineMaxDelta(
        context,
        MISD_BOUNDS.right + 4,
        MISD_BOUNDS.bottom + 2,
        WIDTH - 1,
        MISD_BOUNDS.bottom + 2,
      ),
    ),
    verticalMaxDelta: Math.max(
      lineMaxDelta(context, MISD_BOUNDS.left - 2, 0, MISD_BOUNDS.left - 2, MISD_BOUNDS.top - 4),
      lineMaxDelta(
        context,
        MISD_BOUNDS.left - 2,
        MISD_BOUNDS.bottom + 4,
        MISD_BOUNDS.left - 2,
        HEIGHT - 1,
      ),
      lineMaxDelta(context, MISD_BOUNDS.right + 2, 0, MISD_BOUNDS.right + 2, MISD_BOUNDS.top - 4),
      lineMaxDelta(
        context,
        MISD_BOUNDS.right + 2,
        MISD_BOUNDS.bottom + 4,
        MISD_BOUNDS.right + 2,
        HEIGHT - 1,
      ),
    ),
  };

  return {
    dataUrl,
    dataUrlLength: dataUrl.length,
    width: image.naturalWidth,
    height: image.naturalHeight,
    targetSamples,
    lowerTargetSamples,
    dimmedCardSamples,
    outsideSamples,
    focusEdgeSamples,
    outsideRegionLuminance,
    seamStats,
    targetLuminance: averageLuminance(targetSamples),
    lowerTargetLuminance: averageLuminance(lowerTargetSamples),
    dimmedCardLuminance: averageLuminance(dimmedCardSamples),
    outsideLuminance: averageLuminance(outsideSamples),
    focusEdgeLuminance: averageLuminance(focusEdgeSamples),
  };
}

function averageLuminance(samples: PixelSample[]): number {
  return samples.reduce((total, sample) => total + sample.luminance, 0) / samples.length;
}

function samplePixel(context: CanvasRenderingContext2D, x: number, y: number): PixelSample {
  const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
  return {
    x,
    y,
    r,
    g,
    b,
    a,
    luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
  };
}

function sampleGrid(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  right: number,
  bottom: number,
  step: number,
): PixelSample[] {
  const samples: PixelSample[] = [];
  for (let y = top; y <= bottom; y += step) {
    for (let x = left; x <= right; x += step) samples.push(samplePixel(context, x, y));
  }
  return samples;
}

function lineMaxDelta(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const samples: PixelSample[] = [];
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i += 4) {
    const t = steps === 0 ? 0 : i / steps;
    samples.push(
      samplePixel(context, Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t)),
    );
  }
  const luminance = samples.map((sample) => sample.luminance);
  return Math.max(...luminance) - Math.min(...luminance);
}

function maxSampleLuminanceDelta(a: SnapshotFrameResult, b: SnapshotFrameResult): number {
  const samplesA = [
    ...a.targetSamples,
    ...a.lowerTargetSamples,
    ...a.dimmedCardSamples,
    ...a.outsideSamples,
  ];
  const samplesB = [
    ...b.targetSamples,
    ...b.lowerTargetSamples,
    ...b.dimmedCardSamples,
    ...b.outsideSamples,
  ];
  return samplesA.reduce(
    (max, sample, index) => Math.max(max, Math.abs(sample.luminance - samplesB[index].luminance)),
    0,
  );
}
