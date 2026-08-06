import { describe, expect, it } from 'vitest';
import { buildPrompt, PROMPT_IDS } from '@/lib/prompts';
import { applyOutlineFallbacks } from '@/lib/generation/outline-generator';
import { buildCompleteScene, buildSceneFromOutline } from '@/lib/generation/scene-builder';
import { generateSceneContent } from '@/lib/generation/scene-generator';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import type { GeneratedInteractiveContent, SceneOutline } from '@/lib/types/generation';
import { isAllowedDeterministicInteractiveOutline } from '@/lib/interactive/capabilities';

const codeOutline: SceneOutline = {
  id: 'parallel-sum',
  type: 'interactive',
  title: 'Coding Exercise: Parallel Sum',
  description: 'Implement and run a deterministic local parallel sum exercise.',
  keyPoints: ['Editable code', 'Run and Reset', 'Deterministic expected output'],
  order: 1,
  widgetType: 'code',
  widgetOutline: { concept: 'Parallel Sum', language: 'javascript', challengeType: 'reduction' },
};

const simulationOutline: SceneOutline = {
  id: 'matrix-workload',
  type: 'interactive',
  title: 'Parallel workload distribution',
  description: 'Explore how thread count and workload size affect balance.',
  keyPoints: ['Thread count', 'Workload size', 'Scheduling mode'],
  order: 2,
  widgetType: 'simulation',
  widgetOutline: {
    concept: 'Parallel workload distribution',
    keyVariables: ['threads', 'workload', 'schedule'],
  },
};

const flowOutline: SceneOutline = {
  id: 'blocked-flow',
  type: 'interactive',
  title: 'Generated flow walkthrough',
  description: 'A flowchart that advances one step at a time.',
  keyPoints: ['Next', 'Next', 'Next'],
  order: 3,
  widgetType: 'diagram',
  widgetOutline: { concept: 'Step flow', diagramType: 'flowchart' },
};

const codeHtml = `<!doctype html>
<html>
<body>
  <textarea id="code-input">const values = [1,2,3,4];</textarea>
  <button id="run-btn">Run</button>
  <button id="reset-btn">Reset</button>
  <pre id="output"></pre>
  <script type="application/json" id="widget-config">{
    "type": "code",
    "language": "javascript",
    "description": "Parallel sum fixture",
    "starterCode": "const values = [1,2,3,4];",
    "testCases": [{ "id": "sum", "input": "[1,2,3,4]", "expected": "10" }],
    "hints": ["Reduce partial sums"],
    "solution": "const values = [1,2,3,4]; values.reduce((a,b)=>a+b,0);"
  }</script>
  <script>
    function runCode() {
      const total = [1, 2, 3, 4].reduce((a, b) => a + b, 0);
      document.getElementById('output').textContent = String(total);
    }
    function resetCode() {
      document.getElementById('code-input').value = 'const values = [1,2,3,4];';
      document.getElementById('output').textContent = '';
    }
  </script>
</body>
</html>`;

const simulationHtml = `<!doctype html>
<html>
<body>
  <input id="threads-slider" data-var="threads" type="range" min="1" max="8" value="4" />
  <input id="workload-slider" data-var="workload" type="range" min="8" max="64" value="32" />
  <button id="reset-btn">Reset</button>
  <svg id="worker-allocation"></svg>
  <output id="imbalance-output"></output>
  <script type="application/json" id="widget-config">{
    "type": "simulation",
    "concept": "parallel_workload_distribution",
    "description": "Parallel workload fixture",
    "variables": [
      { "name": "threads", "label": "Threads", "min": 1, "max": 8, "default": 4, "step": 1 },
      { "name": "workload", "label": "Workload", "min": 8, "max": 64, "default": 32, "step": 8 }
    ]
  }</script>
</body>
</html>`;

describe('deterministic interactive generation pipeline', () => {
  it('catalog prompt permits deterministic code/simulation and blocks Next/Next flow scenes', () => {
    const prompts = buildPrompt(PROMPT_IDS.INTERACTIVE_OUTLINES, {
      requirement: 'Parallel Sum and Matrix Multiplication',
      pdfContent: 'None',
      availableImages: 'No images available',
      researchContext: 'None',
      userProfile: '',
      teacherContext: '',
    });

    expect(prompts?.system).toContain('deterministic and local');
    expect(prompts?.system).toContain('Do not create step-flow widgets');
    expect(prompts?.system).toContain('javascript');
    expect(prompts?.system).toContain('simulation');
  });

  it('preserves deterministic code and simulation outlines when broad interactive scenes are off', () => {
    expect(applyOutlineFallbacks(codeOutline, true)).toMatchObject({
      type: 'interactive',
      widgetType: 'code',
    });
    expect(applyOutlineFallbacks(simulationOutline, true)).toMatchObject({
      type: 'interactive',
      widgetType: 'simulation',
    });
    expect(isAllowedDeterministicInteractiveOutline(codeOutline)).toBe(true);
    expect(isAllowedDeterministicInteractiveOutline(simulationOutline)).toBe(true);
  });

  it('downgrades flowchart step-flow outlines before widget generation', () => {
    const safe = applyOutlineFallbacks(flowOutline, true);

    expect(safe).toMatchObject({ type: 'slide' });
    expect(safe.widgetType).toBeUndefined();
    expect(safe.widgetOutline).toBeUndefined();
  });

  it('builds a code scene from mocked generated content without normalizing it to a slide', async () => {
    const aiCall: AICallFn = async () => codeHtml;
    const content = await generateSceneContent(codeOutline, aiCall, {
      languageDirective: 'Teach in English.',
    });
    const scene = buildCompleteScene(
      codeOutline,
      content as GeneratedInteractiveContent,
      [],
      'stage',
    );

    expect(content).toMatchObject({ widgetType: 'code' });
    expect((content as GeneratedInteractiveContent).widgetConfig).toMatchObject({
      type: 'code',
      language: 'javascript',
    });
    expect(scene).toMatchObject({
      type: 'interactive',
      content: { type: 'interactive', widgetType: 'code' },
    });
  });

  it('builds a simulation scene from mocked generated content without normalizing it to a slide', async () => {
    const aiCall: AICallFn = async () => simulationHtml;
    const scene = await buildSceneFromOutline(
      simulationOutline,
      aiCall,
      'stage',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'Teach in English.',
    );

    expect(scene).toMatchObject({
      type: 'interactive',
      content: {
        type: 'interactive',
        widgetType: 'simulation',
        widgetConfig: { type: 'simulation' },
      },
    });
  });
});
