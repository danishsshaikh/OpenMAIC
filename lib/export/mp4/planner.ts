import tinycolor from 'tinycolor2';
import type { Action, LaserAction, SpeechAction, SpotlightAction } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import type { VideoFrameEntry } from '@/lib/export/video-frame-types';
import {
  LOCAL_MP4_EXPORT_VERSION,
  type LocalMp4LaserEffect,
  type LocalMp4ExportManifest,
  type LocalMp4MissingAudio,
  type LocalMp4Segment,
  type LocalMp4SpotlightEffect,
  type LocalMp4VisualEffects,
  type LocalMp4Warning,
} from './types';

export interface LocalMp4SpeechSegmentVisual {
  scene: Scene;
  frame: VideoFrameEntry;
  action: SpeechAction;
  actionIndex: number;
  speechIndex: number;
  effects?: LocalMp4VisualEffects;
  frameFile: string;
  frameKey: string;
}

export interface LocalMp4VisualFrame {
  key: string;
  file: string;
  frame: VideoFrameEntry;
  scene: Scene;
  effects?: LocalMp4VisualEffects;
}

export interface LocalMp4EffectStats {
  spotlightActions: number;
  laserActions: number;
  assignedEffects: number;
  omittedEffects: number;
  uniqueEffectFrames: number;
}

export interface LocalMp4SpeechSegmentVisualPlan {
  segments: LocalMp4SpeechSegmentVisual[];
  visualFrames: LocalMp4VisualFrame[];
  warnings: LocalMp4Warning[];
  stats: LocalMp4EffectStats;
}

