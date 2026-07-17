import type { Action, SpeechAction } from '@/lib/types/action';
import type { Scene, SceneContent } from '@/lib/types/stage';

export type NarrationSyncStatus =
  | 'synced'
  | 'narration-stale'
  | 'audio-stale'
  | 'syncing'
  | 'error'
  | 'unknown-legacy';

export interface NarrationAudioSettingsFingerprint {
  language?: string;
  ttsEnabled?: boolean;
  ttsProviderId?: string;
  ttsVoice?: string;
  ttsSpeed?: number;
  ttsModelId?: string;
}

export interface NarrationSyncMetadata {
  status: NarrationSyncStatus;
  narrationSourceFingerprint?: string;
  audioSourceFingerprint?: string;
  updatedAt?: number;
  error?: string;
}

export interface NarrationSyncState {
  status: NarrationSyncStatus;
  narrationSourceFingerprint: string;
  audioSourceFingerprint: string;
  hasSpeechAudio: boolean;
}

export function normalizeNarrationText(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortStable(value));
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortStable);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const v = record[key];
      if (v !== undefined) acc[key] = sortStable(v);
      return acc;
    }, {});
}

export function getNarrationSourceFingerprint(scene: Pick<Scene, 'content' | 'title'>): string {
  return stableStringify({
    title: normalizeNarrationText(scene.title),
    content: semanticContent(scene.content),
  });
}

export function getAudioSourceFingerprint(
  scene: Pick<Scene, 'actions'>,
  settings: NarrationAudioSettingsFingerprint = {},
): string {
  return stableStringify({
    speech: speechActions(scene.actions).map((action) => ({
      id: action.id,
      text: normalizeNarrationText(action.text),
    })),
    settings,
  });
}

export function getNarrationSyncState(
  scene: Pick<Scene, 'actions' | 'content' | 'title' | 'sync'>,
  settings: NarrationAudioSettingsFingerprint = {},
): NarrationSyncState {
  const narrationSourceFingerprint = getNarrationSourceFingerprint(scene as Scene);
  const audioSourceFingerprint = getAudioSourceFingerprint(scene as Scene, settings);
  const hasSpeechAudio = speechActions(scene.actions).some(
    (action) => !!action.audioId || !!action.audioUrl,
  );
  const metadata = scene.sync;

  if (!metadata) {
    return {
      status: hasSpeechAudio ? 'unknown-legacy' : 'synced',
      narrationSourceFingerprint,
      audioSourceFingerprint,
      hasSpeechAudio,
    };
  }

  if (metadata.status === 'syncing' || metadata.status === 'error') {
    return {
      status: metadata.status,
      narrationSourceFingerprint,
      audioSourceFingerprint,
      hasSpeechAudio,
    };
  }

  if (
    metadata.narrationSourceFingerprint &&
    metadata.narrationSourceFingerprint !== narrationSourceFingerprint
  ) {
    return {
      status: 'narration-stale',
      narrationSourceFingerprint,
      audioSourceFingerprint,
      hasSpeechAudio,
    };
  }

  if (metadata.audioSourceFingerprint && metadata.audioSourceFingerprint !== audioSourceFingerprint) {
    return {
      status: 'audio-stale',
      narrationSourceFingerprint,
      audioSourceFingerprint,
      hasSpeechAudio,
    };
  }

  if (metadata.status === 'narration-stale' || metadata.status === 'audio-stale') {
    return {
      status: metadata.status,
      narrationSourceFingerprint,
      audioSourceFingerprint,
      hasSpeechAudio,
    };
  }

  return {
    status: metadata.status === 'unknown-legacy' ? 'unknown-legacy' : 'synced',
    narrationSourceFingerprint,
    audioSourceFingerprint,
    hasSpeechAudio,
  };
}

export function syncedNarrationMetadata(
  scene: Pick<Scene, 'actions' | 'content' | 'title'>,
  settings: NarrationAudioSettingsFingerprint = {},
): NarrationSyncMetadata {
  return {
    status: 'synced',
    narrationSourceFingerprint: getNarrationSourceFingerprint(scene as Scene),
    audioSourceFingerprint: getAudioSourceFingerprint(scene as Scene, settings),
    updatedAt: Date.now(),
  };
}

