import type { Action, SpeechAction } from '@/lib/types/action';
import type { Scene, SceneContent } from '@/lib/types/stage';
import type { PPTElement } from '@openmaic/dsl';

export type NarrationSyncStatus =
  | 'synced'
  | 'narration-stale'
  | 'audio-stale'
  | 'syncing'
  | 'error'
  | 'unknown-legacy';

export type NarrationSyncOperation =
  | 'narration-and-audio'
  | 'audio-only'
  | 'none'
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

export interface NarrationSyncDecision {
  operation: NarrationSyncOperation;
  resolvedStaleState: NarrationSyncStatus;
  currentNarrationSourceFingerprint: string;
  storedNarrationSourceFingerprint?: string;
  narrationSourceChanged: boolean;
  currentAudioFingerprint: string;
  storedAudioFingerprint?: string;
  audioChanged: boolean;
  hasExistingNarration: boolean;
  hasExistingAudio: boolean;
  isLegacyWithoutNarrationFingerprint: boolean;
  isLegacyWithoutAudioFingerprint: boolean;
}

export interface NarrationSource {
  text: string;
  elementCount: number;
  fingerprint: string;
  preview: string;
  visualBlocks: NarrationVisualBlock[];
}

export interface NarrationVisualBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NarrationVisualBlock {
  blockId: string;
  elementIds: string[];
  targetElementId: string;
  text: string;
  bounds: NarrationVisualBounds;
  orderIndex: number;
  parentOrGroupId?: string;
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

export function getVisibleElementText(element: PPTElement): string {
  if (isHiddenSlideElement(element)) return '';
  const record = element as unknown as Record<string, unknown>;
  switch (element.type) {
    case 'text':
      return normalizeNarrationText(record.content);
    case 'shape': {
      const text = record.text;
      const textContent =
        text && typeof text === 'object' ? (text as { content?: unknown }).content : undefined;
      if (text && typeof text === 'object') return normalizeNarrationText(textContent);
      return normalizeNarrationText(record.content);
    }
    case 'table':
      return (
        (record.data as Array<Array<{ text?: unknown }>> | undefined)
          ?.flatMap((row) => row.map((cell) => normalizeNarrationText(cell.text)))
          .filter(Boolean)
          .join('\n') ?? ''
      );
    case 'latex':
      return normalizeNarrationText(record.latex);
    case 'code':
      return (
        (record.lines as Array<{ content?: unknown }> | undefined)
          ?.map((line) => normalizeNarrationText(line.content))
          .filter(Boolean)
          .join('\n') ?? ''
      );
    case 'image':
    case 'video':
    case 'audio':
      return '';
    default:
      return visibleRecordText(record).join('\n');
  }
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
  return buildNarrationSourceFromScene(scene).fingerprint;
}

export function buildNarrationSourceFromScene(
  scene: Pick<Scene, 'content' | 'title'>,
): NarrationSource {
  const visualBlocks =
    scene.content.type === 'slide' ? buildVisualNarrationBlocksFromScene(scene) : [];
  const title = normalizeNarrationText(scene.title);
  const duplicateTitleIndex = title
    ? visualBlocks.findIndex(
        (block) => canonicalNarrationLine(block.text) === canonicalNarrationLine(title),
      )
    : -1;
  const sourceVisualBlocks =
    duplicateTitleIndex >= 0
      ? visualBlocks.filter((_block, index) => index !== duplicateTitleIndex)
      : visualBlocks;
  const contentLines =
    scene.content.type === 'slide'
      ? sourceVisualBlocks.map((block) => block.text)
      : visibleContentLines(scene.content);
  const lines = [title, ...contentLines].filter(Boolean);
  const text = lines.join('\n');
  return {
    text,
    elementCount:
      scene.content.type === 'slide'
        ? sourceVisualBlocks.reduce((count, block) => count + block.elementIds.length, 0)
        : Math.max(0, lines.length - (normalizeNarrationText(scene.title) ? 1 : 0)),
    fingerprint:
      scene.content.type === 'slide'
        ? stableStringify({
            title,
            blocks: sourceVisualBlocks.map((block) => ({
              blockId: block.blockId,
              textFingerprint: stableStringify(block.text),
              orderIndex: block.orderIndex,
            })),
          })
        : stableStringify(lines),
    preview: text.slice(0, 120),
    visualBlocks,
  };
}

function canonicalNarrationLine(value: string): string {
  return normalizeNarrationText(value).toLowerCase();
}

export function buildVisualNarrationBlocksFromScene(
  scene: Pick<Scene, 'content'>,
): NarrationVisualBlock[] {
  if (scene.content.type !== 'slide') return [];
  return buildVisualNarrationBlocks(scene.content.canvas.elements);
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

  if (
    metadata.audioSourceFingerprint &&
    metadata.audioSourceFingerprint !== audioSourceFingerprint
  ) {
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

export function resolveNarrationSyncDecision(
  scene: Pick<Scene, 'actions' | 'content' | 'title' | 'sync'>,
  settings: NarrationAudioSettingsFingerprint = {},
  source: NarrationSource = buildNarrationSourceFromScene(scene),
): NarrationSyncDecision {
  const currentNarrationSourceFingerprint = source.fingerprint;
  const currentAudioFingerprint = getAudioSourceFingerprint(scene as Scene, settings);
  const storedNarrationSourceFingerprint = scene.sync?.narrationSourceFingerprint;
  const storedAudioFingerprint = scene.sync?.audioSourceFingerprint;
  const narrationSourceChanged = Boolean(
    storedNarrationSourceFingerprint &&
    storedNarrationSourceFingerprint !== currentNarrationSourceFingerprint,
  );
  const audioChanged = Boolean(
    storedAudioFingerprint && storedAudioFingerprint !== currentAudioFingerprint,
  );
  const state = getNarrationSyncState(scene, settings);
  const hasExistingNarration = speechActions(scene.actions).some((action) =>
    normalizeNarrationText(action.text),
  );
  const hasExistingAudio = state.hasSpeechAudio;
  const isLegacyWithoutNarrationFingerprint =
    hasExistingNarration && !storedNarrationSourceFingerprint;
  const isLegacyWithoutAudioFingerprint = hasExistingAudio && !storedAudioFingerprint;

  let operation: NarrationSyncOperation = 'none';
  if (narrationSourceChanged || state.status === 'narration-stale') {
    operation = 'narration-and-audio';
  } else if (audioChanged || state.status === 'audio-stale') {
    operation = 'audio-only';
  } else if (state.status === 'unknown-legacy') {
    operation = 'unknown-legacy';
  }

  return {
    operation,
    resolvedStaleState:
      operation === 'narration-and-audio'
        ? 'narration-stale'
        : operation === 'audio-only'
          ? 'audio-stale'
          : state.status,
    currentNarrationSourceFingerprint,
    storedNarrationSourceFingerprint,
    narrationSourceChanged,
    currentAudioFingerprint,
    storedAudioFingerprint,
    audioChanged,
    hasExistingNarration,
    hasExistingAudio,
    isLegacyWithoutNarrationFingerprint,
    isLegacyWithoutAudioFingerprint,
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
  scene: Pick<Scene, 'actions' | 'content' | 'title' | 'sync'>,
  settings: NarrationAudioSettingsFingerprint = {},
  options: { narrationSourceFingerprint?: string } = {},
): NarrationSyncMetadata {
  return {
    ...syncedNarrationMetadata(scene, settings),
    status: 'audio-stale',
    narrationSourceFingerprint:
      options.narrationSourceFingerprint ??
      scene.sync?.narrationSourceFingerprint ??
      getNarrationSourceFingerprint(scene as Scene),
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

function visibleContentLines(content: SceneContent): string[] {
  switch (content.type) {
    case 'slide':
      return buildVisualNarrationBlocks(content.canvas.elements).map((block) => block.text);
    case 'quiz':
      return content.questions.flatMap((question) => [
        normalizeNarrationText(question.question),
        ...(question.options?.map((option) => normalizeNarrationText(option.value)) ?? []),
        normalizeNarrationText(question.analysis),
      ]);
    case 'interactive':
      return [normalizeNarrationText(content.html), normalizeNarrationText(content.widgetType)];
    case 'pbl':
      return [
        normalizeNarrationText(content.projectConfig?.projectInfo?.title),
        normalizeNarrationText(content.projectConfig?.projectInfo?.description),
        normalizeNarrationText(content.projectV2 ? stableStringify(content.projectV2) : ''),
      ];
  }
}

interface TextualElement {
  element: PPTElement;
  text: string;
  bounds: NarrationVisualBounds;
}

interface VisualGroup {
  key: string;
  parentOrGroupId?: string;
  targetElementId: string;
  elements: TextualElement[];
  bounds: NarrationVisualBounds;
}

function buildVisualNarrationBlocks(elements: readonly PPTElement[]): NarrationVisualBlock[] {
  const visibleElements = elements.filter((element) => !isHiddenSlideElement(element));
  const containers = visibleElements
    .filter(isVisualContainer)
    .sort((a, b) => elementArea(a) - elementArea(b));
  const textual = visibleElements
    .map((element) => ({
      element,
      text: getVisibleElementText(element),
      bounds: elementBounds(element),
    }))
    .filter((item): item is TextualElement => Boolean(item.text));
  const groups = new Map<string, VisualGroup>();

  for (const item of textual) {
    const explicitGroup = elementGroupId(item.element);
    const container = explicitGroup ? undefined : containingContainer(item.element, containers);
    const key = explicitGroup ?? container?.id ?? item.element.id;
    const parentOrGroupId = explicitGroup ?? container?.id;
    const targetElementId = container?.id ?? item.element.id;
    const existing = groups.get(key);
    if (existing) {
      existing.elements.push(item);
      existing.bounds = unionBounds(existing.bounds, item.bounds);
    } else {
      groups.set(key, {
        key,
        parentOrGroupId,
        targetElementId,
        elements: [item],
        bounds: item.bounds,
      });
    }
  }

  const orderedGroups = orderVisualGroups([...groups.values()]);
  return orderedGroups.map((group, orderIndex) => {
    const orderedElements = orderTextualElements(group.elements);
    const seenText = new Set<string>();
    const text = orderedElements
      .map((item) => item.text)
      .filter((line) => {
        const fingerprint = stableStringify(line);
        if (seenText.has(fingerprint)) return false;
        seenText.add(fingerprint);
        return true;
      })
      .join('\n');
    return {
      blockId: group.key,
      elementIds: orderedElements.map((item) => item.element.id),
      targetElementId: group.targetElementId,
      text,
      bounds: group.bounds,
      orderIndex,
      ...(group.parentOrGroupId ? { parentOrGroupId: group.parentOrGroupId } : {}),
    };
  });
}

function orderVisualGroups(groups: VisualGroup[]): VisualGroup[] {
  return clusterRows(groups, (group) => group.bounds).flatMap((row) =>
    row.sort(
      (a, b) =>
        a.bounds.left - b.bounds.left || a.bounds.top - b.bounds.top || a.key.localeCompare(b.key),
    ),
  );
}

function orderTextualElements(elements: TextualElement[]): TextualElement[] {
  return clusterRows(elements, (item) => item.bounds).flatMap((row) =>
    row.sort(
      (a, b) =>
        a.bounds.left - b.bounds.left ||
        a.bounds.top - b.bounds.top ||
        a.element.id.localeCompare(b.element.id),
    ),
  );
}

function clusterRows<T>(items: T[], boundsFor: (item: T) => NarrationVisualBounds): T[][] {
  const sorted = [...items].sort((a, b) => {
    const aBounds = boundsFor(a);
    const bBounds = boundsFor(b);
    return aBounds.top - bBounds.top || aBounds.left - bBounds.left;
  });
  const rows: Array<{ top: number; height: number; items: T[] }> = [];
  for (const item of sorted) {
    const bounds = boundsFor(item);
    const centerY = bounds.top + bounds.height / 2;
    const row = rows.find((candidate) => {
      const rowCenter = candidate.top + candidate.height / 2;
      const tolerance = Math.max(
        24,
        Math.min(80, Math.max(candidate.height, bounds.height) * 0.35),
      );
      return Math.abs(centerY - rowCenter) <= tolerance;
    });
    if (row) {
      row.items.push(item);
      const bottom = Math.max(row.top + row.height, bounds.top + bounds.height);
      row.top = Math.min(row.top, bounds.top);
      row.height = bottom - row.top;
    } else {
      rows.push({ top: bounds.top, height: bounds.height, items: [item] });
    }
  }
  return rows.sort((a, b) => a.top - b.top).map((row) => row.items);
}

function isVisualContainer(element: PPTElement): boolean {
  if (element.type !== 'shape') return false;
  const text = getVisibleElementText(element);
  if (text) return false;
  const bounds = elementBounds(element);
  return bounds.width > 80 && bounds.height > 40;
}

function containingContainer(
  element: PPTElement,
  containers: readonly PPTElement[],
): PPTElement | undefined {
  const bounds = elementBounds(element);
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  return containers.find((candidate) => {
    if (candidate.id === element.id) return false;
    const containerBounds = elementBounds(candidate);
    const padded = padBounds(containerBounds, 12);
    if (
      centerX < padded.left ||
      centerX > padded.left + padded.width ||
      centerY < padded.top ||
      centerY > padded.top + padded.height
    ) {
      return false;
    }
    return (
      overlapArea(bounds, padded) >= Math.min(elementArea(element), areaOfBounds(bounds)) * 0.35
    );
  });
}

function elementGroupId(element: PPTElement): string | undefined {
  return (element as { groupId?: string }).groupId || undefined;
}

function elementBounds(element: PPTElement): NarrationVisualBounds {
  const record = element as unknown as Record<string, unknown>;
  return {
    left: numberOrZero(record.left),
    top: numberOrZero(record.top),
    width: numberOrZero(record.width),
    height: numberOrZero(record.height),
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function unionBounds(a: NarrationVisualBounds, b: NarrationVisualBounds): NarrationVisualBounds {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return { left, top, width: right - left, height: bottom - top };
}

function padBounds(bounds: NarrationVisualBounds, padding: number): NarrationVisualBounds {
  return {
    left: bounds.left - padding,
    top: bounds.top - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

function areaOfBounds(bounds: NarrationVisualBounds): number {
  return Math.max(0, bounds.width) * Math.max(0, bounds.height);
}

function elementArea(element: PPTElement): number {
  return areaOfBounds(elementBounds(element));
}

function overlapArea(a: NarrationVisualBounds, b: NarrationVisualBounds): number {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function visibleRecordText(record: Record<string, unknown>): string[] {
  const text = record.text;
  const textContent =
    text && typeof text === 'object' ? (text as { content?: unknown }).content : text;
  return [record.content, textContent, record.label, record.title, record.name, record.value]
    .map(normalizeNarrationText)
    .filter(Boolean);
}

function isHiddenSlideElement(element: PPTElement): boolean {
  const record = element as unknown as Record<string, unknown>;
  return (
    record.visible === false ||
    record.hidden === true ||
    record.opacity === 0 ||
    (record.style as { opacity?: unknown } | undefined)?.opacity === 0
  );
}
