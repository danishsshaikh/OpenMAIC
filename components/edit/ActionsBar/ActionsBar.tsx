'use client';

/**
 * ActionsBar — Pro-mode "讲解脚本" bottom bar, a horizontal film-editing timeline
 * that is also a light editor for the scene's playback `actions`.
 *
 * The scene's `actions` ARE the timeline: walked left→right, each `speech`
 * becomes an editable clip block (one spoken line, numbered) and every non-speech
 * cue (spotlight / laser / board) becomes a compact card pinned at its place in
 * the flow. Hovering a cue replays the REAL playback effect on its bound element
 * (setLaser → LaserPointerOverlay, setSpotlight → SpotlightOverlay).
 *
 * Editing (persisted via useStageStore.updateScene → actions-edit ops):
 * - speech clip text is editable inline (commit on blur);
 * - the header "添加动作" pill opens ActionPicker to insert a new action;
 * - existing items drag to reorder; each card carries a delete button;
 * - clicking an element-bound cue arms canvas pick mode (useCanvasStore.pickTarget),
 *   so the target is chosen by clicking the element directly on the slide.
 *
 * Collapsible; height-resizable from the top edge; reactive to the stage store.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Flag,
  FoldVertical,
  GripVertical,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  UnfoldVertical,
  Volume2,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils/cn';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store/stage';
import { useCanvasStore } from '@/lib/store/canvas';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { fetchSceneActions } from '@/lib/hooks/use-scene-generator';
import { createLogger } from '@/lib/logger';
import { AvatarDisplay } from '@/components/ui/avatar-display';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Action, DiscussionAction } from '@/lib/types/action';
import type { Scene, SceneType } from '@/lib/types/stage';
import { ELEMENT_BOUND, cueLabel, cueMeta, elementLabel } from './cue-meta';
import { applyCuePreview, clearCuePreview, cuePreviewFor } from './cue-preview';
import {
  appendDiscussion,
  clampInsertSlot,
  hasDiscussion,
  insertAt,
  makeAction,
  moveById,
  moveByIdDir,
  removeById,
  setAudioIdById,
  setDiscussionAgentById,
  setDiscussionPromptById,
  setDiscussionTopicById,
  setSpeechTextById,
} from './actions-edit';
import { ActionPicker } from './ActionPicker';
import type { PickerType } from './picker-options';
import {
  audioExists,
  audioObjectUrl,
  regenerateSpeechAudio,
  resolveSpeechAudioId,
  speechAudioId,
} from '@/lib/audio/regenerate-speech-tts';
import {
  buildNarrationSourceFromScene,
  getVisibleElementText,
  getAudioSourceFingerprint,
  getNarrationSyncState,
  normalizeNarrationText,
  stableStringify,
  staleAudioMetadata,
  syncedNarrationMetadata,
  type NarrationSyncState,
  type NarrationVisualBlock,
} from '@/lib/audio/narration-sync';
import type {
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  GeneratedQuizContent,
  GeneratedSlideContent,
  SceneOutline,
} from '@/lib/types/generation';

const EMPTY: Action[] = [];
const EMPTY_ELEMENTS: { id?: string; type: string; content?: string }[] = [];
const log = createLogger('NarrationSync');
const ORDER_LOG_PREFIX = '[NarrationSyncOrder]';
type NarrationGenerationSlideContent = GeneratedSlideContent & {
  narrationSource?: {
    text: string;
    elementCount: number;
    fingerprint: string;
    blocks: Array<{
      blockId: string;
      elementIds: string[];
      targetElementId: string;
      text: string;
      orderIndex: number;
    }>;
  };
  choreography?: Array<{
    targetElementId: string;
    targetText: string;
    orderIndex: number;
  }>;
};
// Stable empty set for the "no lines regenerating" state (avoids re-allocating
// on every reset and keeps a constant identity between batch runs).
const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Clear the canvas spotlight/laser preview when a cue glyph unmounts while it is
 * being hovered — most importantly when the user deletes the cue. React does not
 * fire `onMouseLeave` on unmount, so without this the previewed effect would stay
 * stuck on the slide after its cue is gone.
 */
function useClearCuePreviewOnUnmount() {
  useEffect(() => () => clearCuePreview(), []);
}

/**
 * Soft amber dashed border marking a still-incomplete clip card — an empty
 * narration line, a cue bound to no element, a discussion with no topic. A clip
 * is a card, so a dashed frame reads as "draft / unfinished" better than a dot;
 * the calmer amber stays clear of the blue interactive controls and is dropped
 * the moment the clip is filled.
 */
const INCOMPLETE_CLIP = 'border-dashed border-amber-400/70';

const MIN_H = 168;
const MAX_H = 520;
const DEFAULT_H = 224;
const LINE_H = 86; // height when collapsed to just the axis line of node icons (fits the chips)
const AXIS_FROM_TOP = 20; // px from track top to the axis center (nodes hang below it)

// Radix Select forbids an empty-string item value, so the discussion's
// "unspecified agent" choice rides a sentinel that maps back to '' on change.
const DISCUSSION_AGENT_NONE = '__none__';

type DragPayload = { kind: 'move'; id: string };

interface TooltipState {
  action: Action;
  anchor: DOMRect;
}

type TFn = (key: string, options?: Record<string, unknown>) => string;

function propsOf(a: Action, t: TFn): Array<[string, string]> {
  const rows: Array<[string, string]> = [[t('edit.timeline.fieldAction'), cueLabel(a.type, t)]];
  const el = (a as { elementId?: string }).elementId;
  if (el) rows.push([t('edit.timeline.fieldElement'), el]);
  const content = (a as { content?: string }).content;
  if (content)
    rows.push([
      t('edit.timeline.fieldContent'),
      content.length > 48 ? `${content.slice(0, 48)}…` : content,
    ]);
  return rows;
}

