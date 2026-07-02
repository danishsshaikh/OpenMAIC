import type { Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import type { PlaybackSnapshot } from './types';

const STORAGE_PREFIX = 'openmaic:playback-resume-position:v1';
const STORE_VERSION = 1;

interface StoredResumePosition {
  sceneId: string;
  actionIndex: number;
  actionId: string;
  actionType: Action['type'];
  textFingerprint?: string;
}

interface ResumeStore {
  version: typeof STORE_VERSION;
  scopeId: string;
  positions: Record<string, StoredResumePosition>;
}

export interface PlaybackResumePosition {
  sceneId: string;
  actionIndex: number;
  actionId: string;
  actionType: Action['type'];
}

function storageKey(scopeId: string): string {
  return `${STORAGE_PREFIX}:${scopeId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function actionTextFingerprint(action: Action): string | undefined {
  if (action.type !== 'speech') return undefined;
  return action.text.trim().slice(0, 120);
}

function isUnsafeResumeAction(action: Action): boolean {
  return (
    action.type === 'discussion' ||
    action.type === 'play_video' ||
    action.type.startsWith('widget_') ||
    action.type.startsWith('wb_')
  );
}

function hasUnsafeResumeBoundary(actions: readonly Action[], actionIndex: number): boolean {
  return actions.slice(0, actionIndex + 1).some(isUnsafeResumeAction);
}

function parseStore(raw: string | null, scopeId: string): ResumeStore | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== STORE_VERSION || parsed.scopeId !== scopeId) return null;
    if (!isRecord(parsed.positions)) return null;

    const positions: Record<string, StoredResumePosition> = {};
    for (const [sceneId, value] of Object.entries(parsed.positions)) {
      if (!isRecord(value)) continue;
      if (
        typeof value.sceneId !== 'string' ||
        value.sceneId !== sceneId ||
        typeof value.actionIndex !== 'number' ||
        !Number.isInteger(value.actionIndex) ||
        value.actionIndex < 0 ||
        typeof value.actionId !== 'string' ||
        typeof value.actionType !== 'string'
      ) {
        continue;
      }
      if (value.textFingerprint !== undefined && typeof value.textFingerprint !== 'string') {
        continue;
      }
      positions[sceneId] = {
        sceneId: value.sceneId,
        actionIndex: value.actionIndex,
        actionId: value.actionId,
        actionType: value.actionType as Action['type'],
        textFingerprint: value.textFingerprint,
      };
    }

    return { version: STORE_VERSION, scopeId, positions };
  } catch {
    return null;
  }
}

function readStore(scopeId: string): ResumeStore {
  if (typeof window === 'undefined') {
    return { version: STORE_VERSION, scopeId, positions: {} };
  }

  try {
    return (
      parseStore(window.sessionStorage.getItem(storageKey(scopeId)), scopeId) ?? {
        version: STORE_VERSION,
        scopeId,
        positions: {},
      }
    );
  } catch {
    return { version: STORE_VERSION, scopeId, positions: {} };
  }
}

function writeStore(scopeId: string, store: ResumeStore): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(storageKey(scopeId), JSON.stringify(store));
  } catch {
    // Session storage can be unavailable or quota-limited; resume is best-effort.
  }
}

export function savePlaybackResumePosition(
  scopeId: string | null | undefined,
  scene: Scene,
  snapshot: PlaybackSnapshot,
): void {
  if (!scopeId || snapshot.sceneId !== scene.id) return;

  const actions = scene.actions ?? [];
  const action = actions[snapshot.actionIndex];
  if (!action || hasUnsafeResumeBoundary(actions, snapshot.actionIndex)) return;

  const store = readStore(scopeId);
  store.positions[scene.id] = {
    sceneId: scene.id,
    actionIndex: snapshot.actionIndex,
    actionId: action.id,
    actionType: action.type,
    textFingerprint: actionTextFingerprint(action),
  };
  writeStore(scopeId, store);
}

export function loadPlaybackResumePosition(
  scopeId: string | null | undefined,
  scene: Scene,
): PlaybackResumePosition | null {
  if (!scopeId) return null;

  const stored = readStore(scopeId).positions[scene.id];
  if (!stored) return null;

  const actions = scene.actions ?? [];
  const action = actions[stored.actionIndex];
  if (!action || hasUnsafeResumeBoundary(actions, stored.actionIndex)) return null;
  if (action.id !== stored.actionId || action.type !== stored.actionType) return null;
  if (actionTextFingerprint(action) !== stored.textFingerprint) return null;

  return {
    sceneId: stored.sceneId,
    actionIndex: stored.actionIndex,
    actionId: stored.actionId,
    actionType: stored.actionType,
  };
}

export function clearPlaybackResumePosition(
  scopeId: string | null | undefined,
  sceneId: string,
): void {
  if (!scopeId) return;

  const store = readStore(scopeId);
  delete store.positions[sceneId];
  writeStore(scopeId, store);
}
