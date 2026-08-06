import { describe, expect, it } from 'vitest';
import type { Scene } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';
import {
  classifyInteractiveOutline,
  classifySceneInteractiveCapabilities,
  isAllowedDeterministicInteractiveOutline,
  isAllowedDeterministicInteractiveScene,
  isDeterministicCodeInteractive,
} from '@/lib/interactive/capabilities';
import { isSceneEnabled } from '@/lib/config/feature-flags';
import { compileVideoTimeline, emitHyperframes } from '@/lib/video-export';
import { NO_ASSETS, NO_PROBE, speech } from '../video-export/helpers';

const parallelSumCodeHtml = `<!doctype html>
<html>
<body>
  <textarea id="code-input">const values = [1,2,3,4];</textarea>
  <button id="run-btn" type="button">Run</button>
  <button id="reset-btn" type="button">Reset</button>
  <pre id="output"></pre>
  <script type="application/json" id="widget-config">{
    "type": "code",
    "language": "javascript",
    "description": "Editable browser-local parallel sum exercise",
    "starterCode": "const values = [1,2,3,4];",
    "testCases": [
      { "id": "sum", "input": "[1,2,3,4]", "expected": "10", "description": "Sum fixture" }
    ],
    "hints": ["Split the work into chunks", "Reduce partial sums"],
    "solution": "const values = [1,2,3,4]; values.reduce((a,b)=>a+b,0);"
  }</script>
  <script>
    const starterCode = "const values = [1,2,3,4];";
    function deterministicParallelSum(values, threads) {
      const buckets = Array.from({ length: threads }, () => 0);
      values.forEach((value, index) => { buckets[index % threads] += value; });
      return { partials: buckets, total: buckets.reduce((a, b) => a + b, 0) };
    }
    function runCode() {
      const result = deterministicParallelSum([1, 2, 3, 4], 2);
      document.getElementById('output').textContent = 'partials=' + result.partials.join(',') + '; total=' + result.total;
    }
    function resetCode() {
      document.getElementById('code-input').value = starterCode;
      document.getElementById('output').textContent = '';
    }
    document.getElementById('run-btn').addEventListener('click', runCode);
    document.getElementById('reset-btn').addEventListener('click', resetCode);
  </script>
</body>
</html>`;

const workloadSimulationHtml = `<!doctype html>
<html>
<body>
  <label for="threads-slider">Threads</label>
  <input id="threads-slider" data-var="threads" type="range" min="1" max="8" value="4" />
  <label for="workload-slider">Workload</label>
  <input id="workload-slider" data-var="workload" type="range" min="8" max="64" value="32" />
  <select id="schedule-select" data-var="schedule"><option>static</option><option>dynamic</option></select>
  <button id="reset-btn" type="button">Reset</button>
  <svg id="worker-allocation" role="img"></svg>
  <output id="imbalance-output">0</output>
  <script type="application/json" id="widget-config">{
    "type": "simulation",
    "concept": "parallel_workload_distribution",
    "description": "Deterministic workload distribution",
    "variables": [
      { "name": "threads", "label": "Threads", "min": 1, "max": 8, "default": 4, "step": 1 },
      { "name": "workload", "label": "Workload", "min": 8, "max": 64, "default": 32, "step": 8 }
    ]
  }</script>
  <script>
    function allocation(workload, threads) {
      return Array.from({ length: threads }, (_, index) => Math.floor(workload / threads) + (index < workload % threads ? 1 : 0));
    }
    function updateSimulation() {
      const values = allocation(32, 4);
      document.getElementById('imbalance-output').value = String(Math.max(...values) - Math.min(...values));
    }
    document.getElementById('threads-slider').addEventListener('input', updateSimulation);
    document.getElementById('workload-slider').addEventListener('input', updateSimulation);
    document.getElementById('reset-btn').addEventListener('click', updateSimulation);
  </script>
</body>
</html>`;

