import { describe, expect, it } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { compileVideoTimeline, emitHyperframes } from '@/lib/video-export';
import type { EffectSegment } from '@/lib/video-export/ir';
import { getStaticSpotlightFocusRect } from '../../packages/@openmaic/renderer/src/effects/spotlightGeometry';
import { NO_ASSETS, spotlight, speech, stubProbe } from './helpers';

const VIEWPORT_WIDTH = 1000;
const VIEWPORT_HEIGHT = 562.5;

describe('Hyperframes spotlight geometry parity', () => {
  it('measures the C Programming card text targets without blank lower area', () => {
    const ir = compileFixture();
    const effects = effectMap(ir.scenes[0].effects);
    const left = effects.get('spot-structure')!.geometry!;
    const right = effects.get('spot-data-types')!.geometry!;
    const title = effects.get('spot-title')!.geometry!;
    const subtitle = effects.get('spot-subtitle')!.geometry!;

    expect(effects.get('spot-structure')!.elementId).toBe('text_structure_compilation_list');
    expect(effects.get('spot-data-types')!.elementId).toBe('text_data_types_list');
    expect(effects.get('spot-title')!.elementId).toBe('text_title');
    expect(effects.get('spot-subtitle')!.elementId).toBe('text_subtitle');

    expect(left.x).toBeGreaterThan(8);
    expect(left.x + left.w).toBeLessThan(50);
    expect(left.y + left.h).toBeLessThan(67);
    expect(left.h).toBeLessThan(32);

    expect(right.x).toBeGreaterThan(54);
    expect(right.x + right.w).toBeLessThan(92);
    expect(right.y + right.h).toBeLessThan(67);
    expect(right.h).toBeLessThan(30);

    expect(title.y).toBeLessThan(percentY(58));
    expect(title.y + title.h).toBeGreaterThan(percentY(102));
    expect(title.w).toBeLessThan(70);
    expect(title.x + title.w).toBeLessThan(90);
    expect(title.y + title.h).toBeLessThan(subtitle.y);
    expect(subtitle.y).toBeGreaterThan(title.y + title.h);
  });

  it('keeps title and subtitle spotlight focus rectangles separate', () => {
    const ir = compileFixture();
    const effects = effectMap(ir.scenes[0].effects);
    const title = effects.get('spot-title')!.geometry!;
    const subtitle = effects.get('spot-subtitle')!.geometry!;
    const titleFocus = getStaticSpotlightFocusRect(title, { width: 1920, height: 1080 })!;
    const subtitleFocus = getStaticSpotlightFocusRect(subtitle, { width: 1920, height: 1080 })!;

    expect(titleFocus.y + titleFocus.h).toBeLessThan(subtitle.y);
    expect(subtitleFocus.y).toBeGreaterThan(title.y + title.h);
    expect(titleFocus.w).toBeLessThan(72);
    expect(subtitleFocus.w).toBeLessThan(68);
  });

  it('scales output pixel geometry proportionally across official resolutions', () => {
    const ir = compileFixture();
    const effect = effectMap(ir.scenes[0].effects).get('spot-data-types')!;
    const focus = getStaticSpotlightFocusRect(effect.geometry!, { width: 1920, height: 1080 })!;
    const halfFocus = getStaticSpotlightFocusRect(effect.geometry!, { width: 1280, height: 720 })!;

    expect(Math.abs(focus.x - halfFocus.x)).toBeLessThan(0.08);
    expect(Math.abs(focus.y - halfFocus.y)).toBeLessThan(0.08);
    expect(Math.abs(focus.w - halfFocus.w)).toBeLessThan(0.08);
    expect(Math.abs(focus.h - halfFocus.h)).toBeLessThan(0.08);

    const output1080 = emitHyperframes(ir, { width: 1920, height: 1080 }).files.find(
      (file) => file.path === 'index.html',
    )!.content;
    const output720 = emitHyperframes(ir, { width: 1280, height: 720 }).files.find(
      (file) => file.path === 'index.html',
    )!.content;

    expect(output1080).toContain('data-openmaic-spotlight-target="text_data_types_list"');
    expect(output720).toContain('data-openmaic-spotlight-target="text_data_types_list"');
    expect(output1080).toContain('data-openmaic-spotlight-focus=');
    expect(output720).toContain('data-openmaic-spotlight-focus=');
  });

  it('applies the same slide-fit transform as live playback before emitting geometry', () => {
    const scene = {
      id: 'overflow-scene',
      stageId: 'stage',
      title: 'Overflow',
      order: 0,
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          viewportSize: VIEWPORT_WIDTH,
          viewportRatio: VIEWPORT_HEIGHT / VIEWPORT_WIDTH,
          elements: [
            textElement('overflow-title', 4, 4, 780, 64, 'Overflow Title', 36, 1.1),
            textElement('overflow-target', 880, 485, 180, 96, 'Edge Target', 26, 1.15),
          ],
        },
      },
      actions: [spotlight('spot-overflow', 'overflow-target'), speech('speech-overflow', 'Edge')],
    };
    const ir = compileVideoTimeline(
      { stage: { id: 'stage', name: 'Overflow' }, scenes: [scene as never] },
      { timing: stubProbe({ 'speech-overflow': 1000 }), assets: NO_ASSETS },
    );
    const geometry = ir.scenes[0].effects[0].geometry!;

    expect(geometry.x).toBeLessThan(percentX(880));
    expect(geometry.y).toBeLessThan(percentY(485));
    expect(geometry.x + geometry.w).toBeLessThanOrEqual(96);
    expect(geometry.y + geometry.h).toBeLessThanOrEqual(94);
  });

  it('centers multiline title and subtitle spotlight bounds inside wide text boxes', () => {
    const ir = compileHpcJobSubmissionFixture();
    const effects = effectMap(ir.scenes[0].effects);
    const title = effects.get('spot-hpc-title')!.geometry!;
    const subtitle = effects.get('spot-hpc-subtitle')!.geometry!;
    const firstCard = effects.get('spot-hpc-write')!.geometry!;
    const secondCard = effects.get('spot-hpc-params')!.geometry!;
    const thirdCard = effects.get('spot-hpc-submit')!.geometry!;

    expect(title.x).toBeGreaterThan(20);
    expect(title.centerX).toBeCloseTo(50, 0);
    expect(title.y).toBeLessThan(percentY(132));
    expect(title.y + title.h).toBeGreaterThan(percentY(195));
    expect(title.y + title.h).toBeLessThan(subtitle.y);

    expect(subtitle.x).toBeGreaterThan(27);
    expect(subtitle.centerX).toBeCloseTo(50, 0);
    expect(subtitle.y).toBeGreaterThan(title.y + title.h);
    expect(subtitle.w).toBeLessThan(46);

    expect(firstCard.centerX).toBeCloseTo(17.5, 0);
    expect(secondCard.centerX).toBeCloseTo(48, 0);
    expect(thirdCard.centerX).toBeCloseTo(79, 0);
    expect(firstCard.x).toBeGreaterThan(8);
    expect(secondCard.x).toBeGreaterThan(38);
    expect(thirdCard.x).toBeGreaterThan(70);
  });

  it.each([
    ['left' as const, 10, undefined],
    ['center' as const, undefined, 50],
    ['right' as const, undefined, undefined],
  ])(
    'aligns %s text spotlight bounds within the element box',
    (align, expectedX, expectedCenterX) => {
      const geometry = compileSingleTextSpotlight(
        textElement(`align-${align}`, 100, 120, 800, 72, 'Workflow Overview', 34, 1.1, { align }),
      );

      if (typeof expectedX === 'number') {
        expect(geometry.x).toBeCloseTo(expectedX, 0);
      }
      if (typeof expectedCenterX === 'number') {
        expect(geometry.centerX).toBeCloseTo(expectedCenterX, 0);
      }
      if (align === 'right') {
        expect(geometry.x + geometry.w).toBeCloseTo(90, 0);
      }
    },
  );

  it('keeps centered wrapped text within the source element while preserving vertical alignment', () => {
    const geometry = compileSingleTextSpotlight(
      textElement(
        'centered-wrapped',
        150,
        90,
        500,
        240,
        'Introduction to high-performance computing workflow overview and runtime configuration',
        30,
        1.15,
        { align: 'center', vAlign: 'middle' },
      ),
    );

    expect(geometry.x).toBeGreaterThanOrEqual(percentX(150));
    expect(geometry.x + geometry.w).toBeLessThanOrEqual(percentX(650));
    expect(geometry.centerX).toBeCloseTo(percentX(400), 0);
    expect(geometry.y).toBeGreaterThan(percentY(90));
    expect(geometry.y + geometry.h).toBeLessThan(percentY(280));
  });
});

