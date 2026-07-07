'use client';

import { useCallback, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import type { SpeechAction } from '@/lib/types/action';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import { collectAudioFiles } from './classroom-zip-utils';
import { buildLocalMp4Manifest, sanitizeMp4PathPart, speechAudioLookupIds } from './mp4/planner';
import type { LocalMp4MissingAudio } from './mp4/types';
import { buildVideoFrameExportPlan, sanitizeVideoFrameFilenamePart } from './video-frame-planner';
import { renderVideoFrame, VIDEO_FRAME_HEIGHT, VIDEO_FRAME_WIDTH } from './use-export-video-frames';
import { db, type AudioFileRecord } from '@/lib/utils/database';
import { generateAndStoreTTS } from '@/lib/hooks/use-scene-generator';
import { createLogger } from '@/lib/logger';

const log = createLogger('ExportVideoMp4');

type ActionAudioKey = `${string}:${number}`;

export function useExportVideoMp4() {
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const { t } = useI18n();

  const exportVideoMp4 = useCallback(async () => {
    if (exportingRef.current) return;

    const { stage, scenes } = useStageStore.getState();
    if (!stage || scenes.length === 0) {
      toast.error(t('export.videoMp4.noScenes'));
      return;
    }

    exportingRef.current = true;
    setExporting(true);
    const toastId = toast.loading(t('export.videoMp4.exporting'));

    try {
      const latestStage = await db.stages.get(stage.id).catch(() => undefined);
      const stageTitle = latestStage?.name || stage.name || 'classroom';
      const language = latestStage?.languageDirective || stage.languageDirective;
      const plan = buildVideoFrameExportPlan({ stageTitle, scenes });
      const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
      const mediaRecords = await db.mediaFiles.where('stageId').equals(stage.id).toArray();
      const audioRecords = await collectAudioFiles(scenes);
      const audioById = new Map(audioRecords.map((audio) => [audio.record.id, audio.record]));
      const frameBlobs = new Map<string, Blob>();
      const audioBlobs = new Map<string, Blob>();
      const audioFilesByAction = new Map<ActionAudioKey, string>();

      for (const frame of plan.frames) {
        const scene = sceneById.get(frame.sceneId);
        frameBlobs.set(frame.file, await renderVideoFrame(frame, scene, mediaRecords, t));
      }

      for (const frame of plan.frames) {
        const scene = sceneById.get(frame.sceneId);
        if (!scene) continue;

        let speechIndex = 0;
        for (const [actionIndex, action] of (scene.actions ?? []).entries()) {
          if (action.type !== 'speech') continue;
          const speech = action as SpeechAction;
          if (!speech.text?.trim()) continue;
          speechIndex++;

          const audio = await resolveSpeechAudioBlob(scene.order, speech, audioById, language);
          if (!audio) continue;

          const file = audioFileForSpeech(frame.file, speechIndex, audio.extension);
          audioFilesByAction.set(actionAudioKey(scene.id, actionIndex), file);
          audioBlobs.set(file, audio.blob);
        }
      }

      const mp4Plan = buildLocalMp4Manifest({
        stageTitle,
        frames: plan.frames,
        scenes,
        frameWidth: VIDEO_FRAME_WIDTH,
        frameHeight: VIDEO_FRAME_HEIGHT,
        resolveAudioFile: ({ scene, actionIndex }) =>
          audioFilesByAction.get(actionAudioKey(scene.id, actionIndex)) ?? null,
      });

      if (mp4Plan.missingAudio.length > 0) {
        throw new MissingAudioExportError(mp4Plan.missingAudio);
      }

      const formData = new FormData();
      formData.append('manifest', JSON.stringify(mp4Plan.manifest));

      const usedFrameFiles = new Set(mp4Plan.manifest.segments.map((segment) => segment.frameFile));
      for (const frameFile of usedFrameFiles) {
        const blob = frameBlobs.get(frameFile);
        if (blob) formData.append(`frame:${frameFile}`, blob, fileName(frameFile));
      }

      for (const [audioFile, blob] of audioBlobs) {
        formData.append(`audio:${audioFile}`, blob, fileName(audioFile));
      }

      const response = await fetch('/api/export/video-mp4', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await readMp4Error(response));
      }

      const mp4Blob = await response.blob();
      saveAs(mp4Blob, `${sanitizeVideoFrameFilenamePart(stageTitle)}.mp4`);
      toast.success(t('export.videoMp4.exportSuccess'), { id: toastId });
    } catch (error) {
      log.error('Local MP4 export failed:', error);
      toast.error(t('export.videoMp4.exportFailed'), {
        id: toastId,
        description: getErrorMessage(error),
      });
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [t]);

  return { exporting, exportVideoMp4 };
}

async function resolveSpeechAudioBlob(
  sceneOrder: number,
  speech: SpeechAction,
  audioById: Map<string, AudioFileRecord>,
  language?: string,
): Promise<{ blob: Blob; extension: string } | null> {
  const lookupIds = speechAudioLookupIds(sceneOrder, speech);
  for (const audioId of lookupIds) {
    const record = audioById.get(audioId) ?? (await db.audioFiles.get(audioId));
    if (record) {
      return {
        blob: record.blob,
        extension: normalizeAudioExtension(record.format || extensionFromMime(record.blob.type)),
      };
    }
  }

  const generatedAudioId = lookupIds[0];
  if (generatedAudioId && speech.text?.trim()) {
    await generateAndStoreTTS(generatedAudioId, speech.text, language);
    const record = await db.audioFiles.get(generatedAudioId);
    if (record) {
      return {
        blob: record.blob,
        extension: normalizeAudioExtension(record.format || extensionFromMime(record.blob.type)),
      };
    }
  }

  if (speech.audioUrl) {
    try {
      const response = await fetch(speech.audioUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      return {
        blob,
        extension: normalizeAudioExtension(
          extensionFromMime(blob.type) || extensionFromUrl(speech.audioUrl),
        ),
      };
    } catch {
      return null;
    }
  }

  return null;
}

function audioFileForSpeech(frameFile: string, speechIndex: number, extension: string): string {
  const frameName = fileName(frameFile)
    .replace(/\.png$/i, '')
    .replace(/-placeholder$/i, '');
  const safeBaseName = sanitizeMp4PathPart(frameName) || 'scene';
  const safeExtension = normalizeAudioExtension(extension);
  return `audio-mp4/${safeBaseName}/speech-${String(speechIndex).padStart(3, '0')}.${safeExtension}`;
}

function actionAudioKey(sceneId: string, actionIndex: number): ActionAudioKey {
  return `${sceneId}:${actionIndex}`;
}

function fileName(path: string): string {
  return path.split('/').pop() || 'file';
}

function normalizeAudioExtension(extension: string | undefined): string {
  const value = (extension || 'mp3').replace(/^\./, '').toLowerCase();
  if (value === 'mpeg') return 'mp3';
  if (value === 'x-wav') return 'wav';
  return /^[a-z0-9]+$/.test(value) ? value : 'mp3';
}

function extensionFromMime(mimeType: string | undefined): string {
  if (!mimeType) return '';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mp4')) return 'm4a';
  return '';
}

function extensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url, window.location.href).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return match?.[1] || 'mp3';
  } catch {
    return 'mp3';
  }
}

async function readMp4Error(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class MissingAudioExportError extends Error {
  constructor(missingAudio: LocalMp4MissingAudio[]) {
    super(formatMissingAudio(missingAudio));
    this.name = 'MissingAudioExportError';
  }
}

function formatMissingAudio(missingAudio: LocalMp4MissingAudio[]): string {
  return missingAudio
    .slice(0, 5)
    .map((missing) => {
      const action = missing.actionId
        ? ` action ${missing.actionId}`
        : ` action #${missing.actionIndex}`;
      return `${missing.sceneTitle}${action}: ${missing.reason}`;
    })
    .join('\n');
}