function CueTooltip({ tip }: { tip: TooltipState }) {
  const { t } = useI18n();
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: Math.max(8, tip.anchor.left + tip.anchor.width / 2),
        top: tip.anchor.top - 8,
        transform: 'translate(-50%, -100%)',
        maxWidth: 280,
        zIndex: 60,
      }}
      className="pointer-events-none rounded-lg border border-border/80 bg-popover px-2.5 py-1.5 text-popover-foreground shadow-lg shadow-black/5"
    >
      {propsOf(tip.action, t).map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[11px] leading-relaxed">
          <span className="shrink-0 text-muted-foreground">{k}</span>
          <span className="font-mono [overflow-wrap:anywhere]">{v}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

// Native HTML5 drag snapshots the element's square bounding box, so a round
// icon chip drags with white corners ("白边"). Suppress the ghost with a 1×1
// transparent image — the violet drop indicator carries the feedback instead.
let blankDragImg: HTMLImageElement | null = null;
function setBlankDragImage(e: React.DragEvent) {
  if (typeof document === 'undefined') return;
  if (!blankDragImg) {
    blankDragImg = new Image();
    blankDragImg.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }
  try {
    e.dataTransfer.setDragImage(blankDragImg, 0, 0);
  } catch {
    /* not supported — fall back to the default ghost */
  }
}

function outlineForScene(scene: Scene, outlines: readonly SceneOutline[]): SceneOutline {
  const matched =
    (scene.outlineId ? outlines.find((outline) => outline.id === scene.outlineId) : undefined) ??
    outlines.find((outline) => outline.order === scene.order);
  if (matched) return matched;
  return {
    id: scene.outlineId ?? scene.id,
    type: scene.type,
    title: scene.title,
    description: scene.title,
    keyPoints: [scene.title],
    order: scene.order,
  };
}

function speechTextsForScene(scene: Scene): string[] {
  return (scene.actions ?? [])
    .filter((action) => action.type === 'speech')
    .map((action) => ((action as { text?: string }).text ?? '').trim())
    .filter(Boolean);
}

function toGenerationContent(
  content: Scene['content'],
  narrationSource?: ReturnType<typeof buildNarrationSourceFromScene>,
  choreographyBlocks?: readonly NarrationGenerationBlock[],
):
  | NarrationGenerationSlideContent
  | GeneratedQuizContent
  | GeneratedInteractiveContent
  | GeneratedPBLContent {
  if (content.type === 'slide') {
    const blocks = choreographyBlocks ?? narrationSource?.visualBlocks ?? [];
    return {
      elements: content.canvas.elements ?? [],
      background: content.canvas.background,
      ...(narrationSource
        ? {
            narrationSource: {
              text: narrationSource.text,
              elementCount: narrationSource.elementCount,
              fingerprint: narrationSource.fingerprint,
              blocks: blocks.map((block) => ({
                blockId: block.blockId,
                elementIds: block.elementIds,
                targetElementId: block.targetElementId,
                text: block.text,
                orderIndex: block.orderIndex,
              })),
            },
            choreography: blocks.map((block) => ({
              targetElementId: block.targetElementId,
              targetText: block.text,
              orderIndex: block.orderIndex,
            })),
          }
        : {}),
    } satisfies NarrationGenerationSlideContent;
  }
  return content as GeneratedQuizContent | GeneratedInteractiveContent | GeneratedPBLContent;
}

type NarrationGenerationBlock = NarrationVisualBlock & { targetElementId: string };

function preserveSpeechAudioByPosition(
  previous: readonly Action[],
  generated: readonly Action[],
): Action[] {
  const previousSpeech = previous.filter((action) => action.type === 'speech') as Array<
    Action & { id?: string; audioId?: string; audioUrl?: string }
  >;
  const previousSpeechById = new Map(
    previousSpeech
      .filter((action) => action.id)
      .map((action) => [action.id as string, action] as const),
  );
  let speechIndex = 0;
  return generated.map((action) => {
    if (action.type !== 'speech') return action;
    const prior =
      (action.id ? previousSpeechById.get(action.id) : undefined) ?? previousSpeech[speechIndex++];
    if (!prior?.audioId && !prior?.audioUrl) return action;
    return {
      ...action,
      ...(prior.audioId ? { audioId: prior.audioId } : {}),
      ...(prior.audioUrl ? { audioUrl: prior.audioUrl } : {}),
    } as Action;
  });
}

function preserveActionPairIdsByTarget(previous: readonly Action[], generated: readonly Action[]) {
  const previousPairs = spotlightSpeechPairsByTarget(previous);
  const generatedTargetCounts = new Map<string, number>();
  let pendingTargetId: string | null = null;

  return generated.map((action) => {
    if (isElementTargetAction(action)) {
      pendingTargetId = action.elementId;
      const index = generatedTargetCounts.get(action.elementId) ?? 0;
      generatedTargetCounts.set(action.elementId, index + 1);
      const pair = previousPairs.get(action.elementId)?.[index];
      return pair?.effectId ? ({ ...action, id: pair.effectId } as Action) : action;
    }

    if (action.type === 'speech' && pendingTargetId) {
      const index = (generatedTargetCounts.get(pendingTargetId) ?? 1) - 1;
      const pair = previousPairs.get(pendingTargetId)?.[index];
      pendingTargetId = null;
      return pair?.speechId ? ({ ...action, id: pair.speechId } as Action) : action;
    }

    return action;
  });
}

function reorderTargetPairsByVisualOrder(
  generated: readonly Action[],
  targetOrder: readonly string[],
): Action[] {
  if (!targetOrder.length) return [...generated] as Action[];
  const targetRank = new Map(targetOrder.map((targetId, index) => [targetId, index] as const));
  const targetChunks: Array<{ targetId: string; originalIndex: number; actions: Action[] }> = [];
  const otherChunks: Array<{ originalIndex: number; actions: Action[] }> = [];

  for (let index = 0; index < generated.length; index += 1) {
    const action = generated[index];
    if (!action) continue;
    if (isElementTargetAction(action)) {
      const actions: Action[] = [action];
      const next = generated[index + 1];
      if (next?.type === 'speech') {
        actions.push(next);
        index += 1;
      }
      targetChunks.push({ targetId: action.elementId, originalIndex: index, actions });
    } else {
      otherChunks.push({ originalIndex: index, actions: [action] });
    }
  }

  const orderedTargets = targetChunks.sort((a, b) => {
    const aRank = targetRank.get(a.targetId);
    const bRank = targetRank.get(b.targetId);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return a.originalIndex - b.originalIndex;
  });

  return [
    ...orderedTargets.flatMap((chunk) => chunk.actions),
    ...otherChunks
      .sort((a, b) => a.originalIndex - b.originalIndex)
      .flatMap((chunk) => chunk.actions),
  ] as Action[];
}

function targetIdsFromActions(actions: readonly Action[]): string[] {
  const seen = new Set<string>();
  return actions.filter(isElementTargetAction).flatMap((action) => {
    if (seen.has(action.elementId)) return [];
    seen.add(action.elementId);
    return [action.elementId];
  });
}

function targetableVisualBlocks(
  source: ReturnType<typeof buildNarrationSourceFromScene>,
  actions: readonly Action[],
  sceneTitle: string,
): NarrationGenerationBlock[] {
  const titleText = normalizeNarrationText(sceneTitle);
  const targetIds = targetIdsFromActions(actions);
  if (!targetIds.length) {
    return source.visualBlocks.filter((block) => block.text !== titleText);
  }
  return source.visualBlocks.flatMap((block) => {
    if (block.text === titleText) return [];
    const targetElementId =
      targetIds.find((id) => id === block.targetElementId || block.elementIds.includes(id)) ??
      undefined;
    if (!targetElementId) return [];
    return [{ ...block, targetElementId }];
  });
}

function spotlightSpeechPairsByTarget(actions: readonly Action[]) {
  const pairs = new Map<string, Array<{ effectId?: string; speechId?: string }>>();
  let pending: { targetId: string; effectId?: string } | null = null;
  for (const action of actions) {
    if (isElementTargetAction(action)) {
      pending = { targetId: action.elementId, effectId: action.id };
      continue;
    }
    if (action.type === 'speech' && pending) {
      const list = pairs.get(pending.targetId) ?? [];
      list.push({ effectId: pending.effectId, speechId: action.id });
      pairs.set(pending.targetId, list);
      pending = null;
    }
  }
  return pairs;
}

function isElementTargetAction(action: Action): action is Action & { elementId: string } {
  return (
    (action.type === 'spotlight' || action.type === 'laser') &&
    typeof (action as { elementId?: unknown }).elementId === 'string' &&
    Boolean((action as { elementId?: string }).elementId)
  );
}

function targetActionsForDiagnostics(actions: readonly Action[]) {
  return actions
    .filter(isElementTargetAction)
    .map((action) => ({ actionId: action.id, targetElementId: action.elementId }));
}

function speechIdsForDiagnostics(actions: readonly Action[]) {
  return actions
    .filter((action) => action.type === 'speech')
    .map((action) => action.id)
    .filter(Boolean) as string[];
}

function orderTextPreview(value: unknown, max = 80): string {
  return normalizeNarrationText(
    typeof value === 'string' ? value.replace(/<[^>]+>/g, ' ') : '',
  ).slice(0, max);
}

function elementArrayOrderForDiagnostics(scene: Scene | undefined) {
  if (!scene || scene.content.type !== 'slide') return [];
  return (scene.content.canvas.elements ?? []).map((element) => {
    const record = element as unknown as Record<string, unknown>;
    return {
      elementId: element.id,
      type: element.type,
      x: typeof record.left === 'number' ? record.left : undefined,
      y: typeof record.top === 'number' ? record.top : undefined,
      textPreview: getVisibleElementText(element).slice(0, 80),
    };
  });
}

function elementArrayOrderFlatForDiagnostics(scene: Scene | undefined) {
  return elementArrayOrderForDiagnostics(scene).map((element, index) =>
    `${index}:${element.elementId}:${element.x ?? ''}:${element.y ?? ''}:${element.textPreview}`.slice(
      0,
      120,
    ),
  );
}

function editedElementTextFlatForDiagnostics(scene: Scene | undefined) {
  if (!scene || scene.content.type !== 'slide') return [];
  return (scene.content.canvas.elements ?? [])
    .map((element, index) =>
      `${index}:${element.id}:${getVisibleElementText(element)}`.slice(0, 120),
    )
    .filter((item) => item.replace(/^[^:]+:[^:]+:/, '').trim());
}

function visualBlockOrderForDiagnostics(blocks: readonly NarrationVisualBlock[]) {
  return blocks.map((block) => ({
    blockId: block.blockId,
    targetElementId: block.targetElementId,
    x: block.bounds.left,
    y: block.bounds.top,
    textPreview: block.text.slice(0, 80),
  }));
}

function visualBlockOrderFlatForDiagnostics(blocks: readonly NarrationVisualBlock[]) {
  return blocks.map((block) =>
    `${block.orderIndex}:${block.blockId}:${block.targetElementId}:${block.text}`.slice(0, 120),
  );
}

function generationInputOrderForDiagnostics(blocks: readonly NarrationVisualBlock[]) {
  return blocks.map((block) => ({
    blockId: block.blockId,
    targetElementId: block.targetElementId,
    textPreview: block.text.slice(0, 80),
  }));
}

function generationInputOrderFlatForDiagnostics(blocks: readonly NarrationVisualBlock[]) {
  return blocks.map((block, index) =>
    `${index}:${block.blockId}:${block.targetElementId}:${block.text}`.slice(0, 120),
  );
}

function actionOrderForDiagnostics(actions: readonly Action[]) {
  return actions.map((action) => ({
    type: action.type,
    actionId: action.id,
    targetElementId: isElementTargetAction(action) ? action.elementId : undefined,
    speechPreview:
      action.type === 'speech' ? orderTextPreview((action as { text?: string }).text) : undefined,
  }));
}

function actionOrderFlatForDiagnostics(actions: readonly Action[]) {
  return actions.map((action, index) => {
    const target = isElementTargetAction(action) ? action.elementId : '';
    const speech =
      action.type === 'speech' ? orderTextPreview((action as { text?: string }).text, 120) : '';
    return `${index}:${action.type}:${action.id ?? ''}:${target}:${speech}`.slice(0, 120);
  });
}

function narrationSourceTextFlatForDiagnostics(
  source: ReturnType<typeof buildNarrationSourceFromScene>,
) {
  return source.text
    .split('\n')
    .map((line, index) => `${index}:${line}`.slice(0, 120))
    .filter((line) => line.replace(/^\d+:/, '').trim());
}

function logNarrationOrderCheckpoint(payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return;
  if (typeof console === 'undefined' || typeof console.info !== 'function') return;
  console.info(ORDER_LOG_PREFIX, payload);
}

function withStampedAudioIds(
  actions: readonly Action[],
  okIds: ReadonlySet<string>,
  sceneOrder: number,
): Action[] {
  let next = [...actions] as Action[];
  for (const action of actions) {
    if (action.type === 'speech' && action.id && okIds.has(action.id)) {
      next = setAudioIdById(next, action.id, speechAudioId(sceneOrder, action.id));
    }
  }
  return next;
}

function fingerprintText(value: string): string {
  return stableStringify(value);
}

function significantTokens(value: string): string[] {
  const stop = new Set([
    'about',
    'after',
    'again',
    'also',
    'and',
    'are',
    'because',
    'been',
    'before',
    'being',
    'can',
    'for',
    'from',
    'has',
    'have',
    'into',
    'its',
    'our',
    'the',
    'their',
    'this',
    'through',
    'to',
    'with',
  ]);
  return normalizeNarrationText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3 && !stop.has(token));
}

function unchangedNarrationStillLooksStale(
  currentSourceText: string,
  previousNarration: string,
  generatedNarration: string,
): boolean {
  if (
    !previousNarration.trim() ||
    fingerprintText(previousNarration) !== fingerprintText(generatedNarration)
  ) {
    return false;
  }
  const sourceTokens = new Set(significantTokens(currentSourceText));
  const previousTokens = significantTokens(previousNarration);
  if (previousTokens.length < 5) return false;
  const missing = previousTokens.filter((token) => !sourceTokens.has(token));
  return missing.length >= Math.max(3, Math.ceil(previousTokens.length * 0.4));
}