function compileFixture() {
  const scene = {
    id: 'c-programming',
    stageId: 'stage',
    title: 'C Programming Fundamentals',
    order: 0,
    type: 'slide',
    content: {
      type: 'slide',
      canvas: {
        viewportSize: VIEWPORT_WIDTH,
        viewportRatio: VIEWPORT_HEIGHT / VIEWPORT_WIDTH,
        elements: [
          textElement('text_title', 150, 48, 720, 64, 'C Programming Fundamentals', 40, 1.1),
          textElement(
            'text_subtitle',
            160,
            126,
            680,
            44,
            'Introduction to High-Performance Computing',
            26,
            1.1,
          ),
          shapeElement('left_card', 72, 188, 420, 280),
          shapeElement('right_card', 535, 188, 420, 280),
          textElement(
            'text_structure_compilation_list',
            108,
            205,
            350,
            250,
            ['Structure & Compilation', 'Headers (#include)', 'main() Function', 'GCC Compiler'],
            24,
            1.1,
          ),
          textElement(
            'text_data_types_list',
            575,
            205,
            330,
            250,
            ['Data Types', 'Primitives: int, float, char', 'Derived: Arrays, Pointers'],
            24,
            1.1,
          ),
        ],
      },
    },
    actions: [
      spotlight('spot-structure', 'text_structure_compilation_list'),
      speech('speech-structure', 'Structure and compilation.'),
      spotlight('spot-data-types', 'text_data_types_list'),
      speech('speech-data-types', 'Data types.'),
      spotlight('spot-title', 'text_title'),
      speech('speech-title', 'Title.'),
      spotlight('spot-subtitle', 'text_subtitle'),
      speech('speech-subtitle', 'Subtitle.'),
    ],
  };

  return compileVideoTimeline(
    { stage: { id: 'stage', name: 'C Programming Fundamentals' }, scenes: [scene as never] },
    {
      timing: stubProbe({
        'speech-structure': 1000,
        'speech-data-types': 1000,
        'speech-title': 1000,
        'speech-subtitle': 1000,
      }),
      assets: NO_ASSETS,
    },
  );
}

