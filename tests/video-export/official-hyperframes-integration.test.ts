import { describe, expect, it, vi } from 'vitest';
import { compileVideoTimeline, emitHyperframes } from '@/lib/video-export';
import type { CompilerScene } from '@/lib/video-export';
import { el, slide, speech, spotlight, stubAssets, stubProbe } from './helpers';

describe('official Hyperframes video export integration', () => {
  it('preserves custom narration order and precise spotlight targets in the exported timeline', () => {
    const scene = slide(
      'collectives',
      [
        spotlight('spot-allreduce', 'allreduce-text'),
        speech('s-allreduce', 'Allreduce narration.', { audioId: 'aud-allreduce' }),
        spotlight('spot-bcast', 'bcast-text'),
        speech('s-bcast', 'Bcast narration.', { audioId: 'aud-bcast' }),
        spotlight('spot-reduce', 'reduce-text'),
        speech('s-reduce', 'Reduce narration.', { audioId: 'aud-reduce' }),
      ],
      {
        title: 'Collective Operations',
        elements: [
          el('allreduce-text', { left: 90, top: 110, width: 240, height: 80 }),
          el('bcast-text', { left: 380, top: 110, width: 240, height: 80 }),
          el('reduce-text', { left: 670, top: 110, width: 240, height: 80 }),
          el('allreduce-card', { left: 60, top: 90, width: 300, height: 140 }),
          el('bcast-card', { left: 350, top: 90, width: 300, height: 140 }),
          el('reduce-card', { left: 640, top: 90, width: 300, height: 140 }),
        ],
      },
    );
    const ir = compileVideoTimeline(
      { stage: { id: 'stage', name: 'MPI' }, scenes: [scene] },
      {
        timing: stubProbe({
          's-allreduce': 2000,
          's-bcast': 2000,
          's-reduce': 2000,
        }),
        assets: stubAssets({
          's-allreduce': { id: 'aud-allreduce', present: true, format: 'mp3' },
          's-bcast': { id: 'aud-bcast', present: true, format: 'mp3' },
          's-reduce': { id: 'aud-reduce', present: true, format: 'mp3' },
        }),
      },
    );

    expect(ir.scenes[0].effects.map((effect) => [effect.actionId, effect.elementId])).toEqual([
      ['spot-allreduce', 'allreduce-text'],
      ['spot-bcast', 'bcast-text'],
      ['spot-reduce', 'reduce-text'],
    ]);
    expect(ir.scenes[0].effects.map((effect) => effect.elementId)).not.toContain('allreduce-card');
    expect(ir.scenes[0].narration.map((item) => [item.actionId, item.text])).toEqual([
      ['s-allreduce', 'Allreduce narration.'],
      ['s-bcast', 'Bcast narration.'],
      ['s-reduce', 'Reduce narration.'],
    ]);
    expect(ir.subtitles.map((cue) => cue.text)).toEqual([
      'Allreduce narration.',
      'Bcast narration.',
      'Reduce narration.',
    ]);
  });

  it('keeps export pure: no AI, narration generation, or TTS endpoint is called', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const scene = slide('pure-export', [speech('s1', 'Saved narration.', { audioId: 'aud-1' })]);

    const ir = compileVideoTimeline(
      { stage: { id: 'stage', name: 'Pure Export' }, scenes: [scene] },
      {
        timing: stubProbe({ s1: 1000 }),
        assets: stubAssets({ s1: { id: 'aud-1', present: true, format: 'mp3' } }),
      },
    );
    emitHyperframes(ir);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('uses a deterministic placeholder for interactive scenes during video export', () => {
    const interactiveScene = {
      id: 'sim-1',
      stageId: 'stage',
      title: 'Deterministic Simulation',
      order: 0,
      type: 'interactive',
      content: {
        type: 'interactive',
        url: 'about:blank',
        html: '<button id="run">Run</button>',
        widgetType: 'simulation',
      },
      actions: [speech('sim-speech', 'Explore the default state.')],
    } as unknown as CompilerScene;

    const ir = compileVideoTimeline(
      { stage: { id: 'stage', name: 'Interactive Export' }, scenes: [interactiveScene] },
      { timing: stubProbe({ 'sim-speech': 1200 }), assets: stubAssets() },
    );
    const html = emitHyperframes(ir).files.find((file) => file.path === 'index.html')!.content;

    expect(ir.scenes[0]).toMatchObject({
      type: 'interactive',
      supported: false,
      base: { kind: 'placeholder' },
    });
    expect(ir.scenes[0].markers[0]).toMatchObject({ kind: 'unsupported-scene' });
    expect(html).not.toContain('id="run"');
  });
});
