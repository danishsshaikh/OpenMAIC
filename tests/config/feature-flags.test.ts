import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeScene, type Scene, type SceneContent } from '@/lib/types/stage';
import type { WidgetConfig } from '@/lib/types/widgets';
import type { PBLProjectConfig } from '@/lib/pbl/types';

const FLAG_KEYS = [
  'NEXT_PUBLIC_MAIC_EDITOR_ENABLED',
  'OPENMAIC_ENABLE_VOCATIONAL',
  'NEXT_PUBLIC_SHOW_VOCATIONAL_TEST_UI',
  'NEXT_PUBLIC_ENABLE_VIDEO_EXPORT',
  'NEXT_PUBLIC_FEATURE_COMPANION_SELECTOR',
  'NEXT_PUBLIC_FEATURE_CLASSROOM_CHAT',
  'NEXT_PUBLIC_FEATURE_INTERACTIVE_SCENES',
  'NEXT_PUBLIC_FEATURE_DISCUSSION_SCENES',
  'NEXT_PUBLIC_FEATURE_WORKSPACE_SCENES',
  'NEXT_PUBLIC_FEATURE_FLOW_SCENES',
] as const;

const originalEnv = new Map<string, string | undefined>(
  FLAG_KEYS.map((key) => [key, process.env[key]]),
);

async function loadFlags() {
  vi.resetModules();
  return import('@/lib/config/feature-flags');
}