export interface BuildLocalMp4SpeechSegmentVisualPlanInput {
  frames: VideoFrameEntry[];
  scenes: Scene[];
  getFrameFile?: (input: {
    frame: VideoFrameEntry;
    effects?: LocalMp4VisualEffects;
    frameKey: string;
  }) => string;
}

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
  segmentVisuals?: LocalMp4SpeechSegmentVisual[];
  visualWarnings?: LocalMp4Warning[];
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
  segmentVisuals,
  visualWarnings = [],
}: BuildLocalMp4ManifestInput): LocalMp4ManifestPlan {
  const visualPlan = segmentVisuals
    ? null
    : buildLocalMp4SpeechSegmentVisualPlan({ frames, scenes });
  const speechSegments = segmentVisuals ?? visualPlan?.segments ?? [];
  const segments: LocalMp4Segment[] = [];
  const warnings: LocalMp4Warning[] = [...visualWarnings, ...(visualPlan?.warnings ?? [])];
  const missingAudio: LocalMp4MissingAudio[] = [];
  const scenesWithSegments = new Set<string>();

  for (const segment of speechSegments) {
    const audioFile = resolveAudioFile({
      scene: segment.scene,
      frame: segment.frame,
      action: segment.action,
      actionIndex: segment.actionIndex,
      speechIndex: segment.speechIndex,
    });

    if (!audioFile) {
      missingAudio.push({
        sceneId: segment.scene.id,
        sceneTitle: segment.scene.title,
        actionId: typeof segment.action.id === 'string' ? segment.action.id : undefined,
        actionIndex: segment.actionIndex,
        reason: segment.action.audioId
          ? 'generated audio file not found'
          : segment.action.audioUrl
            ? 'audioUrl could not be bundled'
            : 'missing generated audioId/audioUrl',
      });
      continue;
    }

    segments.push({
      id: `segment-${String(segments.length + 1).padStart(4, '0')}`,
      index: segments.length + 1,
      sceneId: segment.scene.id,
      sceneTitle: segment.scene.title,
      sceneType: segment.scene.type,
      sceneIndex: segment.frame.index,
      actionId: typeof segment.action.id === 'string' ? segment.action.id : undefined,
      actionIndex: segment.actionIndex,
      frameFile: segment.frameFile,
      audioFile,
    });
    scenesWithSegments.add(segment.scene.id);
  }

  for (const frame of frames) {
    if (scenesWithSegments.has(frame.sceneId)) continue;
    const scene = scenes.find((candidate) => candidate.id === frame.sceneId);
    warnings.push(
      scene
        ? {
            sceneId: scene.id,
            sceneTitle: scene.title,
            sceneIndex: frame.index,
            reason:
              'scene has no exportable generated narration audio and is omitted from MP4 timing',
          }
        : {
            sceneId: frame.sceneId,
            sceneTitle: frame.sceneTitle,
            sceneIndex: frame.index,
            reason: 'scene data missing for rendered frame',
          },
    );
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

export function buildLocalMp4SpeechSegmentVisualPlan({
  frames,
  scenes,
  getFrameFile = ({ frame, effects }) => buildLocalMp4VisualFrameFile(frame.file, effects),
}: BuildLocalMp4SpeechSegmentVisualPlanInput): LocalMp4SpeechSegmentVisualPlan {
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  const segments: LocalMp4SpeechSegmentVisual[] = [];
  const visualFramesByKey = new Map<string, LocalMp4VisualFrame>();
  const warnings: LocalMp4Warning[] = [];
  const stats: LocalMp4EffectStats = {
    spotlightActions: 0,
    laserActions: 0,
    assignedEffects: 0,
    omittedEffects: 0,
    uniqueEffectFrames: 0,
  };

  for (const frame of frames) {
    const scene = scenesById.get(frame.sceneId);
    if (!scene) {
      warnings.push({
        sceneId: frame.sceneId,
        sceneTitle: frame.sceneTitle,
        sceneIndex: frame.index,
        reason: 'scene data missing for rendered frame',
      });
      continue;
    }

    let speechIndex = 0;
    const pending: PendingEffects = {};
    for (const [actionIndex, action] of (scene.actions ?? []).entries()) {
      if (action.type === 'spotlight') {
        stats.spotlightActions++;
        const effect = normalizeSpotlightEffect(action);
        if (isSpotlightTargetRenderable(scene, effect.elementId)) {
          pending.spotlight = { effect, actionIndex };
        } else {
          stats.omittedEffects++;
          warnings.push(
            effectWarning(scene, frame.index, actionIndex, action.type, 'target missing'),
          );
        }
        continue;
      }

      if (action.type === 'laser') {
        stats.laserActions++;
        const effect = normalizeLaserEffect(action);
        if (isEffectTargetRenderable(scene, effect.elementId)) {
          pending.laser = { effect, actionIndex };
        } else {
          stats.omittedEffects++;
          warnings.push(
            effectWarning(scene, frame.index, actionIndex, action.type, 'target missing'),
          );
        }
        continue;
      }

      if (action.type !== 'speech') continue;
      const speech = action as SpeechAction;
      if (!speech.text?.trim()) continue;
      speechIndex++;

      const effects = pendingEffectsToVisualEffects(pending);
      const frameKey = buildLocalMp4VisualFrameKey(frame.file, effects);
      const frameFile = getFrameFile({ frame, effects, frameKey });
      logMp4SpotlightExportTrace(scene, frame, pending, speech, frameKey);
      const segment: LocalMp4SpeechSegmentVisual = {
        scene,
        frame,
        action: speech,
        actionIndex,
        speechIndex,
        effects,
        frameFile,
        frameKey,
      };
      segments.push(segment);

      if (!visualFramesByKey.has(frameKey)) {
        visualFramesByKey.set(frameKey, {
          key: frameKey,
          file: frameFile,
          frame,
          scene,
          effects,
        });
      }

      stats.assignedEffects += countEffects(effects);
      pending.spotlight = undefined;
      pending.laser = undefined;
    }

    for (const pendingEffect of [pending.spotlight, pending.laser]) {
      if (!pendingEffect) continue;
      stats.omittedEffects++;
      warnings.push(
        effectWarning(
          scene,
          frame.index,
          pendingEffect.actionIndex,
          pendingEffect.effect === pending.spotlight?.effect ? 'spotlight' : 'laser',
          'no following speech segment',
        ),
      );
    }
  }

  stats.uniqueEffectFrames = [...visualFramesByKey.values()].filter((frame) =>
    hasEffects(frame.effects),
  ).length;
  return { segments, visualFrames: [...visualFramesByKey.values()], warnings, stats };
}

interface PendingEffects {
  spotlight?: { effect: LocalMp4SpotlightEffect; actionIndex: number };
  laser?: { effect: LocalMp4LaserEffect; actionIndex: number };
}

function normalizeSpotlightEffect(action: SpotlightAction): LocalMp4SpotlightEffect {
  return {
    elementId: action.elementId,
    dimOpacity: clampOpacity(action.dimOpacity),
  };
}

function normalizeLaserEffect(action: LaserAction): LocalMp4LaserEffect {
  return {
    elementId: action.elementId,
    color: normalizeLaserColor(action.color),
  };
}

export function normalizeLaserColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const parsed = tinycolor(color);
  return parsed.isValid() ? parsed.toHexString() : undefined;
}

export function clampOpacity(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function pendingEffectsToVisualEffects(pending: PendingEffects): LocalMp4VisualEffects | undefined {
  const effects: LocalMp4VisualEffects = {};
  if (pending.spotlight) effects.spotlight = pending.spotlight.effect;
  if (pending.laser) effects.laser = pending.laser.effect;
  return hasEffects(effects) ? effects : undefined;
}

function isEffectTargetRenderable(scene: Scene, elementId: string): boolean {
  if (!elementId || scene.content.type !== 'slide') return false;
  return scene.content.canvas.elements.some((element) => element.id === elementId);
}

function isSpotlightTargetRenderable(scene: Scene, elementId: string): boolean {
  if (!elementId || scene.content.type !== 'slide') return false;
  // Spotlight uses DOM geometry at snapshot time, matching classroom playback.
  // Do not drop valid live targets here just because the static scene model
  // cannot prove the target; the renderer will safely fall back to a base frame
  // when the DOM target is genuinely missing or has invalid geometry.
  return true;
}

function effectWarning(
  scene: Scene,
  sceneIndex: number,
  actionIndex: number,
  actionType: Action['type'],
  reason: string,
): LocalMp4Warning {
  return {
    sceneId: scene.id,
    sceneTitle: scene.title,
    sceneIndex,
    actionIndex,
    actionType,
    reason: `teaching effect omitted: ${reason}`,
  };
}

export function buildLocalMp4VisualFrameKey(
  frameFile: string,
  effects?: LocalMp4VisualEffects,
): string {
  if (!hasEffects(effects)) return `base:${frameFile}`;
  return `effect:${frameFile}:${stableEffectKey(effects)}`;
}

export function buildLocalMp4VisualFrameFile(
  frameFile: string,
  effects?: LocalMp4VisualEffects,
  extension = frameFile.split('.').pop() || 'png',
): string {
  if (!hasEffects(effects)) return frameFile;
  const base = frameFile
    .split('/')
    .pop()
    ?.replace(/\.[^.]+$/i, '')
    .replace(/-placeholder$/i, '');
  const suffix = hashString(stableEffectKey(effects));
  return `frames/${sanitizeMp4PathPart(base || 'scene')}-fx-${suffix}.${extension}`;
}

function stableEffectKey(effects: LocalMp4VisualEffects): string {
  return JSON.stringify({
    spotlight: effects.spotlight
      ? {
          elementId: effects.spotlight.elementId,
          dimOpacity: effects.spotlight.dimOpacity,
        }
      : null,
    laser: effects.laser
      ? {
          elementId: effects.laser.elementId,
          color: effects.laser.color,
        }
      : null,
  });
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function countEffects(effects: LocalMp4VisualEffects | undefined): number {
  return (effects?.spotlight ? 1 : 0) + (effects?.laser ? 1 : 0);
}

function logMp4SpotlightExportTrace(
  scene: Scene,
  frame: VideoFrameEntry,
  pending: PendingEffects,
  speech: SpeechAction,
  frameKey: string,
) {
  if (process.env.NODE_ENV === 'production') return;
  if (typeof console === 'undefined' || typeof console.info !== 'function') return;
  const spotlight = pending.spotlight;
  if (!spotlight) return;
  const element =
    scene.content.type === 'slide'
      ? scene.content.canvas.elements.find(
          (candidate) => candidate.id === spotlight.effect.elementId,
        )
      : undefined;
  const payload = {
    sceneId: scene.id,
    sceneTitle: scene.title,
    actionId:
      typeof scene.actions?.[spotlight.actionIndex]?.id === 'string'
        ? scene.actions[spotlight.actionIndex].id
        : undefined,
    elementId: spotlight.effect.elementId,
    narrationPreview: speech.text.slice(0, 80),
  };
  console.info('[SpotlightExportTrace]', {
    checkpoint: 'saved-action-target',
    ...payload,
    actionType: 'spotlight',
    savedElementType: element?.type,
    savedActionTargetFlat: [
      [
        scene.id,
        payload.actionId ?? '',
        spotlight.effect.elementId,
        element?.type ?? '',
        speech.id ?? '',
        payload.narrationPreview,
      ].join(':'),
    ],
  });
  console.info('[SpotlightExportTrace]', {
    checkpoint: 'planner-effect-target',
    sceneId: scene.id,
    frameKey,
    elementId: spotlight.effect.elementId,
    plannerTargetFlat: [[scene.id, frame.index, frameKey, spotlight.effect.elementId].join(':')],
  });
}

export function hasEffects(
  effects: LocalMp4VisualEffects | undefined,
): effects is LocalMp4VisualEffects {
  return !!effects?.spotlight || !!effects?.laser;
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

export function speechAudioLookupIds(
  sceneOrder: number,
  action: Pick<SpeechAction, 'id' | 'audioId'>,
): string[] {
  const ids: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };

  add(action.audioId);
  if (typeof action.id === 'string' && action.id.trim()) {
    add(`tts_s${sceneOrder}_${action.id}`);
    add(`tts_${action.id}`);
  }

  return ids;
}
