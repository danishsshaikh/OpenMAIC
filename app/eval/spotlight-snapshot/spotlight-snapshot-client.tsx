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
  outsideSamples: PixelSample[];
  focusEdgeSamples: PixelSample[];
  targetLuminance: number;
  outsideLuminance: number;
  focusEdgeLuminance: number;
};

export type SpotlightSnapshotResult = {
  base: SnapshotFrameResult;
  spotlight: SnapshotFrameResult;
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

const targetShape: PPTShapeElement = {
  id: 'target-card',
  type: 'shape',
  left: 150,
  top: 70,
  width: 100,
  height: 60,
  rotate: 0,
  viewBox: [100, 60],
  path: 'M 0 0 L 100 0 L 100 60 L 0 60 Z',
  fixedRatio: false,
  fill: '#ffffff',
  outline: { width: 0, color: 'transparent' },
  opacity: 1,
  text: {
    content: '<p>Focus</p>',
    defaultFontName: 'Arial',
    defaultColor: '#111111',
    align: 'middle',
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
  elements: [targetShape],
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
      setPreview(spotlight.dataUrl);

      return {
        base,
        spotlight,
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
        id="slide-element-target-card"
        data-element-id="target-card"
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
) {
  const dataUrl = (await slideToPng(slide, {
    width: WIDTH,
    pixelRatio: 1,
    format: 'dataUrl',
    backgroundColor: '#ffffff',
    effects,
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
    samplePixel(context, 164, 84),
    samplePixel(context, 236, 84),
    samplePixel(context, 164, 118),
    samplePixel(context, 236, 118),
  ];
  const outsideSamples = [
    samplePixel(context, 30, 30),
    samplePixel(context, 370, 30),
    samplePixel(context, 30, 200),
    samplePixel(context, 370, 200),
  ];
  const focusEdgeSamples = [
    samplePixel(context, 150, 70),
    samplePixel(context, 249, 70),
    samplePixel(context, 150, 129),
    samplePixel(context, 249, 129),
  ];

  return {
    dataUrl,
    dataUrlLength: dataUrl.length,
    width: image.naturalWidth,
    height: image.naturalHeight,
    targetSamples,
    outsideSamples,
    focusEdgeSamples,
    targetLuminance: averageLuminance(targetSamples),
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
