/**
 * Feature flags. Public flags come from `NEXT_PUBLIC_*` env vars, which
 * Next.js inlines at build time so they are safe to read from client
 * components. Server-only flags must not use the `NEXT_PUBLIC_` prefix.
 *
 * Truthy values: `'true'`, `'1'`, `'yes'`, or `'on'` (case-insensitive).
 * Anything else (including unset) is treated as disabled.
 */

import type { Scene, SceneType } from '@/lib/types/stage';

export type FeatureFlag =
  | 'companionSelector'
  | 'classroomChat'
  | 'interactiveScenes'
  | 'discussionScenes'
  | 'workspaceScenes'
  | 'flowScenes';

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

export function readFeatureFlagBoolean(envValue: string | undefined): boolean {
  return TRUE_VALUES.has((envValue ?? '').trim().toLowerCase());
}

/**
 * MAIC Editor (edit mode) gate. Default OFF — gates only the edit toggle
 * affordance in `Header`. The `StageMode` type union is unaffected so
 * existing code paths typecheck identically with the flag in either
 * state.
 */
export function isMaicEditorEnabled(): boolean {
  return readFeatureFlagBoolean(process.env.NEXT_PUBLIC_MAIC_EDITOR_ENABLED);
}

/**
 * Server-authoritative gate for the vocational task-engine generation path.
 * Default OFF. When disabled, requests that include taskEngineMode must
 * silently fall back to the ordinary standard / interactive generation paths.
 */
export function isVocationalTaskEngineEnabled(): boolean {
  return readFeatureFlagBoolean(process.env.OPENMAIC_ENABLE_VOCATIONAL);
}

export function resolveVocationalActive(
  requirements?: { taskEngineMode?: boolean } | null,
): boolean {
  return Boolean(requirements?.taskEngineMode) && isVocationalTaskEngineEnabled();
}

/**
 * Optional client-only affordance for exposing the experimental vocational
 * test toggle. This is not a security or routing gate.
 */
export function shouldShowVocationalTestUi(): boolean {
  return readFeatureFlagBoolean(process.env.NEXT_PUBLIC_SHOW_VOCATIONAL_TEST_UI);
}

/**
 * Experimental classroom video export (Hyperframes composition ZIP, #865).
 * Default OFF — gates only the "Export Video" affordance in the export menu.
 * The emitter/compiler code paths are unaffected; this hides the UI entry
 * point until the render pipeline (#866) lands.
 */
export function isVideoExportEnabled(): boolean {
  return readFeatureFlagBoolean(process.env.NEXT_PUBLIC_ENABLE_VIDEO_EXPORT);
}

const featureFlags = {
  companionSelector: readFeatureFlagBoolean(process.env.NEXT_PUBLIC_FEATURE_COMPANION_SELECTOR),
  classroomChat: readFeatureFlagBoolean(process.env.NEXT_PUBLIC_FEATURE_CLASSROOM_CHAT),
  interactiveScenes: readFeatureFlagBoolean(process.env.NEXT_PUBLIC_FEATURE_INTERACTIVE_SCENES),
  discussionScenes:
    readFeatureFlagBoolean(process.env.NEXT_PUBLIC_FEATURE_INTERACTIVE_SCENES) &&
    readFeatureFlagBoolean(process.env.NEXT_PUBLIC_FEATURE_DISCUSSION_SCENES),
  workspaceScenes:
    readFeatureFlagBoolean(process.env.NEXT_PUBLIC_FEATURE_INTERACTIVE_SCENES) &&
    readFeatureFlagBoolean(process.env.NEXT_PUBLIC_FEATURE_WORKSPACE_SCENES),
  flowScenes:
    readFeatureFlagBoolean(process.env.NEXT_PUBLIC_FEATURE_INTERACTIVE_SCENES) &&
    readFeatureFlagBoolean(process.env.NEXT_PUBLIC_FEATURE_FLOW_SCENES),
} as const satisfies Record<FeatureFlag, boolean>;

export const FEATURE_FLAGS: Readonly<Record<FeatureFlag, boolean>> = featureFlags;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}

export function isCompanionSelectorEnabled(): boolean {
  return isFeatureEnabled('companionSelector');
}

export function isClassroomChatEnabled(): boolean {
  return isFeatureEnabled('classroomChat');
}

export function isInteractiveScenesEnabled(): boolean {
  return isFeatureEnabled('interactiveScenes');
}

export function isDiscussionScenesEnabled(): boolean {
  return isFeatureEnabled('discussionScenes');
}

export function isWorkspaceScenesEnabled(): boolean {
  return isFeatureEnabled('workspaceScenes');
}

export function isFlowScenesEnabled(): boolean {
  return isFeatureEnabled('flowScenes');
}

export function isSceneTypeEnabled(sceneType: SceneType): boolean {
  switch (sceneType) {
    case 'interactive':
      return isInteractiveScenesEnabled();
    case 'pbl':
      return isWorkspaceScenesEnabled();
    case 'slide':
    case 'quiz':
    default:
      return true;
  }
}

function isFlowScene(scene: Pick<Scene, 'type' | 'content'>): boolean {
  if (scene.type !== 'interactive' || scene.content.type !== 'interactive') return false;
  if (scene.content.widgetType === 'diagram') {
    const outline = scene.content.widgetConfig;
    return outline?.type === 'diagram' && outline.diagramType === 'flowchart';
  }
  return false;
}

export function isSceneEnabled(scene: Pick<Scene, 'type' | 'content'>): boolean {
  if (!isSceneTypeEnabled(scene.type)) return false;
  if (isFlowScene(scene) && !isFlowScenesEnabled()) return false;
  return true;
}

export function filterEnabledScenes<T extends Pick<Scene, 'type' | 'content'>>(scenes: T[]): T[] {
  return scenes.filter(isSceneEnabled);
}
