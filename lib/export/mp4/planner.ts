import type { SpeechAction } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import type { VideoFrameEntry } from '@/lib/export/video-frame-types';
import {
  LOCAL_MP4_EXPORT_VERSION,
  type LocalMp4ExportManifest,
  type LocalMp4MissingAudio,
  type LocalMp4Segment,
  type LocalMp4Warning,
} from './types';

export interface BuildLocalMp4ManifestInput {
  stageTitle: string;
  frames: VideoFrameEntry[];
  scenes: Scene[];
  frameWidth: number;
  frameHeight: number;
  resolveAudioFile: (input: {
    scene: Scene;
    frame: VideoFrameEntry;
    action: SpeechAction;
    actionIndex: number;
    speechIndex: number;
  }) => string | null;
}

export interface LocalMp4ManifestPlan {
  manifest: LocalMp4ExportManifest;
  missingAudio: LocalMp4MissingAudio[];
}

export function buildLocalMp4Manifest({
  stageTitle,
  frames,
  scenes,
  frameWidth,
  frameHeight,
  resolveAudioFile,
}: BuildLocalMp4ManifestInput): LocalMp4ManifestPlan {
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  const segments: LocalMp4Segment[] = [];
  const warnings: LocalMp4Warning[] = [];
  const missingAudio: LocalMp4MissingAudio[] = [];

  for (const frame of frames) {
    const scene = scenesById.get(frame.sceneId);
    if (!scene) {
      warnings.push({
        sceneId: frame.sceneId,
        sceneTitle: frame.sceneTitle,
        reason: 'scene data missing for rendered frame',
      });
      continue;
    }

    let speechIndex = 0;
    let sceneSegmentCount = 0;
    for (const [actionIndex, action] of (scene.actions ?? []).entries()) {
      if (action.type !== 'speech') continue;
      const speech = action as SpeechAction;
      if (!speech.text?.trim()) continue;
      speechIndex++;

      const audioFile = resolveAudioFile({
        scene,
        frame,
        action: speech,
        actionIndex,
        speechIndex,
      });

      if (!audioFile) {
        missingAudio.push({
          sceneId: scene.id,
          sceneTitle: scene.title,
          actionId: typeof speech.id === 'string' ? speech.id : undefined,
          actionIndex,
          reason: speech.audioUrl
            ? 'audioUrl could not be bundled'
            : 'missing generated audioId/audioUrl',
        });
        continue;
      }

      segments.push({
        id: `segment-${String(segments.length + 1).padStart(4, '0')}`,
        index: segments.length + 1,
        sceneId: scene.id,
        sceneTitle: scene.title,
        sceneType: scene.type,
        sceneIndex: frame.index,
        actionId: typeof speech.id === 'string' ? speech.id : undefined,
        actionIndex,
        text: speech.text,
        frameFile: frame.file,
        audioFile,
      });
      sceneSegmentCount++;
    }

    if (sceneSegmentCount === 0) {
      warnings.push({
        sceneId: scene.id,
        sceneTitle: scene.title,
        reason: 'scene has no exportable generated narration audio and is omitted from MP4 timing',
      });
    }
  }

  return {
    manifest: {
      version: LOCAL_MP4_EXPORT_VERSION,
      stageTitle,
      frameWidth,
      frameHeight,
      segments,
      warnings,
    },
    missingAudio,
  };
}

export function sanitizeMp4PathPart(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
}
