import type { SceneType } from '@/lib/types/stage';

export const LOCAL_MP4_EXPORT_VERSION = 1;

export interface LocalMp4SpotlightEffect {
  elementId: string;
  dimOpacity?: number;
}

export interface LocalMp4LaserEffect {
  elementId: string;
  color?: string;
}

export interface LocalMp4VisualEffects {
  spotlight?: LocalMp4SpotlightEffect;
  laser?: LocalMp4LaserEffect;
}

export interface LocalMp4Segment {
  id: string;
  index: number;
  sceneId: string;
  sceneTitle: string;
  sceneType: SceneType;
  sceneIndex: number;
  actionId?: string;
  actionIndex: number;
  frameFile: string;
  audioFile: string;
}

export interface LocalMp4Warning {
  sceneId?: string;
  sceneTitle?: string;
  sceneIndex?: number;
  actionIndex?: number;
  actionType?: string;
  reason: string;
}

export interface LocalMp4ExportManifest {
  version: typeof LOCAL_MP4_EXPORT_VERSION;
  stageTitle: string;
  frameWidth: number;
  frameHeight: number;
  segments: LocalMp4Segment[];
  warnings: LocalMp4Warning[];
}

export interface LocalMp4MissingAudio {
  sceneId: string;
  sceneTitle: string;
  actionId?: string;
  actionIndex: number;
  reason: string;
}

export class LocalMp4ExportError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'LocalMp4ExportError';
    this.code = code;
    this.details = details;
  }
}
