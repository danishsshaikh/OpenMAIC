import type { SpeechAction } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import type { CollectedMedia } from './classroom-zip-utils';
import type { VideoFrameManifest, VideoFrameMediaEntry } from './video-frame-types';

interface VideoFrameAudioRecord {
  format?: string;
  duration?: number;
  voice?: string;
}

export function withVideoFrameSidecarMetadata(
  manifest: VideoFrameManifest,
  scenes: Scene[],
  audioById: Map<string, VideoFrameAudioRecord>,
  generatedMedia: CollectedMedia[],
): VideoFrameManifest {
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));

  return {
    ...manifest,
    frames: manifest.frames.map((frame) => {
      const scene = scenesById.get(frame.sceneId);
      return {
        ...frame,
        audio: frame.audio.map((audio) => {
          const action = scene?.actions?.[audio.actionIndex];
          const audioId = action?.type === 'speech' ? (action as SpeechAction).audioId : undefined;
          if (!audioId) return audio;

          const record = audioById.get(audioId);
          if (!record) {
            return {
              ...audio,
              file: null,
              missing: true,
              reason: 'audio file not found',
            };
          }

          const format = record.format || 'mp3';
          const file = replaceFileExtension(audio.file, format);
          return {
            ...audio,
            file,
            missing: false,
            reason: undefined,
            format,
            duration: record.duration,
            voice: record.voice,
          };
        }),
      };
    }),
    media: generatedMedia.map(toVideoFrameMediaEntry),
  };
}

function toVideoFrameMediaEntry(media: CollectedMedia): VideoFrameMediaEntry {
  const posterFile = media.record.poster
    ? media.zipPath.replace(/\.\w+$/, '.poster.jpg')
    : undefined;
  return {
    elementId: media.elementId,
    file: media.zipPath,
    type: media.record.type,
    mimeType: media.record.mimeType,
    size: media.record.size,
    prompt: media.record.prompt,
    ...(posterFile ? { posterFile } : {}),
  };
}

function replaceFileExtension(file: string | null, extension: string): string | null {
  if (!file) return file;
  return file.replace(/\.[^.]+$/, `.${extension || 'mp3'}`);
}
