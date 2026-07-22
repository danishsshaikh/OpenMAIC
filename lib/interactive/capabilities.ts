import type { SceneOutline } from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';
import type { WidgetConfig, WidgetType } from '@/lib/types/widgets';

export type InteractiveCapabilityCategory =
  | 'code'
  | 'simulation'
  | 'quiz'
  | 'discussion'
  | 'workspace'
  | 'flow'
  | 'other';

export interface InteractiveCapabilities {
  deterministicLocal: boolean;
  requiresRuntimeAi: boolean;
  requiresDiscussion: boolean;
  usesStepFlow: boolean;
  supportsLearnerControls: boolean;
  category: InteractiveCapabilityCategory;
  blockedReason?: string;
}

export interface InteractiveCapabilityTrace {
  sceneId?: string;
  title?: string;
  sceneType?: string;
  sceneSubtype?: string;
  rendererType?: string;
  interactionType?: string;
  deterministic: boolean;
  requiresRuntimeAi: boolean;
  requiresDiscussion: boolean;
  usesStepFlow: boolean;
  selectedCapability: InteractiveCapabilityCategory | 'static';
  blockedReason?: string;
}

const RUNTIME_AI_PATTERNS = [
  /\/api\/(?:chat|generate|agent|agents|pbl\/v2\/task|comfyui|parse-pdf)\b/i,
  /\b(?:openai|anthropic|gemini|deepseek|qwen|glm|doubao|siliconflow|openrouter)\b/i,
  /\b(?:TTS|ASR|speechRecognition|webkitSpeechRecognition)\b/i,
];

function htmlRequiresRuntimeAi(html?: string): boolean {
  if (!html) return false;
  return RUNTIME_AI_PATTERNS.some((pattern) => pattern.test(html));
}

function flowFromWidget(widgetType?: WidgetType, widgetConfig?: WidgetConfig): boolean {
  return (
    widgetType === 'diagram' &&
    widgetConfig?.type === 'diagram' &&
    (widgetConfig.diagramType === 'flowchart' || (widgetConfig.revealOrder?.length ?? 0) > 0)
  );
}

function flowFromOutline(outline: SceneOutline): boolean {
  return (
    outline.widgetType === 'diagram' &&
    (outline.widgetOutline?.diagramType === 'flowchart' ||
      (outline.widgetOutline?.steps?.length ?? 0) > 0)
  );
}

function categoryForWidget(widgetType?: WidgetType): InteractiveCapabilityCategory {
  switch (widgetType) {
    case 'code':
      return 'code';
    case 'simulation':
      return 'simulation';
    case 'game':
      return 'quiz';
    case 'diagram':
      return 'flow';
    case 'procedural-skill':
      return 'flow';
    case 'visualization3d':
      return 'other';
    default:
      return 'other';
  }
}

function allowed(c: InteractiveCapabilities): boolean {
  return (
    c.deterministicLocal &&
    c.supportsLearnerControls &&
    !c.requiresRuntimeAi &&
    !c.requiresDiscussion &&
    !c.usesStepFlow
  );
}

function withBlockedReason(c: InteractiveCapabilities): InteractiveCapabilities {
  if (allowed(c)) return c;
  const reasons: string[] = [];
  if (!c.deterministicLocal) reasons.push('not-deterministic-local');
  if (!c.supportsLearnerControls) reasons.push('no-learner-controls');
  if (c.requiresRuntimeAi) reasons.push('requires-runtime-ai');
  if (c.requiresDiscussion) reasons.push('requires-discussion');
  if (c.usesStepFlow) reasons.push('uses-step-flow');
  return { ...c, blockedReason: reasons.join(',') || 'blocked' };
}

export function classifyInteractiveOutline(outline: SceneOutline): InteractiveCapabilities {
  if (outline.type === 'pbl') {
    return withBlockedReason({
      deterministicLocal: false,
      requiresRuntimeAi: true,
      requiresDiscussion: true,
      usesStepFlow: false,
      supportsLearnerControls: true,
      category: 'workspace',
    });
  }

  if (outline.type !== 'interactive') {
    return withBlockedReason({
      deterministicLocal: false,
      requiresRuntimeAi: false,
      requiresDiscussion: false,
      usesStepFlow: false,
      supportsLearnerControls: false,
      category: 'other',
    });
  }

  const category = categoryForWidget(outline.widgetType);
  const usesStepFlow = outline.widgetType === 'procedural-skill' || flowFromOutline(outline);
  const supportsLearnerControls =
    outline.widgetType === 'code' ||
    outline.widgetType === 'simulation' ||
    outline.widgetType === 'game' ||
    outline.widgetType === 'visualization3d';

  return withBlockedReason({
    deterministicLocal: supportsLearnerControls && !usesStepFlow,
    requiresRuntimeAi: false,
    requiresDiscussion: outline.widgetType === 'procedural-skill',
    usesStepFlow,
    supportsLearnerControls,
    category,
  });
}