function staticCodingSlide(): Scene {
  return {
    id: 'static-coding',
    stageId: 'stage',
    title: 'Coding Exercise: Parallel Sum',
    order: 1,
    type: 'slide',
    content: {
      type: 'slide',
      canvas: {
        id: 'slide',
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme: { backgroundColor: '#fff', themeColors: [], fontColor: '#111', fontName: 'Arial' },
        elements: [],
      },
    },
    actions: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function codeScene(): Scene {
  return {
    id: 'code-scene',
    stageId: 'stage',
    title: 'Coding Exercise: Parallel Sum',
    order: 2,
    type: 'interactive',
    content: {
      type: 'interactive',
      url: '',
      html: parallelSumCodeHtml,
      widgetType: 'code',
      widgetConfig: {
        type: 'code',
        language: 'javascript',
        description: 'Editable browser-local parallel sum exercise',
        starterCode: 'const values = [1,2,3,4];',
        testCases: [{ id: 'sum', input: '[1,2,3,4]', expected: '10' }],
        hints: ['Split the work into chunks'],
        solution: 'const values = [1,2,3,4]; values.reduce((a,b)=>a+b,0);',
      },
    },
    actions: [speech('narration', 'Try the deterministic parallel sum fixture.')],
    createdAt: 1,
    updatedAt: 1,
  } as Scene;
}

function simulationScene(): Scene {
  return {
    id: 'simulation-scene',
    stageId: 'stage',
    title: 'Parallel workload distribution',
    order: 3,
    type: 'interactive',
    content: {
      type: 'interactive',
      url: '',
      html: workloadSimulationHtml,
      widgetType: 'simulation',
      widgetConfig: {
        type: 'simulation',
        concept: 'parallel_workload_distribution',
        description: 'Deterministic workload distribution',
        variables: [
          { name: 'threads', label: 'Threads', min: 1, max: 8, default: 4, step: 1 },
          { name: 'workload', label: 'Workload', min: 8, max: 64, default: 32, step: 8 },
        ],
      },
    },
    actions: [speech('narration', 'Adjust the local deterministic simulation controls.')],
    createdAt: 1,
    updatedAt: 1,
  } as Scene;
}

describe('deterministic interactive capabilities', () => {
  it('does not treat a static slide titled Coding Exercise as a code interactive', () => {
    const scene = staticCodingSlide();

    expect(isDeterministicCodeInteractive(scene)).toBe(false);
    expect(classifySceneInteractiveCapabilities(scene)).toMatchObject({
      deterministicLocal: false,
      supportsLearnerControls: false,
      category: 'other',
    });
  });

  it('allows actual code and simulation contracts without enabling broad interactive scenes', () => {
    expect(isAllowedDeterministicInteractiveScene(codeScene())).toBe(true);
    expect(isAllowedDeterministicInteractiveScene(simulationScene())).toBe(true);
    expect(isSceneEnabled(codeScene())).toBe(true);
    expect(isSceneEnabled(simulationScene())).toBe(true);
  });

  it('classifies deterministic code by contract, controls, and runtime-provider absence', () => {
    const capabilities = classifySceneInteractiveCapabilities(codeScene());

    expect(capabilities).toMatchObject({
      deterministicLocal: true,
      supportsLearnerControls: true,
      requiresRuntimeAi: false,
      requiresDiscussion: false,
      usesStepFlow: false,
      category: 'code',
    });
    expect(parallelSumCodeHtml).toContain('id="run-btn"');
    expect(parallelSumCodeHtml).toContain('id="reset-btn"');
    expect(parallelSumCodeHtml).toContain('id="code-input"');
    expect(parallelSumCodeHtml).not.toMatch(/\/api\/(?:chat|generate|agent|pbl)/i);
  });

  it('classifies deterministic simulations with learner controls and no provider dependency', () => {
    const capabilities = classifySceneInteractiveCapabilities(simulationScene());

    expect(capabilities).toMatchObject({
      deterministicLocal: true,
      supportsLearnerControls: true,
      requiresRuntimeAi: false,
      requiresDiscussion: false,
      usesStepFlow: false,
      category: 'simulation',
    });
    expect(workloadSimulationHtml).toContain('id="threads-slider"');
    expect(workloadSimulationHtml).toContain('id="workload-slider"');
    expect(workloadSimulationHtml).toContain('id="reset-btn"');
    expect(workloadSimulationHtml).not.toMatch(/\/api\/(?:chat|generate|agent|pbl)/i);
  });

  it('blocks flowchart step-flow outlines even when they are interactive records', () => {
    const outline: SceneOutline = {
      id: 'flow',
      type: 'interactive',
      title: 'Next/Next flowchart',
      description: 'A step flow.',
      keyPoints: ['Next', 'Next'],
      order: 1,
      widgetType: 'diagram',
      widgetOutline: { diagramType: 'flowchart', concept: 'broken flow' },
    };

    expect(classifyInteractiveOutline(outline)).toMatchObject({
      deterministicLocal: false,
      usesStepFlow: true,
      supportsLearnerControls: false,
      category: 'flow',
    });
    expect(isAllowedDeterministicInteractiveOutline(outline)).toBe(false);
  });

  it('exports deterministic interactives as stable placeholders without learner controls', () => {
    const ir = compileVideoTimeline(
      {
        stage: { id: 'stage', name: 'Interactive Export' },
        scenes: [codeScene(), simulationScene()],
      },
      { timing: NO_PROBE, assets: NO_ASSETS },
    );
    const html = emitHyperframes(ir).files.find((file) => file.path === 'index.html')!.content;

    expect(ir.scenes).toHaveLength(2);
    expect(ir.scenes.every((scene) => scene.supported === false)).toBe(true);
    expect(ir.scenes.every((scene) => scene.base.kind === 'placeholder')).toBe(true);
    expect(html).not.toContain('id="run-btn"');
    expect(html).not.toContain('id="reset-btn"');
    expect(html).not.toContain('id="threads-slider"');
  });
});
