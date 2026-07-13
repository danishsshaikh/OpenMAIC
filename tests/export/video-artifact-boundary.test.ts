import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { buildVideoFrameExportPlan } from '@/lib/export/video-frame-planner';

const repoRoot = resolve(__dirname, '../..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf-8');
}

describe('video export artifact boundary', () => {
  it('does not expose the internal video collector from the normal export menu', () => {
    const source = readRepoFile('components/stage/header-controls.tsx');

    expect(source).not.toContain('useExportVideoFrames');
    expect(source).not.toContain('exportVideoFrames');
    expect(source).not.toContain('export.videoFrames');
    expect(source).not.toContain('Export video artifact');

    expect(source).toContain('exportPPTX()');
    expect(source).toContain('exportResourcePack()');
    expect(source).toContain('exportClassroomZip()');
    expect(source).toContain("t('export.pptx')");
    expect(source).toContain("t('export.resourcePack')");
    expect(source).toContain("t('export.classroomZip')");
  });

  it('removes obsolete user-facing video artifact locale copy', () => {
    const locale = JSON.parse(readRepoFile('lib/i18n/locales/en-US.json')) as {
      export?: Record<string, unknown>;
    };

    expect(locale.export).toBeTruthy();
    expect(locale.export?.videoFrames).toBeUndefined();
    expect(locale.export?.pptx).toBe('Export PPTX');
    expect(locale.export?.resourcePack).toBe('Export Resource Pack');
    expect(locale.export?.classroomZip).toBe('Export Classroom ZIP');
  });

  it('keeps the preserved artifact internal and non-playable', () => {
    const plan = buildVideoFrameExportPlan({
      stageTitle: 'Internal',
      exportedAt: '2026-07-04T00:00:00.000Z',
      scenes: [
        {
          id: 'interactive',
          stageId: 'stage-1',
          title: 'Widget',
          order: 1,
          type: 'interactive',
          content: { type: 'interactive', url: 'https://example.com' },
          actions: [],
        },
      ],
    });

    expect(plan.manifest.schema).toBe('openmaic.internalVideoCollectorArtifact');
    expect(plan.manifest.exportType).toBe('internal-video-collector-artifact');
    expect(plan.manifest).not.toHaveProperty('renderTarget');
    expect(JSON.stringify(plan.manifest)).not.toContain('outputFormats');
    expect(JSON.stringify(plan.manifest)).not.toContain('video-composition-debug-artifact');
    expect(plan.frames[0]).toMatchObject({
      renderMode: 'placeholder',
      supportStatus: 'placeholder',
      unsupported: {
        family: 'interactive',
      },
    });
  });
});
