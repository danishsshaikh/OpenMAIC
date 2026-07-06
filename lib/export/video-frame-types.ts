import type { SceneType } from '@/lib/types/stage';

export const VIDEO_FRAME_EXPORT_VERSION = 1;
export const VIDEO_FRAME_EXPORT_SCHEMA = 'openmaic.videoCompositionArtifact';
export const VIDEO_FRAME_EXPORT_TYPE = 'video-composition-debug-artifact';
export const VIDEO_FRAME_COMPILER_NAME = 'openmaic-video-export-foundation';
export const VIDEO_FRAME_TARGET_RENDERER = 'hyperframes';

export type VideoFrameRenderMode = 'slide-snapshot' | 'placeholder';
export type VideoFrameSupportStatus = 'rendered' | 'placeholder';

export interface VideoFrameCompilerInfo {
  name: typeof VIDEO_FRAME_COMPILER_NAME;
  version: typeof VIDEO_FRAME_EXPORT_VERSION;
}

export interface VideoFrameRenderTarget {
  renderer: typeof VIDEO_FRAME_TARGET_RENDERER;
  execution: 'not-included';
  outputFormats: [];
}

export interface VideoFrameUnsupportedEntry {
  family: SceneType;
  reason: string;
}

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

export interface VideoFrameHtmlEntry {
  file: string | null;
  supported: boolean;
  kind?: 'interactive' | 'quiz';
  reason?: string;
}

export interface VideoFrameEntry {
  index: number;
  sceneId: string;
  sceneTitle: string;
  sceneType: SceneType;
  file: string;
  renderMode: VideoFrameRenderMode;
  supportStatus: VideoFrameSupportStatus;
  unsupported?: VideoFrameUnsupportedEntry;
  sceneFile: string;
  audio: VideoFrameAudioEntry[];
  html: VideoFrameHtmlEntry;
}

export interface VideoFrameManifest {
  schema: typeof VIDEO_FRAME_EXPORT_SCHEMA;
  version: typeof VIDEO_FRAME_EXPORT_VERSION;
  stageTitle: string;
  exportType: typeof VIDEO_FRAME_EXPORT_TYPE;
  compiler: VideoFrameCompilerInfo;
  renderTarget: VideoFrameRenderTarget;
  exportedAt: string;
  frames: VideoFrameEntry[];
  media: VideoFrameMediaEntry[];
}

export interface VideoFrameExportPlan {
  manifest: VideoFrameManifest;
  frames: VideoFrameEntry[];
}
