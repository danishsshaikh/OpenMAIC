import { describe, expect, it } from 'vitest';
import { getStaticSpotlightFocusRect } from '../../packages/@openmaic/renderer/src/effects/spotlightGeometry';
import { emitEffect } from '@/lib/video-export/emit-hyperframes/effects';
import type { EffectSegment } from '@/lib/video-export/ir';

describe('static spotlight geometry', () => {
  it('snaps the static focus rect to whole output pixels', () => {
    const rect = getStaticSpotlightFocusRect(
      { x: 37.125, y: 31.333, w: 25.25, h: 26.667 },
      { width: 400, height: 225 },
    );

    expect(rect).not.toBeNull();
    expect(((rect!.x / 100) * 400) % 1).toBe(0);
    expect(((rect!.y / 100) * 225) % 1).toBe(0);
    expect((((rect!.x + rect!.w) / 100) * 400) % 1).toBe(0);
    expect((((rect!.y + rect!.h) / 100) * 225) % 1).toBe(0);
  });

  it('emits diagnostic target/focus data for MP4 spotlight overlays', () => {
    const segment: EffectSegment = {
      type: 'spotlight',
      actionId: 'spot-1',
      elementId: 'card-1',
      startMs: 0,
      durationMs: 1200,
      params: { dimness: 0.7 },
      geometry: {
        x: 37.125,
        y: 31.333,
        w: 25.25,
        h: 26.667,
        centerX: 49.75,
        centerY: 44.6665,
      },
      degraded: false,
    };

    const emitted = emitEffect(segment, 'fx-spot', { width: 400, height: 225 });

    expect(emitted.html).toContain('data-openmaic-spotlight-target="card-1"');
    expect(emitted.html).toContain('data-openmaic-spotlight-focus=');
    expect(emitted.html).toContain('<mask id="fx-spot-mask">');
    expect(emitted.html).not.toContain('data-openmaic-static-spotlight-dim');
  });
});
