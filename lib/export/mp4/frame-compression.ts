'use client';

export interface CompressedMp4Frame {
  blob: Blob;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
}

export interface CompressFrameForMp4UploadOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

const DEFAULT_MAX_WIDTH = 1920;
const DEFAULT_MAX_HEIGHT = 1080;
const DEFAULT_QUALITY = 0.86;

export async function compressFrameForMp4Upload(
  source: Blob,
  options: CompressFrameForMp4UploadOptions = {},
): Promise<CompressedMp4Frame> {
  const image = await loadFrameImage(source);
  const sourceWidth = getImageWidth(image);
  const sourceHeight = getImageHeight(image);
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = Math.max(2, Math.round(sourceWidth * scale));
  const height = Math.max(2, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    closeLoadedImage(image);
    throw new Error('Canvas rendering is not available for MP4 frame compression');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  closeLoadedImage(image);

  const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  return {
    blob,
    width,
    height,
    mimeType: 'image/jpeg',
  };
}

async function loadFrameImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    return createImageBitmap(blob);
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function closeLoadedImage(image: ImageBitmap | HTMLImageElement): void {
  if ('close' in image) image.close();
}

function getImageWidth(image: ImageBitmap | HTMLImageElement): number {
  return 'naturalWidth' in image ? image.naturalWidth : image.width;
}

function getImageHeight(image: ImageBitmap | HTMLImageElement): number {
  return 'naturalHeight' in image ? image.naturalHeight : image.height;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode MP4 frame image'));
      },
      type,
      quality,
    );
  });
}
