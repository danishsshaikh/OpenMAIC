import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('active video export menu wiring', () => {
  it('uses the official VideoExportMenu without duplicate legacy video entries', () => {
    const source = readFileSync('components/stage/header-controls.tsx', 'utf8');

    expect(source).toContain('VideoExportMenu');
    expect(source).not.toContain('useExportVideoFrames');
    expect(source).not.toContain('useExportVideoMp4');
    expect(source).not.toContain('ENABLE_LOCAL_MP4_EXPORT');
    expect(source).not.toContain("t('export.videoFrames.title')");
    expect(source).not.toContain("t('export.videoMp4.title')");
  });
});