export function staleNarrationMetadata(
  scene: Pick<Scene, 'actions' | 'content' | 'title'>,
  settings: NarrationAudioSettingsFingerprint = {},
): NarrationSyncMetadata {
  return {
    ...syncedNarrationMetadata(scene, settings),
    status: 'narration-stale',
  };
}

export function staleAudioMetadata(
  scene: Pick<Scene, 'actions' | 'content' | 'title'>,
  settings: NarrationAudioSettingsFingerprint = {},
): NarrationSyncMetadata {
  return {
    ...syncedNarrationMetadata(scene, settings),
    status: 'audio-stale',
  };
}

export function applyNarrationSyncForSceneUpdate(
  previous: Scene,
  next: Scene,
  settings: NarrationAudioSettingsFingerprint = {},
): Scene {
  const previousNarration = getNarrationSourceFingerprint(previous);
  const nextNarration = getNarrationSourceFingerprint(next);
  const previousAudio = getAudioSourceFingerprint(previous, settings);
  const nextAudio = getAudioSourceFingerprint(next, settings);
  const hasAudio = speechActions(previous.actions).some((a) => !!a.audioId || !!a.audioUrl);
  const hasSpeech = speechActions(next.actions).length > 0;

  if (previousNarration !== nextNarration && hasSpeech) {
    return {
      ...next,
      sync: {
        status: 'narration-stale',
        narrationSourceFingerprint: previousNarration,
        audioSourceFingerprint: previousAudio,
        updatedAt: Date.now(),
      },
    };
  }

  if (previousAudio !== nextAudio && (hasAudio || hasSpeech)) {
    return {
      ...next,
      sync: {
        status: 'audio-stale',
        narrationSourceFingerprint: nextNarration,
        audioSourceFingerprint: previousAudio,
        updatedAt: Date.now(),
      },
    };
  }

  if (!next.sync && hasSpeech) {
    return { ...next, sync: syncedNarrationMetadata(next, settings) };
  }

  return next;
}

function speechActions(actions: readonly Action[] | undefined): SpeechAction[] {
  return (actions ?? []).filter((action): action is SpeechAction => action.type === 'speech');
}

function semanticContent(content: SceneContent): unknown {
  switch (content.type) {
    case 'slide':
      return content.canvas.elements.map(semanticSlideElement);
    case 'quiz':
      return content.questions.map((question) => ({
        type: question.type,
        question: normalizeNarrationText(question.question),
        options: question.options?.map((option) => ({
          label: option.label,
          value: normalizeNarrationText(option.value),
        })),
        answer: question.answer,
        analysis: normalizeNarrationText(question.analysis),
      }));
    case 'interactive':
      return {
        widgetType: content.widgetType,
        widgetConfig: content.widgetConfig,
        html: normalizeNarrationText(content.html),
        url: content.url,
      };
    case 'pbl':
      return {
        projectConfig: content.projectConfig,
        projectV2: content.projectV2,
      };
  }
}

function semanticSlideElement(element: Record<string, unknown>): unknown {
  const type = element.type;
  const id = element.id;
  switch (type) {
    case 'text':
      return { id, type, text: normalizeNarrationText(element.content) };
    case 'shape':
      return {
        id,
        type,
        text: normalizeNarrationText((element.text as { content?: unknown } | undefined)?.content),
      };
    case 'table':
      return {
        id,
        type,
        cells: (element.data as Array<Array<{ text?: unknown }>> | undefined)?.map((row) =>
          row.map((cell) => normalizeNarrationText(cell.text)),
        ),
      };
    case 'chart':
      return { id, type, data: element.data };
    case 'latex':
      return { id, type, latex: normalizeNarrationText(element.latex) };
    case 'code':
      return {
        id,
        type,
        language: element.language,
        lines: (element.lines as Array<{ content?: unknown }> | undefined)?.map((line) =>
          normalizeNarrationText(line.content),
        ),
      };
    case 'image':
    case 'video':
    case 'audio':
      return { id, type };
    default:
      return { id, type, text: normalizeNarrationText(stableStringify(element)) };
  }
}
