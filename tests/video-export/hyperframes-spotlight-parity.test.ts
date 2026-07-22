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
): PPTElement {
  const lines = Array.isArray(content) ? content : [content];
  const html = lines
    .map((line, index) => {
      const tag = index === 0 && lines.length > 1 ? 'strong' : 'span';
      return `<p><${tag} style="font-size:${fontSize}px">${line}</${tag}></p>`;
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