function compileHpcJobSubmissionFixture() {
  const scene = {
    id: 'hpc-job-submission',
    stageId: 'stage',
    title: 'HPC Job Submission Project',
    order: 0,
    type: 'slide',
    content: {
      type: 'slide',
      canvas: {
        viewportSize: VIEWPORT_WIDTH,
        viewportRatio: VIEWPORT_HEIGHT / VIEWPORT_WIDTH,
        elements: [
          textElement('hpc_title', 80, 56, 840, 172, ['HPC Job Submission', 'Project'], 44, 1.1, {
            align: 'center',
            vAlign: 'middle',
          }),
          textElement('hpc_subtitle', 80, 246, 840, 64, 'Workflow Overview', 34, 1.1, {
            align: 'center',
            vAlign: 'middle',
          }),
          shapeElement('hpc_card_write', 58, 335, 230, 170),
          shapeElement('hpc_card_params', 365, 335, 230, 170),
          shapeElement('hpc_card_submit', 675, 335, 230, 170),
          textElement('hpc_write', 90, 395, 170, 64, ['Write script', '#SBATCH'], 27, 1.05, {
            align: 'center',
            vAlign: 'middle',
          }),
          textElement(
            'hpc_params',
            392,
            395,
            176,
            64,
            ['Set params:', 'Time/Partition'],
            27,
            1.05,
            {
              align: 'center',
              vAlign: 'middle',
            },
          ),
          textElement('hpc_submit', 706, 395, 168, 64, ['Submit &', 'Monitor'], 27, 1.05, {
            align: 'center',
            vAlign: 'middle',
          }),
        ],
      },
    },
    actions: [
      spotlight('spot-hpc-title', 'hpc_title'),
      speech('speech-hpc-title', 'HPC Job Submission Project.'),
      spotlight('spot-hpc-subtitle', 'hpc_subtitle'),
      speech('speech-hpc-subtitle', 'Workflow Overview.'),
      spotlight('spot-hpc-write', 'hpc_write'),
      speech('speech-hpc-write', 'Write script.'),
      spotlight('spot-hpc-params', 'hpc_params'),
      speech('speech-hpc-params', 'Set params.'),
      spotlight('spot-hpc-submit', 'hpc_submit'),
      speech('speech-hpc-submit', 'Submit and monitor.'),
    ],
  };

  return compileVideoTimeline(
    { stage: { id: 'stage', name: 'HPC Job Submission Project' }, scenes: [scene as never] },
    {
      timing: stubProbe({
        'speech-hpc-title': 1000,
        'speech-hpc-subtitle': 1000,
        'speech-hpc-write': 1000,
        'speech-hpc-params': 1000,
        'speech-hpc-submit': 1000,
      }),
      assets: NO_ASSETS,
    },
  );
}

