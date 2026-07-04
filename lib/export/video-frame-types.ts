import type { SceneType } from '@/lib/types/stage';

export const VIDEO_FRAME_EXPORT_VERSION = 1;
export const VIDEO_FRAME_EXPORT_TYPE = 'video-frame-foundation';

export type VideoFrameRenderMode = 'slide-snapshot' | 'placeholder';

export interface VideoFrameEntry {
  index: number;
  sceneId: string;
  sceneTitle: string;
  sceneType: SceneType;
  file: string;
  renderMode: VideoFrameRenderMode;
}

export interface VideoFrameManifest {
  version: typeof VIDEO_FRAME_EXPORT_VERSION;
  stageTitle: string;
  exportType: typeof VIDEO_FRAME_EXPORT_TYPE;
  exportedAt: string;
  frames: VideoFrameEntry[];
}

export interface VideoFrameExportPlan {
  manifest: VideoFrameManifest;
  frames: VideoFrameEntry[];
}
