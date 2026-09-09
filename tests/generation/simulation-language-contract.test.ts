import { describe, expect, test } from 'vitest';

import {
  generateSceneContent,
  generateWidgetContent,
  validateSimulationOutputLanguage,
} from '@/lib/generation/scene-generator';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import type { SceneOutline } from '@/lib/types/generation';

const baseOutline: SceneOutline = {
  id: 'simulation-scene',
  type: 'interactive',
  title: 'BST Traversal Simulator',
  description: 'Explore binary search tree traversal.',
  keyPoints: ['Insert nodes', 'Choose traversal order', 'Watch node visits'],
  order: 1,
  widgetType: 'simulation',
  widgetOutline: {
    concept: 'bst_traversal',
    keyVariables: ['traversal'],
  },
};

describe('simulation output language contract', () => {
  test('accepts English simulations with only English UI without repair', async () => {
    const calls: Array<{ system: string; user: string }> = [];
    const aiCall: AICallFn = async (system, user) => {
      calls.push({ system, user });
      return englishSimulationHtml();
    };

    const content = await generateWidgetContent(baseOutline, aiCall, 'Teach in English.', {
      targetLanguage: 'en-US',
    });

    expect(content?.html).toContain('Continue');
    expect(content?.html).toContain('Reset');
    expect(calls).toHaveLength(1);
  });

  test('detects Chinese static button text in an English simulation', () => {
    const validation = validateSimulationOutputLanguage(
      englishSimulationHtml({
        controls: '<button>继续</button>',
      }),
      { languageDirective: 'Teach in English.' },
    );

    expect(validation.enforceEnglishCjkGuard).toBe(true);
    expect(validation.hasUnexpectedCjk).toBe(true);
    expect(validation.suspiciousSpans).toContain('继续');
  });

  test('detects Chinese labels inside JavaScript UI assignments', () => {
    const validation = validateSimulationOutputLanguage(
      englishSimulationHtml({
        script: 'document.getElementById("status").textContent = "已暂停";',
      }),
      { languageDirective: 'Deliver the entire course in English.' },
    );

    expect(validation.hasUnexpectedCjk).toBe(true);
    expect(validation.suspiciousSpans).toContain('已暂停');
  });

  test('detects mixed-language simulation labels', () => {
    const validation = validateSimulationOutputLanguage(
      englishSimulationHtml({
        controls: '<button>Continue</button><button>重置</button><span>Paused</span>',
      }),
      { targetLanguage: 'en-US' },
    );

    expect(validation.hasUnexpectedCjk).toBe(true);
    expect(validation.suspiciousSpans).toContain('重置');
  });

  test('does not treat mathematical Unicode as a language violation', () => {
    const validation = validateSimulationOutputLanguage(
      englishSimulationHtml({
        controls: '<p>π θ λ Σ √ ≤ ≥ → O(n²)</p>',
        script: 'ctx.fillText("Σ ≤ √", 20, 20);',
      }),
      { languageDirective: 'Teach in English.' },
    );

    expect(validation.hasUnexpectedCjk).toBe(false);
  });

  test('does not treat normal HTML, CSS, or JavaScript syntax as a language violation', () => {
    const validation = validateSimulationOutputLanguage(
      englishSimulationHtml({
        script: `
          const labels = { reset: "Reset", pause: "Pause" };
          document.querySelector("#reset-btn").textContent = labels.reset;
          canvas.getContext("2d").fillText("Depth: " + depth, 10, 10);
        `,
      }),
      { targetLanguage: 'en-US' },
    );

    expect(validation.hasUnexpectedCjk).toBe(false);
  });

  test('repairs the observed mixed English and Chinese BST labels before acceptance', async () => {
    const calls: string[] = [];
    const aiCall: AICallFn = async (_system, user) => {
      calls.push(user);
      return calls.length === 1
        ? englishSimulationHtml({
            controls: [
              '<button>Presets</button>',
              '<button>Pre-order</button>',
              '<button>In-order</button>',
              '<button>Post-order</button>',
              '<button>Quick Jump</button>',
              '<button>继续</button>',
              '<button>重置</button>',
              '<span id="status">已暂停</span>',
            ].join(''),
            script: 'document.getElementById("status").textContent = "已暂停";',
          })
        : englishSimulationHtml({
            controls: [
              '<button>Presets</button>',
              '<button>Pre-order</button>',
              '<button>In-order</button>',
              '<button>Post-order</button>',
              '<button>Quick Jump</button>',
              '<button>Continue</button>',
              '<button>Reset</button>',
              '<span id="status">Paused</span>',
            ].join(''),
            script: 'document.getElementById("status").textContent = "Paused";',
          });
    };

    const content = await generateWidgetContent(baseOutline, aiCall, 'Teach in English.', {
      targetLanguage: 'en-US',
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('translating only user-facing labels');
    expect(content?.html).toContain('Continue');
    expect(content?.html).toContain('Reset');
    expect(content?.html).toContain('Paused');
    expect(content?.html).not.toMatch(/[\p{Script=Han}]/u);
  });

  test('does not silently accept a repair that still contains CJK labels', async () => {
    const aiCall = sequenceAiCall([
      englishSimulationHtml({ controls: '<button>继续</button>' }),
      englishSimulationHtml({ controls: '<button>继续</button>' }),
    ]);

    const content = await generateWidgetContent(baseOutline, aiCall, 'Teach in English.');

    expect(content).toBeNull();
  });

  test('rejects a language repair that produces malformed HTML', async () => {
    const aiCall = sequenceAiCall([
      englishSimulationHtml({ controls: '<button>继续</button>' }),
      '<!DOCTYPE html><html><body><main>Truncated',
    ]);

    const content = await generateWidgetContent(baseOutline, aiCall, 'Teach in English.');

    expect(content).toBeNull();
  });

  test('rejects a language repair that changes the widget type', async () => {
    const aiCall = sequenceAiCall([
      englishSimulationHtml({ controls: '<button>继续</button>' }),
      englishSimulationHtml({
        widgetType: 'diagram',
        controls: '<button>Continue</button>',
      }),
    ]);

    const content = await generateWidgetContent(baseOutline, aiCall, 'Teach in English.');

    expect(content).toBeNull();
  });

  test('threads requested English language into the actual simulation prompt path', async () => {
    let capturedSystem = '';
    let capturedUser = '';
    const aiCall: AICallFn = async (system, user) => {
      capturedSystem = system;
      capturedUser = user;
      return englishSimulationHtml();
    };

    await generateSceneContent(baseOutline, aiCall, {
      languageDirective: 'Deliver the entire course in English.',
      targetLanguage: 'en-US',
    });

    expect(capturedSystem).toContain('The requested output language is: **English (en-US)**');
    expect(capturedSystem).toContain('JavaScript string');
    expect(capturedUser).toContain('Requested output language: English (en-US)');
    expect(capturedUser).toContain('Deliver the entire course in English.');
  });

  test('does not hardcode English-only rejection for explicitly Chinese simulations', async () => {
    const chineseHtml = englishSimulationHtml({
      controls: '<button>继续</button><button>重置</button><span>已暂停</span>',
      script: 'document.getElementById("status").textContent = "已暂停";',
    });

    const validation = validateSimulationOutputLanguage(chineseHtml, {
      languageDirective: '用中文授课。',
      targetLanguage: 'zh-CN',
    });
    const content = await generateWidgetContent(
      baseOutline,
      async () => chineseHtml,
      '用中文授课。',
      { targetLanguage: 'zh-CN' },
    );

    expect(validation.enforceEnglishCjkGuard).toBe(false);
    expect(validation.hasUnexpectedCjk).toBe(false);
    expect(content).not.toBeNull();
  });
});

function sequenceAiCall(responses: string[]): AICallFn {
  let index = 0;
  return async () => {
    const response = responses[index] ?? responses[responses.length - 1];
    index += 1;
    return response;
  };
}

function englishSimulationHtml(
  options: {
    controls?: string;
    script?: string;
    widgetType?: string;
  } = {},
): string {
  const controls =
    options.controls ??
    '<button>Continue</button><button>Reset</button><span id="status">Paused</span>';
  const script = options.script ?? 'document.getElementById("status").textContent = "Paused";';
  const widgetType = options.widgetType ?? 'simulation';

  return `<!DOCTYPE html>
<html lang="en">
  <head><title>BST Traversal Simulator</title></head>
  <body>
    <script type="application/json" id="widget-config">
      {"type":"${widgetType}","concept":"bst_traversal","description":"BST Traversal Simulator","variables":[]}
    </script>
    <main>
      <h1>BST Traversal Simulator</h1>
      ${controls}
      <canvas id="canvas"></canvas>
    </main>
    <script>
      ${script}
      window.addEventListener('message', function(event) {
        if (event.data.type === 'SET_WIDGET_STATE') {
          document.body.dataset.state = 'updated';
        }
      });
    </script>
  </body>
</html>`;
}