function fingerprintHash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function syncDiagnostic(args: {
  sceneId: string;
  operation: 'narration-and-audio' | 'audio-only';
  currentSceneFingerprint: string;
  storedNarrationSourceFingerprint?: string;
  narrationSourceCharacterCount: number;
  narrationSourceElementCount: number;
  previousNarrationFingerprint?: string;
  generatedNarrationFingerprint?: string;
  ttsInputFingerprint?: string;
  savedNarrationFingerprint?: string;
  savedAudioFingerprint?: string;
  staleStateBefore?: NarrationSyncState['status'];
  staleStateAfter?: NarrationSyncState['status'];
  preview?: string;
  visualBlocks?: readonly NarrationVisualBlock[];
  narrationActionTargets?: Array<{ actionId?: string; targetElementId?: string }>;
  generatedNarrationActionIds?: string[];
}) {
  log.debug('sync operation', {
    sceneId: args.sceneId,
    operation: args.operation,
    currentSceneFingerprint: fingerprintHash(args.currentSceneFingerprint),
    storedNarrationSourceFingerprint: fingerprintHash(args.storedNarrationSourceFingerprint),
    narrationSourceCharacterCount: args.narrationSourceCharacterCount,
    narrationSourceElementCount: args.narrationSourceElementCount,
    previousNarrationFingerprint: fingerprintHash(args.previousNarrationFingerprint),
    generatedNarrationFingerprint: fingerprintHash(args.generatedNarrationFingerprint),
    ttsInputFingerprint: fingerprintHash(args.ttsInputFingerprint),
    savedNarrationFingerprint: fingerprintHash(args.savedNarrationFingerprint),
    savedAudioFingerprint: fingerprintHash(args.savedAudioFingerprint),
    staleStateBefore: args.staleStateBefore,
    staleStateAfter: args.staleStateAfter,
    preview: args.preview,
    visualBlockOrder: args.visualBlocks?.map((block) => ({
      blockId: block.blockId,
      elementIds: block.elementIds,
      boundedTextPreview: block.text.slice(0, 80),
    })),
    narrationActionTargets: args.narrationActionTargets,
    generatedNarrationActionIds: args.generatedNarrationActionIds,
  });
}

/** Shared delete button — prominent, top-right of a card. */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      className="grid size-5 place-items-center rounded-md text-muted-foreground/55 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/15"
      aria-label={t('edit.delete')}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

/** ‹ › buttons to nudge a node left/right along the timeline. */
function MoveButtons({
  onLeft,
  onRight,
  canLeft,
  canRight,
}: {
  onLeft: () => void;
  onRight: () => void;
  canLeft: boolean;
  canRight: boolean;
}) {
  const { t } = useI18n();
  const cls =
    'grid size-5 place-items-center rounded text-muted-foreground/55 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent';
  return (
    <>
      <button
        type="button"
        disabled={!canLeft}
        onClick={(e) => {
          e.stopPropagation();
          onLeft();
        }}
        className={cls}
        aria-label={t('edit.timeline.moveLeft')}
        title={t('edit.timeline.moveLeft')}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <button
        type="button"
        disabled={!canRight}
        onClick={(e) => {
          e.stopPropagation();
          onRight();
        }}
        className={cls}
        aria-label={t('edit.timeline.moveRight')}
        title={t('edit.timeline.moveRight')}
      >
        <ChevronRight className="size-3.5" />
      </button>
    </>
  );
}

type TtsStatus = 'none' | 'ready' | 'generating' | 'error';

/** Audio status + 试听 / 重新生成 row, shown when managed TTS is on. */
function SpeechTtsBar({
  actionId,
  audioId,
  sceneOrder,
  language,
  text,
  audioUrl,
  refreshKey,
  regenerating,
  onGenerated,
}: {
  actionId: string;
  audioId?: string;
  sceneOrder: number;
  language?: string;
  text: string;
  audioUrl?: string;
  refreshKey?: number;
  regenerating?: boolean;
  onGenerated: () => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<TtsStatus>('none');
  // Holds this line in 生成中 across a batch ("全部配音") run and — crucially —
  // until its OWN audio re-check resolves, so it can't briefly flash back to
  // 未配音 in the window between the batch clearing `regenerating` and the async
  // audioExists effect landing. Latched on the rising edge of `regenerating`,
  // cleared inside that re-check effect (which the batch always re-triggers via
  // `refreshKey`).
  const [batchPending, setBatchPending] = useState(false);
  const [prevRegenerating, setPrevRegenerating] = useState(regenerating);
  if (regenerating !== prevRegenerating) {
    // Adjust state during render (per React's "you might not need an effect"),
    // not in an effect — avoids a cascading render on the batch's hot path.
    setPrevRegenerating(regenerating);
    if (regenerating) setBatchPending(true);
  }
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objUrlRef = useRef<string | null>(null);

  // The audio's real key: the action's stamped audioId, else the canonical
  // derived key (resolveSpeechAudioId is the single source of truth).
  const lookupId = resolveSpeechAudioId(sceneOrder, { id: actionId, audioId });

  const stopPreview = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (objUrlRef.current) {
      URL.revokeObjectURL(objUrlRef.current);
      objUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (audioUrl) {
          if (alive) setStatus('ready');
          return;
        }
        const has = await audioExists(lookupId);
        if (alive) setStatus((s) => (s === 'generating' ? s : has ? 'ready' : 'none'));
      } catch {
        /* IndexedDB read failed — leave status as-is (as before this change) */
      } finally {
        // Clear the batch latch only once the batch itself is over — its
        // end-of-batch re-check runs with regenerating=false. A *stale*
        // pre-batch check that resolves mid-batch must NOT clear it (adding
        // regenerating to the deps also cancels such a check at batch start via
        // the cleanup below). Runs even if the read threw, so the row can never
        // wedge in 生成中.
        if (alive && !regenerating) setBatchPending(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [lookupId, audioUrl, refreshKey, regenerating]);

  useEffect(() => () => stopPreview(), [stopPreview]);

  const preview = async () => {
    stopPreview();
    let src = audioUrl ?? null;
    if (!src) {
      src = await audioObjectUrl(lookupId);
      objUrlRef.current = src;
    }
    if (!src) return;
    const a = new Audio(src);
    audioRef.current = a;
    a.addEventListener('ended', stopPreview);
    void a.play().catch(() => stopPreview());
  };

  const regenerate = async () => {
    setStatus('generating');
    try {
      const id = await regenerateSpeechAudio(sceneOrder, { id: actionId, text }, language);
      if (id) {
        onGenerated();
        setStatus('ready');
      } else {
        setStatus('none');
      }
    } catch {
      setStatus('error');
    }
  };

  const STATUS: Record<TtsStatus, { label: string; cls: string }> = {
    ready: { label: t('edit.tts.statusReady'), cls: 'text-emerald-600 dark:text-emerald-400' },
    none: { label: t('edit.tts.statusNone'), cls: 'text-muted-foreground' },
    generating: {
      label: t('edit.tts.statusGenerating'),
      cls: 'text-amber-600 dark:text-amber-400',
    },
    error: { label: t('edit.tts.statusError'), cls: 'text-rose-500' },
  };
  // A batch "全部配音" run drives this line's loading state from the parent
  // (regenerating) — independent of the local single-line status. `batchPending`
  // extends 生成中 past the prop clearing, until this line's own audio re-check
  // resolves to 已配音 / 未配音, so the batch end shows a clean 生成中 → 已配音
  // transition with no intermediate flash.
  const effStatus: TtsStatus = regenerating || batchPending ? 'generating' : status;
  const s = STATUS[effStatus];

  return (
    <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1">
      <Volume2 className="size-3 shrink-0 text-muted-foreground/40" />
      <span className={cn('text-[10px] font-medium', s.cls)}>{s.label}</span>
      <span className="ml-auto" />
      <button
        type="button"
        onClick={preview}
        disabled={effStatus !== 'ready'}
        className="grid size-5 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label={t('edit.tts.preview')}
        title={t('edit.tts.preview')}
      >
        <Play className="size-3" />
      </button>
      <button
        type="button"
        onClick={regenerate}
        disabled={effStatus === 'generating' || !text.trim()}
        className="grid size-5 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label={t('edit.tts.regenerate')}
        title={t('edit.tts.regenerate')}
      >
        <RefreshCw className={cn('size-3', effStatus === 'generating' && 'animate-spin')} />
      </button>
    </div>
  );
}

/** One spoken line — a numbered, editable clip block. */
function SpeechClip({
  text,
  index,
  actionId,
  audioId,
  sceneOrder,
  language,
  autoFocus,
  ttsActive,
  audioUrl,
  ttsRefresh,
  regenerating,
  onCommit,
  onGenerated,
  onDelete,
  onMoveLeft,
  onMoveRight,
  canMoveLeft,
  canMoveRight,
  onDragStart,
  onDragEnd,
  onFocused,
}: {
  text: string;
  index: number;
  actionId: string;
  audioId?: string;
  sceneOrder: number;
  language?: string;
  autoFocus: boolean;
  ttsActive: boolean;
  audioUrl?: string;
  ttsRefresh?: number;
  regenerating?: boolean;
  onCommit: (text: string) => void;
  onGenerated: () => void;
  onDelete: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onFocused: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [val, setVal] = useState(text);
  // Has the user typed since the last external sync? If not, external text
  // changes (e.g. an agent regeneration mid-edit) are adopted even while
  // focused — so a stale draft can't clobber regenerated narration on blur.
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (document.activeElement !== ref.current || !dirtyRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external text in only when not mid-edit
      setVal(text);
      dirtyRef.current = false;
    }
  }, [text]);

  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
      onFocused();
    }
  }, [autoFocus, onFocused]);

  const commit = () => {
    if (dirtyRef.current && val !== text) onCommit(val);
    dirtyRef.current = false;
  };

  const SpeechIcon = cueMeta('speech').icon;
  const needsText = !text.trim();

  return (
    <div
      className={cn(
        'group/clip relative flex h-full w-[228px] shrink-0 flex-col overflow-hidden rounded-xl border border-border/85 bg-white/75 shadow-sm transition-colors focus-within:border-violet-400 hover:border-violet-300/70 dark:bg-slate-800/50 dark:hover:border-violet-500/40',
        needsText && INCOMPLETE_CLIP,
      )}
    >
      <span className="absolute inset-x-0 top-0 h-[3px] bg-primary/35" />
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-2 py-1">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="cursor-grab text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
          aria-label={t('edit.timeline.reorder')}
        >
          <GripVertical className="size-3.5" />
        </span>
        <span className="font-mono text-[10px] font-semibold tabular-nums text-muted-foreground/55">
          {String(index).padStart(2, '0')}
        </span>
        <SpeechIcon className="size-3 text-primary/45" />
        <span className="ml-auto mr-0.5 text-[8.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground/50">
          {t('edit.cue.speech')}
        </span>
        <MoveButtons
          onLeft={onMoveLeft}
          onRight={onMoveRight}
          canLeft={canMoveLeft}
          canRight={canMoveRight}
        />
        <DeleteButton onDelete={onDelete} />
      </div>
      <textarea
        ref={ref}
        value={val}
        onChange={(e) => {
          dirtyRef.current = true;
          setVal(e.target.value);
        }}
        onBlur={commit}
        placeholder={t('edit.timeline.speechPlaceholder')}
        className="flex-1 resize-none bg-transparent px-3 py-2 text-[12.5px] leading-[1.7] text-foreground/90 outline-none placeholder:text-muted-foreground/40 [scrollbar-width:thin]"
      />
      {ttsActive && (
        <SpeechTtsBar
          actionId={actionId}
          audioId={audioId}
          sceneOrder={sceneOrder}
          language={language}
          text={val}
          audioUrl={audioUrl}
          refreshKey={ttsRefresh}
          regenerating={regenerating}
          onGenerated={onGenerated}
        />
      )}
    </div>
  );
}