function resetFlagEnv() {
  for (const key of FLAG_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

const emptySlideContent = {
  type: 'slide',
  canvas: {
    id: 'slide-canvas',
    viewportSize: 1000,
    viewportRatio: 0.5625,
    theme: {
      backgroundColor: '#ffffff',
      themeColors: ['#5b9bd5'],
      fontColor: '#111111',
      fontName: 'Arial',
    },
    elements: [],
  },
} satisfies Extract<Scene['content'], { type: 'slide' }>;

const flowWidgetConfig = {
  type: 'diagram',
  diagramType: 'flowchart',
  description: 'Simple flowchart',
  nodes: [],
  edges: [],
} satisfies WidgetConfig;

const projectConfig = {
  projectInfo: { title: 'Project', description: 'Project workspace' },
  agents: [],
  issueboard: { agent_ids: [], issues: [], current_issue_id: null },
  chat: { messages: [] },
} satisfies PBLProjectConfig;

function scene(
  content: SceneContent,
  overrides: Partial<Omit<Scene, 'type' | 'content'>> = {},
): Scene {
  return makeScene(
    {
      id: 'scene',
      stageId: 'stage',
      title: 'Scene',
      order: 0,
      actions: [],
      ...overrides,
    },
    content,
  );
}

function sceneCore(overrides: Partial<Omit<Scene, 'type' | 'content'>>) {
  return {
    id: 'scene',
    stageId: 'stage',
    title: 'Scene',
    order: 0,
    actions: [],
    ...overrides,
  };
}

afterEach(() => {
  resetFlagEnv();
  vi.resetModules();
});

describe('readFeatureFlagBoolean', () => {
  it('accepts explicit truthy values only', async () => {
    const { readFeatureFlagBoolean } = await loadFlags();

    expect(readFeatureFlagBoolean('true')).toBe(true);
    expect(readFeatureFlagBoolean('TRUE')).toBe(true);
    expect(readFeatureFlagBoolean(' 1 ')).toBe(true);
    expect(readFeatureFlagBoolean('yes')).toBe(true);
    expect(readFeatureFlagBoolean('on')).toBe(true);
    expect(readFeatureFlagBoolean(undefined)).toBe(false);
    expect(readFeatureFlagBoolean('')).toBe(false);
    expect(readFeatureFlagBoolean('false')).toBe(false);
    expect(readFeatureFlagBoolean('enabled')).toBe(false);
  });
});

describe('legacy feature flags', () => {
  it('keeps MAIC editor default off and supports true-like values', async () => {
    delete process.env.NEXT_PUBLIC_MAIC_EDITOR_ENABLED;
    let flags = await loadFlags();
    expect(flags.isMaicEditorEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_MAIC_EDITOR_ENABLED = 'on';
    flags = await loadFlags();
    expect(flags.isMaicEditorEnabled()).toBe(true);
  });

  it('requires request intent and the server vocational flag', async () => {
    process.env.OPENMAIC_ENABLE_VOCATIONAL = 'true';
    let flags = await loadFlags();
    expect(flags.isVocationalTaskEngineEnabled()).toBe(true);
    expect(flags.resolveVocationalActive({ taskEngineMode: true })).toBe(true);
    expect(flags.resolveVocationalActive({ taskEngineMode: false })).toBe(false);
    expect(flags.resolveVocationalActive(undefined)).toBe(false);

    process.env.OPENMAIC_ENABLE_VOCATIONAL = 'false';
    flags = await loadFlags();
    expect(flags.resolveVocationalActive({ taskEngineMode: true })).toBe(false);
  });

  it('keeps vocational test UI and video export default off', async () => {
    delete process.env.NEXT_PUBLIC_SHOW_VOCATIONAL_TEST_UI;
    delete process.env.NEXT_PUBLIC_ENABLE_VIDEO_EXPORT;
    let flags = await loadFlags();
    expect(flags.shouldShowVocationalTestUi()).toBe(false);
    expect(flags.isVideoExportEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_SHOW_VOCATIONAL_TEST_UI = 'yes';
    process.env.NEXT_PUBLIC_ENABLE_VIDEO_EXPORT = '1';
    flags = await loadFlags();
    expect(flags.shouldShowVocationalTestUi()).toBe(true);
    expect(flags.isVideoExportEnabled()).toBe(true);
  });
});

describe('classroom feature flags', () => {
  it('defaults every new classroom feature off', async () => {
    const flags = await loadFlags();

    expect(flags.FEATURE_FLAGS).toEqual({
      companionSelector: false,
      classroomChat: false,
      interactiveScenes: false,
      discussionScenes: false,
      workspaceScenes: false,
      flowScenes: false,
    });
  });

  it('enables subordinate scene flags only when the interactive master is on', async () => {
    process.env.NEXT_PUBLIC_FEATURE_DISCUSSION_SCENES = 'true';
    process.env.NEXT_PUBLIC_FEATURE_WORKSPACE_SCENES = 'true';
    process.env.NEXT_PUBLIC_FEATURE_FLOW_SCENES = 'true';
    let flags = await loadFlags();

    expect(flags.isInteractiveScenesEnabled()).toBe(false);
    expect(flags.isDiscussionScenesEnabled()).toBe(false);
    expect(flags.isWorkspaceScenesEnabled()).toBe(false);
    expect(flags.isFlowScenesEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_FEATURE_INTERACTIVE_SCENES = 'true';
    flags = await loadFlags();

    expect(flags.isInteractiveScenesEnabled()).toBe(true);
    expect(flags.isDiscussionScenesEnabled()).toBe(true);
    expect(flags.isWorkspaceScenesEnabled()).toBe(true);
    expect(flags.isFlowScenesEnabled()).toBe(true);
  });

  it('filters disabled interactive, workspace, and flow scenes from playback navigation', async () => {
    const slide = scene(emptySlideContent, sceneCore({ id: 'slide-1' }));
    const quiz = scene({ type: 'quiz', questions: [] }, sceneCore({ id: 'quiz-1' }));
    const interactive = scene(
      {
        type: 'interactive',
        url: 'about:blank',
        html: '<button />',
        widgetType: 'simulation',
      },
      sceneCore({ id: 'interactive-1' }),
    );
    const workspace = scene({ type: 'pbl', projectConfig }, sceneCore({ id: 'pbl-1' }));
    const flow = scene(
      {
        type: 'interactive',
        url: 'about:blank',
        html: '<div />',
        widgetType: 'diagram',
        widgetConfig: flowWidgetConfig,
      },
      sceneCore({ id: 'flow-1' }),
    );

    let flags = await loadFlags();
    expect(flags.filterEnabledScenes([slide, quiz, interactive, workspace, flow])).toEqual([
      slide,
      quiz,
    ]);

    process.env.NEXT_PUBLIC_FEATURE_INTERACTIVE_SCENES = 'true';
    flags = await loadFlags();
    expect(flags.filterEnabledScenes([slide, quiz, interactive, workspace, flow])).toEqual([
      slide,
      quiz,
      interactive,
    ]);

    process.env.NEXT_PUBLIC_FEATURE_WORKSPACE_SCENES = 'true';
    process.env.NEXT_PUBLIC_FEATURE_FLOW_SCENES = 'true';
    flags = await loadFlags();
    expect(flags.filterEnabledScenes([slide, quiz, interactive, workspace, flow])).toEqual([
      slide,
      quiz,
      interactive,
      workspace,
      flow,
    ]);
  });
});