export function isAllowedDeterministicInteractiveOutline(outline: SceneOutline): boolean {
  return allowed(classifyInteractiveOutline(outline));
}

export function classifySceneInteractiveCapabilities(
  scene: Pick<Scene, 'id' | 'title' | 'type' | 'content'>,
): InteractiveCapabilities {
  if (scene.type === 'pbl') {
    return withBlockedReason({
      deterministicLocal: false,
      requiresRuntimeAi: true,
      requiresDiscussion: true,
      usesStepFlow: false,
      supportsLearnerControls: true,
      category: 'workspace',
    });
  }

  if (scene.type !== 'interactive' || scene.content.type !== 'interactive') {
    return withBlockedReason({
      deterministicLocal: false,
      requiresRuntimeAi: false,
      requiresDiscussion: false,
      usesStepFlow: false,
      supportsLearnerControls: false,
      category: 'other',
    });
  }

  const content = scene.content;
  const category = categoryForWidget(content.widgetType);
  const usesStepFlow =
    content.widgetType === 'procedural-skill' ||
    flowFromWidget(content.widgetType, content.widgetConfig);
  const supportsLearnerControls =
    content.widgetType === 'code' ||
    content.widgetType === 'simulation' ||
    content.widgetType === 'game' ||
    content.widgetType === 'visualization3d';

  return withBlockedReason({
    deterministicLocal: supportsLearnerControls && !usesStepFlow,
    requiresRuntimeAi: htmlRequiresRuntimeAi(content.html),
    requiresDiscussion: content.widgetType === 'procedural-skill',
    usesStepFlow,
    supportsLearnerControls,
    category,
  });
}

export function isAllowedDeterministicInteractiveScene(
  scene: Pick<Scene, 'id' | 'title' | 'type' | 'content'>,
): boolean {
  return allowed(classifySceneInteractiveCapabilities(scene));
}

export function isDeterministicCodeInteractive(
  scene: Pick<Scene, 'id' | 'title' | 'type' | 'content'>,
): boolean {
  const capabilities = classifySceneInteractiveCapabilities(scene);
  return capabilities.category === 'code' && allowed(capabilities);
}

export function buildInteractiveCapabilityTrace(
  scene: Pick<Scene, 'id' | 'title' | 'type' | 'content'>,
  rendererType: string = scene.type,
): InteractiveCapabilityTrace {
  const capabilities = classifySceneInteractiveCapabilities(scene);
  return {
    sceneId: scene.id,
    title: scene.title,
    sceneType: scene.type,
    sceneSubtype: scene.content.type,
    rendererType,
    interactionType:
      scene.content.type === 'interactive' ? scene.content.widgetType || 'interactive' : scene.type,
    deterministic: capabilities.deterministicLocal,
    requiresRuntimeAi: capabilities.requiresRuntimeAi,
    requiresDiscussion: capabilities.requiresDiscussion,
    usesStepFlow: capabilities.usesStepFlow,
    selectedCapability: scene.type === 'interactive' ? capabilities.category : 'static',
    blockedReason: capabilities.blockedReason,
  };
}

export function buildInteractiveOutlineTrace(
  outline: SceneOutline,
  rendererType: string = outline.type,
): InteractiveCapabilityTrace {
  const capabilities = classifyInteractiveOutline(outline);
  return {
    sceneId: outline.id,
    title: outline.title,
    sceneType: outline.type,
    sceneSubtype: outline.widgetType,
    rendererType,
    interactionType: outline.widgetType || outline.type,
    deterministic: capabilities.deterministicLocal,
    requiresRuntimeAi: capabilities.requiresRuntimeAi,
    requiresDiscussion: capabilities.requiresDiscussion,
    usesStepFlow: capabilities.usesStepFlow,
    selectedCapability: outline.type === 'interactive' ? capabilities.category : 'static',
    blockedReason: capabilities.blockedReason,
  };
}

export function traceInteractiveCapability(
  checkpoint: string,
  trace: InteractiveCapabilityTrace,
): void {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_INTERACTIVE_CAPABILITY_TRACE !== 'true'
  ) {
    return;
  }
  console.debug('[InteractiveCapabilityTrace]', checkpoint, trace);
  console.debug(
    'interactiveCapabilityFlat',
    `${trace.title || trace.sceneId || 'unknown'} | type: ${trace.sceneType || 'unknown'} | subtype: ${trace.interactionType || 'unknown'} | deterministic: ${trace.deterministic} | selected: ${trace.selectedCapability}${trace.blockedReason ? ` | blocked: ${trace.blockedReason}` : ''}`,
  );
}
