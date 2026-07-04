import type { Scene } from '@/lib/types/stage';
import {
  VIDEO_FRAME_EXPORT_TYPE,
  VIDEO_FRAME_EXPORT_VERSION,
  type VideoFrameEntry,
  type VideoFrameExportPlan,
} from '@/lib/export/video-frame-types';

export class VideoFramePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoFramePlanError';
  }
}

interface BuildVideoFrameExportPlanInput {
  stageTitle: string;
  scenes: Scene[];
  exportedAt?: string;
}

export function sanitizeVideoFrameFilenamePart(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');

  return normalized.slice(0, 80) || 'scene';
}

export function buildVideoFrameExportPlan({
  stageTitle,
  scenes,
  exportedAt = new Date().toISOString(),
}: BuildVideoFrameExportPlanInput): VideoFrameExportPlan {
  if (scenes.length === 0) {
    throw new VideoFramePlanError('No scenes available to export');
  }

  const orderedScenes = scenes
    .map((scene, inputIndex) => ({ scene, inputIndex }))
    .sort((a, b) => {
      const orderDiff = (a.scene.order ?? a.inputIndex) - (b.scene.order ?? b.inputIndex);
      return orderDiff === 0 ? a.inputIndex - b.inputIndex : orderDiff;
    });

  const usedFiles = new Map<string, number>();
  const frames: VideoFrameEntry[] = orderedScenes.map(({ scene }, frameIndex) => {
    const index = frameIndex + 1;
    const renderMode =
      scene.type === 'slide' && scene.content.type === 'slide' ? 'slide-snapshot' : 'placeholder';
    const suffix = renderMode === 'placeholder' ? '-placeholder' : '';
    const baseName = `${String(index).padStart(3, '0')}-${sanitizeVideoFrameFilenamePart(
      scene.title,
    )}${suffix}`;
    const file = uniqueFileName(`${baseName}.png`, usedFiles);

    return {
      index,
      sceneId: scene.id,
      sceneTitle: scene.title,
      sceneType: scene.type,
      file,
      renderMode,
    };
  });

  return {
    frames,
    manifest: {
      version: VIDEO_FRAME_EXPORT_VERSION,
      stageTitle,
      exportType: VIDEO_FRAME_EXPORT_TYPE,
      exportedAt,
      frames,
    },
  };
}

function uniqueFileName(fileName: string, usedFiles: Map<string, number>): string {
  const count = usedFiles.get(fileName) ?? 0;
  usedFiles.set(fileName, count + 1);
  if (count === 0) return fileName;

  const dotIndex = fileName.lastIndexOf('.');
  const stem = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex) : '';
  return uniqueFileName(`${stem}-${count + 1}${ext}`, usedFiles);
}
