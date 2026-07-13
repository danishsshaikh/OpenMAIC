import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import {
  VIDEO_FRAME_COMPILER_NAME,
  VIDEO_FRAME_EXPORT_SCHEMA,
  VIDEO_FRAME_EXPORT_TYPE,
  VIDEO_FRAME_EXPORT_VERSION,
  type VideoFrameAudioEntry,
  type VideoFrameEntry,
  type VideoFrameExportPlan,
  type VideoFrameUnsupportedEntry,
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
    const unsupported = planSceneUnsupportedEntry(scene);
    const suffix = renderMode === 'placeholder' ? '-placeholder' : '';
    const sceneBaseName = `${String(index).padStart(3, '0')}-${sanitizeVideoFrameFilenamePart(
      scene.title,
    )}`;
    const frameBaseName = `${sceneBaseName}${suffix}`;
    const file = uniqueFileName(`frames/${frameBaseName}.png`, usedFiles);
    const sceneFile = uniqueFileName(`scenes/${sceneBaseName}.json`, usedFiles);

    return {
      index,
      sceneId: scene.id,
      sceneTitle: scene.title,
      sceneType: scene.type,
      file,
      renderMode,
      supportStatus: renderMode === 'slide-snapshot' ? 'rendered' : 'placeholder',
      ...(unsupported ? { unsupported } : {}),
      sceneFile,
      audio: planSceneAudioEntries(scene, sceneBaseName, usedFiles),
      html: planSceneHtmlEntry(scene, sceneBaseName),
    };
  });

  return {
    frames,
    manifest: {
      schema: VIDEO_FRAME_EXPORT_SCHEMA,
      version: VIDEO_FRAME_EXPORT_VERSION,
      stageTitle,
      exportType: VIDEO_FRAME_EXPORT_TYPE,
      compiler: {
        name: VIDEO_FRAME_COMPILER_NAME,
        version: VIDEO_FRAME_EXPORT_VERSION,
      },
      exportedAt,
      frames,
      media: [],
    },
  };
}

function planSceneUnsupportedEntry(scene: Scene): VideoFrameUnsupportedEntry | null {
  if (scene.type === 'slide' && scene.content.type === 'slide') return null;

  return {
    family: scene.type,
    reason: getScenePlaceholderReason(scene),
  };
}

function getScenePlaceholderReason(scene: Scene): string {
  switch (scene.type) {
    case 'quiz':
      return 'Quiz scenes are preserved as scene JSON and standalone HTML sidecars for a future VideoTimeline renderer.';
    case 'interactive':
      return 'Interactive/widget scenes require runtime playback; this collector preserves scene JSON and reusable HTML sidecars when available.';
    case 'pbl':
      return 'PBL scenes require OpenMAIC task runtime; this collector preserves scene JSON for future renderer support.';
    default:
      return 'This scene type is preserved as sidecar data but is not rendered by this internal collector.';
  }
}

function planSceneHtmlEntry(scene: Scene, sceneBaseName: string) {
  if (
    scene.content.type === 'interactive' &&
    'html' in scene.content &&
    typeof scene.content.html === 'string' &&
    scene.content.html.trim()
  ) {
    return {
      file: `html/${sceneBaseName}/index.html`,
      supported: true,
      kind: 'interactive' as const,
    };
  }

  if (scene.content.type === 'quiz' && Array.isArray(scene.content.questions)) {
    return {
      file: `html/${sceneBaseName}/index.html`,
      supported: true,
      kind: 'quiz' as const,
    };
  }

  return {
    file: null,
    supported: false,
    reason:
      scene.content.type === 'interactive'
        ? 'Interactive scene has no embedded HTML content'
        : 'No reusable standalone HTML exporter exists for this scene type yet',
  };
}

function planSceneAudioEntries(
  scene: Scene,
  sceneBaseName: string,
  usedFiles: Map<string, number>,
): VideoFrameAudioEntry[] {
  let speechIndex = 0;
  const entries: VideoFrameAudioEntry[] = [];

  for (const [actionIndex, action] of (scene.actions ?? []).entries()) {
    if (action.type !== 'speech') continue;
    speechIndex++;
    const speech = action as SpeechAction;
    const text = typeof speech.text === 'string' ? speech.text : '';
    const file =
      speech.audioId && text.trim()
        ? uniqueFileName(
            `audio/${sceneBaseName}/speech-${String(speechIndex).padStart(3, '0')}.mp3`,
            usedFiles,
          )
        : null;

    entries.push({
      actionId: typeof speech.id === 'string' ? speech.id : undefined,
      actionIndex,
      text,
      file,
      missing: !file,
      ...(file ? {} : { reason: getMissingAudioReason(speech) }),
    });
  }

  return entries;
}

function getMissingAudioReason(speech: SpeechAction): string {
  if (!speech.text?.trim()) return 'empty speech text';
  if (speech.audioUrl) return 'audioUrl not bundled';
  return 'no audioId';
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