/**
 * A discussion node — the scene's terminal roundtable trigger. Unlike the other
 * cues it isn't drag-addable or movable: a discussion must be the LAST action and
 * there is at most one per scene (mirrors the action-parser invariant), so it's
 * appended via the toolbar and pinned at the end. Inline-edits topic (required),
 * prompt (optional) and the initiating agent. Topic/prompt commit on blur.
 */
function DiscussionClip({
  topic,
  prompt,
  agentId,
  agents,
  onTopicChange,
  onPromptChange,
  onAgentChange,
  onDelete,
}: {
  topic: string;
  prompt: string;
  agentId: string;
  agents: Array<{ id: string; name: string; avatar?: string }>;
  onTopicChange: (v: string) => void;
  onPromptChange: (v: string) => void;
  onAgentChange: (v: string) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const m = cueMeta('discussion');
  const needsTopic = !topic.trim();
  // Local drafts committed on blur; synced from props when not mid-edit so a
  // concurrent store update can't clobber an in-flight edit (mirrors SpeechClip).
  const [topicVal, setTopicVal] = useState(topic);
  const [promptVal, setPromptVal] = useState(prompt);
  const topicDirty = useRef(false);
  const promptDirty = useRef(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt external topic only when not mid-edit
    if (!topicDirty.current) setTopicVal(topic);
  }, [topic]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt external prompt only when not mid-edit
    if (!promptDirty.current) setPromptVal(prompt);
  }, [prompt]);

  return (
    <div
      className={cn(
        'group/disc relative flex h-full w-[228px] shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white/70 shadow-sm transition-colors focus-within:border-yellow-400 hover:border-yellow-300/70 dark:border-gray-700/60 dark:bg-slate-800/50 dark:hover:border-yellow-500/40',
        needsTopic && INCOMPLETE_CLIP,
      )}
    >
      {/* The empty state reads from the amber dashed frame + the "topic
          (required)" placeholder; the discussion keeps its Flag glyph identity. */}
      <span className={cn('absolute inset-x-0 top-0 h-[3px]', m.accent)} />
      <div className="flex items-center gap-1.5 border-b border-yellow-300/50 bg-yellow-400/15 px-2 py-1 dark:border-yellow-500/25 dark:bg-yellow-500/10">
        <span className="flex size-4 items-center justify-center rounded-md bg-yellow-400 text-yellow-950 dark:bg-yellow-500 dark:text-slate-900">
          <Flag className="size-2.5" />
        </span>
        <span className="text-[8.5px] font-semibold uppercase tracking-[0.12em] text-yellow-700 dark:text-yellow-400">
          {t('edit.cue.discussion')}
        </span>
        <span
          className="ml-auto text-[8.5px] font-medium uppercase tracking-[0.1em] text-yellow-600/70 dark:text-yellow-500/60"
          title={t('edit.timeline.discussionTerminalHint')}
        >
          {t('edit.timeline.discussionTerminal')}
        </span>
        <DeleteButton onDelete={onDelete} />
      </div>
      <textarea
        value={topicVal}
        onChange={(e) => {
          topicDirty.current = true;
          setTopicVal(e.target.value);
        }}
        onBlur={() => {
          if (topicDirty.current) onTopicChange(topicVal);
          topicDirty.current = false;
        }}
        placeholder={t('edit.timeline.discussionTopicPlaceholder')}
        className="h-[46px] shrink-0 resize-none bg-transparent px-3 pt-2 text-[12.5px] font-medium leading-[1.55] text-foreground/85 outline-none placeholder:font-normal placeholder:text-amber-500/60 [scrollbar-width:thin]"
      />
      <textarea
        value={promptVal}
        onChange={(e) => {
          promptDirty.current = true;
          setPromptVal(e.target.value);
        }}
        onBlur={() => {
          if (promptDirty.current) onPromptChange(promptVal);
          promptDirty.current = false;
        }}
        placeholder={t('edit.timeline.discussionPromptPlaceholder')}
        className="min-h-0 flex-1 resize-none bg-transparent px-3 text-[11px] leading-[1.6] text-muted-foreground outline-none placeholder:text-muted-foreground/35 [scrollbar-width:thin]"
      />
      <div className="flex items-center gap-1 border-t border-gray-100 px-2 py-1 dark:border-gray-700/50">
        <span className="shrink-0 text-[9px] text-muted-foreground/50">
          {t('edit.timeline.discussionAgent')}
        </span>
        <Select
          value={agentId || DISCUSSION_AGENT_NONE}
          onValueChange={(v) => onAgentChange(v === DISCUSSION_AGENT_NONE ? '' : v)}
        >
          <SelectTrigger
            size="sm"
            className="ml-auto h-6 max-w-[150px] gap-1 rounded border-border px-1.5 py-0 text-[10px] shadow-none focus-visible:ring-yellow-400/40 [&_svg]:size-3"
          >
            <SelectValue placeholder={t('edit.timeline.discussionAgentUnset')} />
          </SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectItem value={DISCUSSION_AGENT_NONE} className="text-[11px]">
              <span className="text-muted-foreground">
                {t('edit.timeline.discussionAgentUnset')}
              </span>
            </SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-[11px]">
                <span className="flex items-center gap-1.5">
                  {a.avatar && (
                    <span className="size-4 shrink-0 overflow-hidden rounded-full bg-muted">
                      <AvatarDisplay src={a.avatar} alt={a.name} />
                    </span>
                  )}
                  {a.name}
                </span>
              </SelectItem>
            ))}
            {/* keep a set agent visible even if it's no longer in the scene roster */}
            {agentId && !agents.some((a) => a.id === agentId) && (
              <SelectItem value={agentId} className="text-[11px]">
                {agentId}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * A non-speech cue — its own compact card on the timeline (the action's implicit
 * container, made explicit). Carries a delete button; clicking an element-bound
 * cue arms canvas pick mode so the target is chosen on the slide itself.
 */
function CueMarker({
  action,
  elements,
  onTip,
  onDelete,
  onPick,
  onMoveLeft,
  onMoveRight,
  canMoveLeft,
  canMoveRight,
  onDragStart,
  onDragEnd,
}: {
  action: Action;
  elements: { id?: string; type: string; content?: string }[];
  onTip: (t: TooltipState | null) => void;
  onDelete: () => void;
  onPick: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const { t } = useI18n();
  useClearCuePreviewOnUnmount();
  const m = cueMeta(action.type);
  const label = cueLabel(action.type, t);
  const Icon = m.icon;
  const bound = ELEMENT_BOUND.has(action.type);
  const elementId = (action as { elementId?: string }).elementId ?? '';
  const needsTarget = bound && !elementId;
  // Bound cue → show what it's actually pointing at, not a generic "bound";
  // the element may have been deleted since binding, so fall back gracefully.
  const boundEl = elementId ? elements.find((e) => e.id === elementId) : undefined;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={(e) => {
        onTip({ action, anchor: e.currentTarget.getBoundingClientRect() });
        applyCuePreview(cuePreviewFor(action));
      }}
      onMouseLeave={() => {
        onTip(null);
        clearCuePreview();
      }}
      onClick={() => {
        if (bound) onPick();
      }}
      className={cn(
        'group/cue relative flex h-full w-[108px] shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white/65 shadow-sm transition-colors dark:border-gray-700/60 dark:bg-slate-800/40',
        bound
          ? 'cursor-pointer hover:border-violet-300/70 dark:hover:border-violet-500/40'
          : 'cursor-grab active:cursor-grabbing',
        needsTarget && cn('border-dashed', m.dash),
      )}
      aria-label={label}
    >
      <span className={cn('absolute inset-x-0 top-0 h-[3px]', m.accent)} />
      <div className="flex items-center gap-0.5 px-1 pt-1">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab text-muted-foreground/35 transition-colors hover:text-muted-foreground active:cursor-grabbing"
          aria-label={t('edit.timeline.reorder')}
        >
          <GripVertical className="size-3.5" />
        </span>
        <span className="ml-auto flex items-center">
          <MoveButtons
            onLeft={onMoveLeft}
            onRight={onMoveRight}
            canLeft={canMoveLeft}
            canRight={canMoveRight}
          />
          <DeleteButton onDelete={onDelete} />
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-1 pb-1">
        <span className={cn('flex size-8 items-center justify-center rounded-full', m.glyph)}>
          <Icon className="size-4" />
        </span>
        <span className="text-[10px] font-medium text-foreground/70">{label}</span>
        {bound && (
          <span
            className={cn(
              'text-[9px]',
              needsTarget
                ? 'font-medium text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground/45',
            )}
          >
            {needsTarget
              ? t('edit.timeline.pickElement')
              : `→ ${boundEl ? elementLabel(boundEl, t) : t('edit.timeline.bound')}`}
          </span>
        )}
      </div>
    </div>
  );
}

/** A node anchored on the axis — drag handle; for cues, hover preview + click-to-pick. */
function NodeDot({
  action,
  onTip,
  onPick,
  onDragStart,
  onDragEnd,
  canDrag = true,
}: {
  action: Action;
  onTip: (t: TooltipState | null) => void;
  onPick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  canDrag?: boolean;
}) {
  const { t } = useI18n();
  useClearCuePreviewOnUnmount();
  const isSpeech = action.type === 'speech';
  // A discussion is the scene's terminal anchor — give its node a distinct
  // marker (square, filled yellow) so it reads as the end stop, not a regular
  // cue. Its flag glyph comes from cue-meta like every other type's.
  const isDiscussion = action.type === 'discussion';
  const bound = ELEMENT_BOUND.has(action.type);
  const elementId = (action as { elementId?: string }).elementId ?? '';
  const needsTarget = bound && !elementId;
  const m = cueMeta(action.type);
  const label = cueLabel(action.type, t);
  const Icon = m.icon;
  return (
    <span
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={isSpeech ? (action as { text?: string }).text?.slice(0, 60) : label}
      onMouseEnter={(e) => {
        if (isSpeech) return;
        onTip({ action, anchor: e.currentTarget.getBoundingClientRect() });
        applyCuePreview(cuePreviewFor(action));
      }}
      onMouseLeave={() => {
        if (isSpeech) return;
        onTip(null);
        clearCuePreview();
      }}
      onClick={() => {
        if (bound) onPick();
      }}
      className={cn(
        'grid size-6 place-items-center ring-2 ring-white transition-transform hover:scale-110 dark:ring-slate-900',
        isDiscussion ? 'rounded-[7px]' : 'rounded-full',
        needsTarget
          ? 'text-amber-600 bg-amber-100 ring-amber-200 animate-pulse dark:bg-amber-500/20 dark:text-amber-400'
          : isDiscussion
            ? 'bg-yellow-400 text-yellow-900 ring-yellow-200 dark:bg-yellow-500 dark:text-slate-900 dark:ring-yellow-500/30'
            : m.glyph,
        bound
          ? 'cursor-pointer'
          : canDrag
            ? 'cursor-grab active:cursor-grabbing'
            : 'cursor-default',
      )}
      aria-label={label}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** Slim insertion slot between items; widens + glows while a drag hovers it. */
function DropZone({
  active,
  slot,
  onEnter,
  onDrop,
  onInsert,
  insertLabel,
  flex,
}: {
  active: boolean;
  slot: number;
  onEnter: () => void;
  onDrop: () => void;
  onInsert: (slot: number, rect: DOMRect) => void;
  insertLabel: string;
  flex?: boolean;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onEnter();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        'group/ins relative flex h-full shrink-0 items-start justify-center pt-2 transition-all',
        flex ? 'flex-1' : active ? 'w-10' : 'w-4',
      )}
    >
      <span
        className={cn(
          'pointer-events-none absolute inset-y-3 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors',
          active ? 'bg-primary' : 'bg-transparent',
        )}
      />
      {!active && (
        <button
          type="button"
          aria-label={insertLabel}
          title={insertLabel}
          onClick={(e) => onInsert(slot, e.currentTarget.getBoundingClientRect())}
          className="relative z-[1] grid size-[22px] scale-90 place-items-center rounded-full border border-dashed border-primary/40 bg-background text-primary/70 opacity-30 transition-all hover:scale-100 hover:border-solid hover:border-primary hover:bg-primary/5 hover:text-primary hover:opacity-100 group-hover/ins:opacity-90"
        >
          <Plus className="size-3" />
        </button>
      )}
    </div>
  );
}

export function ActionsBar({ sceneId }: { sceneId: string }) {
  const { t } = useI18n();
  const scene = useStageStore((s) => s.scenes.find((x) => x.id === sceneId));
  const actions = scene?.actions ?? EMPTY;
  const sceneOrder = scene?.order ?? 0;
  // Element-bound cues (spotlight / laser) point at slide elements, so they only
  // make sense on SLIDE scenes. While the scene hasn't loaded yet, fall back to
  // a non-slide type so the picker doesn't briefly offer unsupported cues.
  const sceneType: SceneType = scene?.type ?? 'quiz';
  // Slide-scene canvas elements — feeds CueMarker's bound-cue label lookup
  // ("→ <element name>" instead of a generic "bound"). Non-slide scenes'
  // `content` has no `canvas`, so this is always [] there.
  const sceneElements =
    (
      scene?.content as
        | { canvas?: { elements?: { id?: string; type: string; content?: string }[] } }
        | undefined
    )?.canvas?.elements ?? EMPTY_ELEMENTS;
  const language = useStageStore((s) => s.stage?.languageDirective);
  // Managed TTS on → speech clips show audio status + 试听 / 重新生成.
  const ttsActive = useSettingsStore(
    (s) => s.ttsEnabled && s.ttsProviderId !== 'browser-native-tts',
  );
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const ttsModelId = useSettingsStore((s) => s.ttsProvidersConfig?.[s.ttsProviderId]?.modelId);
  const ttsFingerprintSettings = useMemo(
    () => ({
      language,
      ttsEnabled,
      ttsProviderId,
      ttsVoice,
      ttsSpeed,
      ttsModelId,
    }),
    [language, ttsEnabled, ttsProviderId, ttsVoice, ttsSpeed, ttsModelId],
  );
  const stage = useStageStore((s) => s.stage);
  const allOutlines = useStageStore((s) => s.outlines);
  const allScenes = useStageStore((s) => s.scenes);

  // Agents a discussion can be initiated by — sourced from the user's currently
  // SELECTED agents, the exact set the playback engine gates on: it skips (and
  // consumes) any discussion whose `agentId` isn't selected. Offering the same
  // set here means whatever the author picks will actually fire at playback;
  // anything else (scene/stage roster) could let them save an initiator that the
  // engine silently drops. With nothing selected only "unspecified" remains,
  // which is correct since an unset `agentId` is never skipped.
  const agentsRecord = useAgentRegistry((s) => s.agents);
  const selectedAgentIds = useSettingsStore((s) => s.selectedAgentIds);
  const selectedAgentsForGeneration = useMemo(
    () =>
      selectedAgentIds
        .map((id) => agentsRecord[id])
        .filter(Boolean)
        .map((a) => ({ id: a.id, name: a.name, role: a.role, persona: a.persona })),
    [selectedAgentIds, agentsRecord],
  );
  const discussionAgents = useMemo(
    () =>
      selectedAgentIds
        .map((id) => agentsRecord[id])
        .filter(Boolean)
        .map((a) => ({ id: a.id, name: a.name, avatar: a.avatar })),
    [selectedAgentIds, agentsRecord],
  );

  const [lineMode, setLineMode] = useState(false); // collapse to just the axis line of node icons
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [regenAll, setRegenAll] = useState(false);
  const [pickerAt, setPickerAt] = useState<{ slot: number; rect: DOMRect } | null>(null);
  // Ids of speech lines currently being (re)generated by "全部配音", so each
  // line's status row shows 生成中 for the duration of the batch.
  const [regeneratingIds, setRegeneratingIds] = useState<ReadonlySet<string>>(NO_IDS);
  const [ttsRefresh, setTtsRefresh] = useState(0); // bump → speech clips re-check audio status
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const dragRef = useRef<DragPayload | null>(null);
  const syncingRef = useRef(false);

  const syncState = useMemo(
    () => (scene ? getNarrationSyncState(scene, ttsFingerprintSettings) : null),
    [scene, ttsFingerprintSettings],
  );

  useEffect(() => {
    if (!scene || !ttsActive || !syncState) return;
    if (syncState.status === 'unknown-legacy' || syncState.status === 'syncing') return;
    if (!syncState.hasSpeechAudio) return;
    const stamped = scene.sync?.audioSourceFingerprint;
    if (stamped && stamped !== getAudioSourceFingerprint(scene, ttsFingerprintSettings)) {
      useStageStore.getState().updateScene(scene.id, {
        sync: staleAudioMetadata(scene, ttsFingerprintSettings),
      });
    }
  }, [scene, syncState, ttsActive, ttsFingerprintSettings]);

  // Apply an edit to the LATEST actions from the store (not the render-time
  // snapshot), so a concurrent agent/TTS update isn't reverted by a later UI
  // commit (drag / reorder / blur / delete).
  const commit = useCallback(
    (updater: (cur: Action[]) => Action[]) => {
      const cur = useStageStore.getState().scenes.find((s) => s.id === sceneId)?.actions ?? [];
      useStageStore.getState().updateScene(sceneId, { actions: updater(cur) });
    },
    [sceneId],
  );

  const synthesizeAudioForActions = useCallback(
    async (targetScene: Scene, actionsForTts: readonly Action[]): Promise<Action[]> => {
      const speeches = actionsForTts.filter(
        (a) => a.type === 'speech' && ((a as { text?: string }).text ?? '').trim(),
      );
      if (!speeches.length) return [...actionsForTts] as Action[];

      const ids = speeches.map((a) => a.id).filter(Boolean) as string[];
      logNarrationOrderCheckpoint({
        checkpoint: 'tts-input-order',
        sceneId: targetScene.id,
        speechActionIds: ids,
        speechPreviews: speeches.map((action) =>
          orderTextPreview((action as { text?: string }).text),
        ),
      });
      logNarrationOrderCheckpoint({
        checkpoint: 'ttsInputOrderFlat',
        sceneId: targetScene.id,
        order: speeches.map((action, index) =>
          `${index}:${action.id ?? ''}:${orderTextPreview((action as { text?: string }).text, 120)}`.slice(
            0,
            120,
          ),
        ),
      });
      setRegeneratingIds(new Set(ids));
      const okIds = new Set<string>();
      try {
        for (const action of speeches) {
          if (!action.id) continue;
          const text = (action as { text?: string }).text ?? '';
          const id = await regenerateSpeechAudio(
            targetScene.order,
            { id: action.id, text },
            language,
          );
          if (id) okIds.add(action.id);
        }
      } finally {
        setRegeneratingIds(NO_IDS);
        setTtsRefresh((n) => n + 1);
      }

      if (okIds.size !== ids.length) {
        throw new Error(t('edit.timeline.syncFailed'));
      }

      return withStampedAudioIds(actionsForTts, okIds, targetScene.order);
    },
    [language, t],
  );

  // Regenerate TTS for every speech line in the scene, then stamp audioIds.
  // Reads the latest actions from the store at each step so a concurrent edit
  // isn't clobbered, and stamps by id (index-stale-safe).
  const regenerateAllAudio = useCallback(async () => {
    if (regenAll || syncingRef.current) return;
    const latest = useStageStore.getState().scenes.find((s) => s.id === sceneId);
    if (!latest) return;
    const source = buildNarrationSourceFromScene(latest);
    const beforeState = getNarrationSyncState(latest, ttsFingerprintSettings);
    const previousNarrationFingerprint = fingerprintText(speechTextsForScene(latest).join('\n'));
    setRegenAll(true);
    try {
      const actionsWithAudio = await synthesizeAudioForActions(latest, latest.actions ?? []);
      const latestAfterTts = useStageStore.getState().scenes.find((s) => s.id === sceneId);
      if (!latestAfterTts) return;
      const syncedScene = { ...latestAfterTts, actions: actionsWithAudio } as Scene;
      const sync = syncedNarrationMetadata(syncedScene, ttsFingerprintSettings);
      useStageStore.getState().updateScene(sceneId, { actions: actionsWithAudio, sync });
      syncDiagnostic({
        sceneId,
        operation: 'audio-only',
        currentSceneFingerprint: source.fingerprint,
        storedNarrationSourceFingerprint: latest.sync?.narrationSourceFingerprint,
        narrationSourceCharacterCount: source.text.length,
        narrationSourceElementCount: source.elementCount,
        previousNarrationFingerprint,
        ttsInputFingerprint: previousNarrationFingerprint,
        savedNarrationFingerprint: previousNarrationFingerprint,
        savedAudioFingerprint: sync.audioSourceFingerprint,
        staleStateBefore: beforeState.status,
        staleStateAfter: 'synced',
        preview: source.preview,
        visualBlocks: source.visualBlocks,
        narrationActionTargets: targetActionsForDiagnostics(actionsWithAudio),
        generatedNarrationActionIds: speechIdsForDiagnostics(actionsWithAudio),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('edit.timeline.syncFailed');
      setSyncError(message);
      const current = useStageStore.getState().scenes.find((s) => s.id === sceneId);
      if (current) {
        useStageStore.getState().updateScene(sceneId, {
          sync: { ...staleAudioMetadata(current, ttsFingerprintSettings), error: message },
        });
      }
    } finally {
      setRegenAll(false);
    }
  }, [regenAll, sceneId, synthesizeAudioForActions, t, ttsFingerprintSettings]);

  const syncSceneById = useCallback(
    async (targetSceneId: string) => {
      const latest = useStageStore.getState().scenes.find((s) => s.id === targetSceneId);
      logNarrationOrderCheckpoint({
        checkpoint: 'current-scene',
        sceneId: targetSceneId,
        sceneFound: Boolean(latest),
        elementArrayOrder: elementArrayOrderForDiagnostics(latest),
      });
      logNarrationOrderCheckpoint({
        checkpoint: 'elementArrayOrderFlat',
        sceneId: targetSceneId,
        order: elementArrayOrderFlatForDiagnostics(latest),
      });
      logNarrationOrderCheckpoint({
        checkpoint: 'editedElementTextFlat',
        sceneId: targetSceneId,
        order: editedElementTextFlatForDiagnostics(latest),
      });
      if (!latest || !stage) return;
      const beforeState = getNarrationSyncState(latest, ttsFingerprintSettings);
      if (beforeState.status !== 'narration-stale' && beforeState.status !== 'audio-stale') return;
      const source = buildNarrationSourceFromScene(latest);
      logNarrationOrderCheckpoint({
        checkpoint: 'visual-block-order',
        sceneId: targetSceneId,
        blocks: visualBlockOrderForDiagnostics(source.visualBlocks),
      });
      logNarrationOrderCheckpoint({
        checkpoint: 'visualBlockOrderFlat',
        sceneId: targetSceneId,
        order: visualBlockOrderFlatForDiagnostics(source.visualBlocks),
      });
      logNarrationOrderCheckpoint({
        checkpoint: 'narrationSourceTextFlat',
        sceneId: targetSceneId,
        order: narrationSourceTextFlatForDiagnostics(source),
      });
      const previousNarrationFingerprint = fingerprintText(speechTextsForScene(latest).join('\n'));

      if (beforeState.status === 'audio-stale') {
        const actionsWithAudio = await synthesizeAudioForActions(latest, latest.actions ?? []);
        const current = useStageStore.getState().scenes.find((s) => s.id === targetSceneId);
        if (!current) return;
        const currentSource = buildNarrationSourceFromScene(current);
        const syncedScene = { ...current, actions: actionsWithAudio } as Scene;
        const sync =
          currentSource.fingerprint === source.fingerprint
            ? syncedNarrationMetadata(syncedScene, ttsFingerprintSettings)
            : current.sync;
        logNarrationOrderCheckpoint({
          checkpoint: 'final-action-order',
          sceneId: targetSceneId,
          actions: actionOrderForDiagnostics(actionsWithAudio),
        });
        logNarrationOrderCheckpoint({
          checkpoint: 'finalActionOrderFlat',
          sceneId: targetSceneId,
          order: actionOrderFlatForDiagnostics(actionsWithAudio),
        });
        useStageStore.getState().updateScene(targetSceneId, { actions: actionsWithAudio, sync });
        const saved = useStageStore.getState().scenes.find((s) => s.id === targetSceneId);
        logNarrationOrderCheckpoint({
          checkpoint: 'saved-action-order',
          sceneId: targetSceneId,
          actions: actionOrderForDiagnostics(saved?.actions ?? []),
        });
        logNarrationOrderCheckpoint({
          checkpoint: 'savedActionOrderFlat',
          sceneId: targetSceneId,
          order: actionOrderFlatForDiagnostics(saved?.actions ?? []),
        });
        syncDiagnostic({
          sceneId: targetSceneId,
          operation: 'audio-only',
          currentSceneFingerprint: source.fingerprint,
          storedNarrationSourceFingerprint: latest.sync?.narrationSourceFingerprint,
          narrationSourceCharacterCount: source.text.length,
          narrationSourceElementCount: source.elementCount,
          previousNarrationFingerprint,
          ttsInputFingerprint: previousNarrationFingerprint,
          savedNarrationFingerprint: previousNarrationFingerprint,
          savedAudioFingerprint: sync?.audioSourceFingerprint,
          staleStateBefore: beforeState.status,
          staleStateAfter: sync
            ? getNarrationSyncState(
                { ...current, actions: actionsWithAudio, sync },
                ttsFingerprintSettings,
              ).status
            : undefined,
          preview: source.preview,
          visualBlocks: source.visualBlocks,
          narrationActionTargets: targetActionsForDiagnostics(actionsWithAudio),
          generatedNarrationActionIds: speechIdsForDiagnostics(actionsWithAudio),
        });
        return;
      }

      useStageStore.getState().updateScene(targetSceneId, {
        sync: { ...(latest.sync ?? {}), status: 'syncing', updatedAt: Date.now() },
      });

      const outline = outlineForScene(latest, allOutlines);
      const choreographyBlocks = targetableVisualBlocks(source, latest.actions ?? [], latest.title);
      const generationContent = toGenerationContent(latest.content, source, choreographyBlocks);
      logNarrationOrderCheckpoint({
        checkpoint: 'generation-input-order',
        sceneId: targetSceneId,
        targets: generationInputOrderForDiagnostics(choreographyBlocks),
      });
      logNarrationOrderCheckpoint({
        checkpoint: 'generationInputOrderFlat',
        sceneId: targetSceneId,
        order: generationInputOrderFlatForDiagnostics(choreographyBlocks),
      });
      const result = await fetchSceneActions({
        outline,
        allOutlines: allOutlines.length ? allOutlines : [outline],
        content: generationContent,
        stageId: stage.id,
        agents: selectedAgentsForGeneration,
        previousSpeeches: [],
        languageDirective: stage.languageDirective,
      });
      if (!result.success || !result.scene) {
        throw new Error(result.error || 'Narration sync failed');
      }

      const rawGeneratedActions = result.scene.actions ?? [];
      logNarrationOrderCheckpoint({
        checkpoint: 'generated-action-order',
        sceneId: targetSceneId,
        actions: actionOrderForDiagnostics(rawGeneratedActions),
      });
      logNarrationOrderCheckpoint({
        checkpoint: 'generatedActionOrderFlat',
        sceneId: targetSceneId,
        order: actionOrderFlatForDiagnostics(rawGeneratedActions),
      });
      const visuallyOrderedActions = reorderTargetPairsByVisualOrder(
        rawGeneratedActions,
        choreographyBlocks.map((block) => block.targetElementId),
      );
      const generatedActions = preserveActionPairIdsByTarget(
        latest.actions ?? [],
        visuallyOrderedActions,
      );
      logNarrationOrderCheckpoint({
        checkpoint: 'final-action-order',
        sceneId: targetSceneId,
        actions: actionOrderForDiagnostics(generatedActions),
      });
      logNarrationOrderCheckpoint({
        checkpoint: 'finalActionOrderFlat',
        sceneId: targetSceneId,
        order: actionOrderFlatForDiagnostics(generatedActions),
      });
      const generatedNarration = generatedActions
        .filter((action) => action.type === 'speech')
        .map((action) => ((action as { text?: string }).text ?? '').trim())
        .filter(Boolean)
        .join('\n');
      if (!generatedNarration) {
        throw new Error(result.error || 'Narration sync produced no narration');
      }
      if (
        unchangedNarrationStillLooksStale(
          source.text,
          speechTextsForScene(latest).join('\n'),
          generatedNarration,
        )
      ) {
        const message = 'Narration sync returned unchanged narration for changed slide content';
        useStageStore.getState().updateScene(targetSceneId, {
          sync: {
            ...(latest.sync ?? {
              narrationSourceFingerprint: beforeState.narrationSourceFingerprint,
              audioSourceFingerprint: beforeState.audioSourceFingerprint,
            }),
            status: 'narration-stale',
            error: message,
            updatedAt: Date.now(),
          },
        });
        throw new Error(message);
      }

      const currentBeforeSave = useStageStore.getState().scenes.find((s) => s.id === targetSceneId);
      if (!currentBeforeSave) return;
      const currentSource = buildNarrationSourceFromScene(currentBeforeSave);
      if (currentSource.fingerprint !== source.fingerprint) {
        throw new Error('Scene changed while narration sync was running');
      }

      const generatedNarrationFingerprint = fingerprintText(generatedNarration);
      const actionsWithPriorAudio = preserveSpeechAudioByPosition(
        currentBeforeSave.actions ?? [],
        generatedActions,
      );
      useStageStore.getState().updateScene(targetSceneId, {
        actions: actionsWithPriorAudio,
        sync: {
          status: 'audio-stale',
          narrationSourceFingerprint: source.fingerprint,
          audioSourceFingerprint: getAudioSourceFingerprint(
            currentBeforeSave,
            ttsFingerprintSettings,
          ),
          updatedAt: Date.now(),
        },
      });
      const savedBeforeTts = useStageStore.getState().scenes.find((s) => s.id === targetSceneId);
      logNarrationOrderCheckpoint({
        checkpoint: 'saved-action-order',
        sceneId: targetSceneId,
        actions: actionOrderForDiagnostics(savedBeforeTts?.actions ?? []),
      });
      logNarrationOrderCheckpoint({
        checkpoint: 'savedActionOrderFlat',
        sceneId: targetSceneId,
        order: actionOrderFlatForDiagnostics(savedBeforeTts?.actions ?? []),
      });

      let actionsWithAudio: Action[];
      try {
        actionsWithAudio = await synthesizeAudioForActions(
          currentBeforeSave,
          actionsWithPriorAudio,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : t('edit.timeline.syncFailed');
        const current = useStageStore.getState().scenes.find((s) => s.id === targetSceneId);
        if (current) {
          useStageStore.getState().updateScene(targetSceneId, {
            sync: { ...staleAudioMetadata(current, ttsFingerprintSettings), error: message },
          });
        }
        throw error;
      }

      const currentAfterTts = useStageStore.getState().scenes.find((s) => s.id === targetSceneId);
      if (!currentAfterTts) return;
      const latestSource = buildNarrationSourceFromScene(currentAfterTts);
      const syncedScene = { ...currentAfterTts, actions: actionsWithAudio } as Scene;
      const sync =
        latestSource.fingerprint === source.fingerprint
          ? syncedNarrationMetadata(syncedScene, ttsFingerprintSettings)
          : currentAfterTts.sync;
      useStageStore.getState().updateScene(targetSceneId, { actions: actionsWithAudio, sync });
      syncDiagnostic({
        sceneId: targetSceneId,
        operation: 'narration-and-audio',
        currentSceneFingerprint: source.fingerprint,
        storedNarrationSourceFingerprint: latest.sync?.narrationSourceFingerprint,
        narrationSourceCharacterCount: source.text.length,
        narrationSourceElementCount: source.elementCount,
        previousNarrationFingerprint,
        generatedNarrationFingerprint,
        ttsInputFingerprint: generatedNarrationFingerprint,
        savedNarrationFingerprint: fingerprintText(speechTextsForScene(syncedScene).join('\n')),
        savedAudioFingerprint: sync?.audioSourceFingerprint,
        staleStateBefore: beforeState.status,
        staleStateAfter: sync
          ? getNarrationSyncState(
              { ...currentAfterTts, actions: actionsWithAudio, sync },
              ttsFingerprintSettings,
            ).status
          : undefined,
        preview: source.preview,
        visualBlocks: source.visualBlocks,
        narrationActionTargets: targetActionsForDiagnostics(actionsWithAudio),
        generatedNarrationActionIds: speechIdsForDiagnostics(actionsWithAudio),
      });
    },
    [
      allOutlines,
      selectedAgentsForGeneration,
      stage,
      synthesizeAudioForActions,
      t,
      ttsFingerprintSettings,
    ],
  );

  const syncCurrentScene = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      await syncSceneById(sceneId);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('edit.timeline.syncFailed');
      setSyncError(message);
      const current = useStageStore.getState().scenes.find((s) => s.id === sceneId);
      if (current) {
        const fallbackSync =
          current.sync?.status === 'syncing'
            ? ({ ...current.sync, status: 'error', error: message, updatedAt: Date.now() } as const)
            : {
                ...(current.sync ?? staleAudioMetadata(current, ttsFingerprintSettings)),
                error: message,
                updatedAt: Date.now(),
              };
        useStageStore.getState().updateScene(sceneId, {
          sync: fallbackSync,
        });
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [sceneId, syncSceneById, t, ttsFingerprintSettings]);

  const syncAllStaleScenes = useCallback(async () => {
    if (!stage || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      const staleSceneIds = useStageStore
        .getState()
        .scenes.filter((s) => {
          const state = getNarrationSyncState(s, ttsFingerprintSettings);
          return state.status === 'narration-stale' || state.status === 'audio-stale';
        })
        .map((s) => s.id);
      logNarrationOrderCheckpoint({
        checkpoint: 'bulk-queue',
        sceneIds: staleSceneIds,
      });

      for (const staleSceneId of staleSceneIds) {
        await syncSceneById(staleSceneId);
      }
      setTtsRefresh((n) => n + 1);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : t('edit.timeline.syncFailed'));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [stage, syncSceneById, t, ttsFingerprintSettings]);

  // Height drag-resize (top edge).
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panViewport = (dir: -1 | 1) =>
    scrollRef.current?.scrollBy({ left: dir * 280, behavior: 'smooth' });
  const [height, setHeight] = useState(DEFAULT_H);
  const resizeRef = useRef<{
    startY: number;
    startH: number;
    lastH: number;
    pointerId: number;
  } | null>(null);
  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const startH = sectionRef.current?.getBoundingClientRect().height ?? height;
      resizeRef.current = { startY: e.clientY, startH, lastH: startH, pointerId: e.pointerId };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* best effort */
      }
      document.body.style.cursor = 'row-resize';
    },
    [height],
  );
  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = resizeRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const next = Math.min(MAX_H, Math.max(MIN_H, d.startH + (d.startY - e.clientY)));
    d.lastH = next;
    if (sectionRef.current) sectionRef.current.style.height = `${next}px`;
  }, []);
  const onResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = resizeRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* may already be released */
    }
    setHeight(d.lastH);
    resizeRef.current = null;
    document.body.style.cursor = '';
  }, []);

  const newId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `a-${Date.now()}`;

  // Insert path for the ActionPicker (header pill / inline "+" drop-zone
  // buttons): appends a discussion (terminal, at-most-one) or inserts an
  // ordinary action at a slot, capped before any existing discussion so it
  // always stays last.
  const insertActionAt = useCallback(
    (type: PickerType, slot: number) => {
      const id = newId();
      if (type === 'discussion') {
        commit((cur) => appendDiscussion(cur, id));
        return;
      }
      const action = makeAction(type, id);
      commit((cur) => insertAt(cur, clampInsertSlot(cur, slot), action));
      if (type === 'speech') setFocusId(id);
    },
    [commit],
  );

  const handleDrop = useCallback(
    (slot: number) => {
      const p = dragRef.current;
      dragRef.current = null;
      setDragOver(null);
      if (!p) return;
      commit((cur) => moveById(cur, p.id, clampInsertSlot(cur, slot)));
    },
    [commit],
  );

  const speechCount = actions.filter((a) => a.type === 'speech').length;
  const cueCount = actions.length - speechCount;

  // A discussion is pinned at the end (at most one), so ordinary actions can move
  // right only up to the slot before it; the discussion node itself can't move.
  const discussionPresent = hasDiscussion(actions);
  const lastMovableIndex = discussionPresent ? actions.length - 2 : actions.length - 1;

  let speechIndex = 0;
  const items = actions.map((action, index) => {
    if (action.type === 'speech') speechIndex += 1;
    return { action, index, key: (action.id ?? `a-${index}`) as string, speechIndex };
  });

  return (
    <section
      ref={sectionRef}
      style={{ height: lineMode ? LINE_H : height }}
      className="relative flex flex-col border-t border-gray-100 bg-white/80 backdrop-blur-xl dark:border-gray-800 dark:bg-slate-900/80"
    >
      {!lineMode && (
        <div
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          className="group absolute inset-x-0 top-0 z-10 h-1.5 cursor-row-resize touch-none transition-colors hover:bg-violet-400/30 active:bg-violet-500/50 dark:hover:bg-violet-500/30"
        >
          <div className="absolute left-1/2 top-[3px] h-0.5 w-9 -translate-x-1/2 rounded-full bg-gray-300 transition-colors group-hover:bg-violet-400 dark:bg-gray-600 dark:group-hover:bg-violet-500" />
        </div>
      )}

      <div className="flex h-10 shrink-0 items-center gap-2.5 px-6">
        <button
          type="button"
          onClick={() => setLineMode((v) => !v)}
          className="flex items-center gap-2.5"
        >
          <span className="size-1.5 rounded-full bg-primary" />
          <span className="text-[12px] font-medium tracking-[0.18em] text-foreground/80">
            {t('edit.timeline.title')}
          </span>
        </button>

        {!lineMode && (
          <button
            type="button"
            onClick={(e) => {
              const slot = discussionPresent ? actions.length - 1 : actions.length;
              setPickerAt({ slot, rect: e.currentTarget.getBoundingClientRect() });
            }}
            className="ml-3 inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
          >
            <Plus className="size-3" />
            {t('edit.timeline.addAction')}
            <ChevronDown className="size-3 opacity-70" />
          </button>
        )}

        {!lineMode && ttsActive && (
          <>
            {syncState &&
              (syncState.status === 'narration-stale' ||
                syncState.status === 'audio-stale' ||
                syncState.status === 'syncing' ||
                syncState.status === 'error') && (
                <span
                  className={cn(
                    'ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    syncState.status === 'error'
                      ? 'border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300'
                      : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
                  )}
                  title={syncError ?? scene?.sync?.error}
                >
                  {syncState.status === 'narration-stale'
                    ? t('edit.timeline.narrationStale')
                    : syncState.status === 'audio-stale'
                      ? t('edit.timeline.audioStale')
                      : syncState.status === 'syncing'
                        ? t('edit.timeline.syncing')
                        : t('edit.timeline.syncFailed')}
                </span>
              )}
            {syncState &&
              (syncState.status === 'narration-stale' || syncState.status === 'audio-stale') && (
                <button
                  type="button"
                  onClick={syncCurrentScene}
                  disabled={syncing}
                  title={
                    syncState.status === 'narration-stale'
                      ? t('edit.timeline.syncNarrationAudio')
                      : t('edit.timeline.regenSlideAudio')
                  }
                  aria-label={
                    syncState.status === 'narration-stale'
                      ? t('edit.timeline.syncNarrationAudio')
                      : t('edit.timeline.regenSlideAudio')
                  }
                  className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  <RefreshCw className={cn('size-3', syncing && 'animate-spin')} />
                  {syncState.status === 'narration-stale'
                    ? t('edit.timeline.syncNow')
                    : t('edit.timeline.regenAudio')}
                </button>
              )}
            {allScenes.some((s) => {
              const state = getNarrationSyncState(s, ttsFingerprintSettings);
              return state.status === 'narration-stale' || state.status === 'audio-stale';
            }) && (
              <button
                type="button"
                onClick={syncAllStaleScenes}
                disabled={syncing}
                title={t('edit.timeline.syncAllStale')}
                aria-label={t('edit.timeline.syncAllStale')}
                className="ml-1 inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={cn('size-3', syncing && 'animate-spin')} />
                {t('edit.timeline.syncAll')}
              </button>
            )}
          </>
        )}

        {!lineMode && ttsActive && (
          <button
            type="button"
            onClick={regenerateAllAudio}
            disabled={regenAll}
            title={t('edit.timeline.regenAllTts')}
            aria-label={t('edit.timeline.regenAllTts')}
            className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3', regenAll && 'animate-spin')} />
            {t('edit.timeline.voiceAll')}
          </button>
        )}

        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground/60">
          {t('edit.timeline.counts', { speech: speechCount, cue: cueCount })}
        </span>
        {/* pan the timeline viewport left/right */}
        {!lineMode && (
          <div className="ml-1 flex items-center border-l border-gray-200/70 pl-1 dark:border-gray-700/60">
            <button
              type="button"
              onClick={() => panViewport(-1)}
              title={t('edit.timeline.panLeft')}
              aria-label={t('edit.timeline.panLeft')}
              className="grid size-7 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronsLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => panViewport(1)}
              title={t('edit.timeline.panRight')}
              aria-label={t('edit.timeline.panRight')}
              className="grid size-7 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronsRight className="size-4" />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setLineMode((v) => !v)}
          title={lineMode ? t('edit.timeline.expandTrack') : t('edit.timeline.collapseAxis')}
          aria-label={lineMode ? t('edit.timeline.expandTrack') : t('edit.timeline.collapseAxis')}
          className="ml-1 grid size-7 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        >
          {lineMode ? <UnfoldVertical className="size-4" /> : <FoldVertical className="size-4" />}
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="relative h-full min-w-max">
          {/* the timeline axis (top) — nodes hang below it; hidden when empty
                so the placeholder hint doesn't collide with the line */}
          {actions.length > 0 && (
            <div
              className="pointer-events-none absolute inset-x-3 bg-gradient-to-r from-border/30 via-border to-border/30"
              style={{ top: AXIS_FROM_TOP - 1, height: 2 }}
            />
          )}
          <div className="relative flex h-full items-stretch px-3.5">
            {actions.length === 0 && (
              <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[12px] text-muted-foreground/60">
                {t('edit.timeline.emptyHint')}
              </span>
            )}
            <DropZone
              active={dragOver === 0}
              slot={0}
              flex={actions.length === 0}
              onEnter={() => setDragOver(0)}
              onDrop={() => handleDrop(0)}
              onInsert={(slot, rect) => setPickerAt({ slot, rect })}
              insertLabel={t('edit.timeline.addAction')}
            />
            {items.map(({ action, index, key, speechIndex: si }) => {
              // A discussion is pinned terminal, so it can't be drag-reordered.
              const isDiscussion = action.type === 'discussion';
              const onDragStart = isDiscussion
                ? () => {}
                : (e: React.DragEvent) => {
                    dragRef.current = { kind: 'move', id: key };
                    setBlankDragImage(e);
                  };
              const onDragEnd = () => {
                dragRef.current = null;
                setDragOver(null);
              };
              const onPick = () =>
                useCanvasStore
                  .getState()
                  .setPickTarget({ sceneId, actionId: key, cueType: action.type });
              const dot = (
                <NodeDot
                  action={action}
                  onTip={setTip}
                  onPick={onPick}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  canDrag={!isDiscussion}
                />
              );
              return (
                <div key={key} className="relative flex h-full items-stretch">
                  <motion.div
                    initial={reduce ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.22,
                      delay: reduce ? 0 : Math.min(index * 0.02, 0.24),
                      ease: 'easeOut',
                    }}
                    className="flex h-full flex-col items-center"
                    style={{ paddingTop: AXIS_FROM_TOP - 12 }}
                  >
                    {lineMode ? (
                      <div className="w-9">{dot}</div>
                    ) : (
                      <>
                        {dot}
                        <div className="my-1 h-2.5 w-px bg-border" />
                        <div className="min-h-0 w-full flex-1">
                          {action.type === 'speech' ? (
                            <SpeechClip
                              text={(action as { text?: string }).text ?? ''}
                              index={si}
                              actionId={key}
                              audioId={(action as { audioId?: string }).audioId}
                              sceneOrder={sceneOrder}
                              language={language}
                              ttsActive={ttsActive}
                              audioUrl={(action as { audioUrl?: string }).audioUrl}
                              ttsRefresh={ttsRefresh}
                              regenerating={regeneratingIds.has(key)}
                              autoFocus={key === focusId}
                              onFocused={() => setFocusId(null)}
                              onCommit={(text) => {
                                commit((cur) => setSpeechTextById(cur, key, text));
                                setTtsRefresh((n) => n + 1);
                              }}
                              onGenerated={() =>
                                commit((cur) =>
                                  setAudioIdById(cur, key, speechAudioId(sceneOrder, key)),
                                )
                              }
                              onDelete={() => commit((cur) => removeById(cur, key))}
                              onMoveLeft={() => commit((cur) => moveByIdDir(cur, key, -1))}
                              onMoveRight={() => commit((cur) => moveByIdDir(cur, key, 1))}
                              canMoveLeft={index > 0}
                              canMoveRight={index < lastMovableIndex}
                              onDragStart={onDragStart}
                              onDragEnd={onDragEnd}
                            />
                          ) : isDiscussion ? (
                            <DiscussionClip
                              topic={(action as DiscussionAction).topic ?? ''}
                              prompt={(action as DiscussionAction).prompt ?? ''}
                              agentId={(action as DiscussionAction).agentId ?? ''}
                              agents={discussionAgents}
                              onTopicChange={(v) =>
                                commit((cur) => setDiscussionTopicById(cur, key, v))
                              }
                              onPromptChange={(v) =>
                                commit((cur) => setDiscussionPromptById(cur, key, v))
                              }
                              onAgentChange={(v) =>
                                commit((cur) => setDiscussionAgentById(cur, key, v))
                              }
                              onDelete={() => commit((cur) => removeById(cur, key))}
                            />
                          ) : (
                            <CueMarker
                              action={action}
                              elements={sceneElements}
                              onTip={setTip}
                              onDelete={() => commit((cur) => removeById(cur, key))}
                              onPick={onPick}
                              onMoveLeft={() => commit((cur) => moveByIdDir(cur, key, -1))}
                              onMoveRight={() => commit((cur) => moveByIdDir(cur, key, 1))}
                              canMoveLeft={index > 0}
                              canMoveRight={index < lastMovableIndex}
                              onDragStart={onDragStart}
                              onDragEnd={onDragEnd}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </motion.div>
                  <DropZone
                    active={dragOver === index + 1}
                    slot={index + 1}
                    onEnter={() => setDragOver(index + 1)}
                    onDrop={() => handleDrop(index + 1)}
                    onInsert={(slot, rect) => setPickerAt({ slot, rect })}
                    insertLabel={t('edit.timeline.addAction')}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {tip && <CueTooltip tip={tip} />}
      {pickerAt && (
        <ActionPicker
          anchor={pickerAt.rect}
          sceneType={sceneType}
          actions={actions}
          onSelect={(type) => insertActionAt(type, pickerAt.slot)}
          onClose={() => setPickerAt(null)}
        />
      )}
    </section>
  );
}
