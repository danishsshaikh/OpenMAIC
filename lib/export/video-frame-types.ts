import type { SceneType } from '@/lib/types/stage';

export const VIDEO_FRAME_EXPORT_VERSION = 1;
export const VIDEO_FRAME_EXPORT_TYPE = 'video-frame-foundation';

export type VideoFrameRenderMode = 'slide-snapshot' | 'placeholder';

export interface VideoFrameAudioEntry {
  actionId?: string;
  actionIndex: number;
  text: string;
  file: string | null;
  missing: boolean;
  reason?: string;
  duration?: number;
  voice?: string;
  format?: string;
}

export interface VideoFrameMediaEntry {
  elementId: string;
  file: string;
  type: 'image' | 'video';
  mimeType: string;
  size: number;
  prompt?: string;
  posterFile?: string;
}

export interface VideoFrameEntry {
  index: number;
  sceneId: string;
  sceneTitle: string;
  sceneType: SceneType;
  file: string;
  renderMode: VideoFrameRenderMode;
  sceneFile: string;
  audio: VideoFrameAudioEntry[];
}

export interface VideoFrameManifest {
  version: typeof VIDEO_FRAME_EXPORT_VERSION;
  stageTitle: string;
  exportType: typeof VIDEO_FRAME_EXPORT_TYPE;
  exportedAt: string;
  frames: VideoFrameEntry[];
  media: VideoFrameMediaEntry[];
}

export interface VideoFrameExportPlan {
  manifest: VideoFrameManifest;
  frames: VideoFrameEntry[];
}