function compileSingleTextSpotlight(element: PPTElement) {
  const scene = {
    id: 'single-text',
    stageId: 'stage',
    title: 'Single Text',
    order: 0,
    type: 'slide',
    content: {
      type: 'slide',
      canvas: {
        viewportSize: VIEWPORT_WIDTH,
        viewportRatio: VIEWPORT_HEIGHT / VIEWPORT_WIDTH,
        elements: [element],
      },
    },
    actions: [spotlight('spot-single', element.id), speech('speech-single', 'Single.')],
  };

  return compileVideoTimeline(
    { stage: { id: 'stage', name: 'Single Text' }, scenes: [scene as never] },
    { timing: stubProbe({ 'speech-single': 1000 }), assets: NO_ASSETS },
  ).scenes[0].effects[0].geometry!;
}

function effectMap(effects: readonly EffectSegment[]) {
  return new Map(effects.map((effect) => [effect.actionId, effect]));
}

function textElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  content: string | string[],
  fontSize: number,
  lineHeight: number,
  options: {
    align?: 'left' | 'center' | 'right';
    vAlign?: 'top' | 'middle' | 'bottom';
  } = {},
): PPTElement {
  const lines = Array.isArray(content) ? content : [content];
  const textAlign = options.align ? `text-align:${options.align};` : '';
  const html = lines
    .map((line, index) => {
      const tag = index === 0 && lines.length > 1 ? 'strong' : 'span';
      return `<p style="${textAlign}"><${tag} style="font-size:${fontSize}px">${line}</${tag}></p>`;
    })
    .join('');
  return {
    id,
    type: 'text',
    left,
    top,
    width,
    height,
    rotate: 0,
    content: html,
    defaultFontName: 'Arial',
    defaultColor: '#111111',
    lineHeight,
    paragraphSpace: 4,
    align: options.align,
    vAlign: options.vAlign,
  } as unknown as PPTElement;
}

function shapeElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
): PPTElement {
  return {
    id,
    type: 'shape',
    left,
    top,
    width,
    height,
    rotate: 0,
    viewBox: [width, height],
    path: `M0 0H${width}V${height}H0Z`,
    fixedRatio: false,
    fill: '#eef6ff',
  } as unknown as PPTElement;
}

function percentX(x: number) {
  return (x / VIEWPORT_WIDTH) * 100;
}

function percentY(y: number) {
  return (y / VIEWPORT_HEIGHT) * 100;
}
