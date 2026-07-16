import { describe, expect, it } from 'vitest';
import {
  advanceLocalMp4ExportProgress,
  computeWeightedPercent,
  createLocalMp4ExportProgress,
  describeLocalMp4ExportProgress,
  estimateRemainingSeconds,
  isLocalMp4ExportStalled,
} from '@/lib/export/mp4/progress';

describe('local MP4 export progress', () => {
  it('keeps progress monotonic within one export attempt', () => {
    let progress = createLocalMp4ExportProgress('job-1', 'Preparing', 0);
    progress = advanceLocalMp4ExportProgress(
      progress,
      { phase: 'rendering', message: 'Rendering', completedUnits: 3, totalUnits: 4 },
      1000,
    );
    const afterRendering = progress.percent ?? 0;

    progress = advanceLocalMp4ExportProgress(
      progress,
      { phase: 'rendering', message: 'Rendering', completedUnits: 1, totalUnits: 4 },
      2000,
    );

    expect(progress.percent).toBe(afterRendering);
  });

  it('resets progress for a new export job', () => {
    const first = advanceLocalMp4ExportProgress(
      createLocalMp4ExportProgress('job-1', 'Preparing', 0),
      { phase: 'uploading', message: 'Uploading', percent: 80 },
      1000,
    );
    const second = createLocalMp4ExportProgress('job-2', 'Preparing', 2000);

    expect(first.percent).toBe(80);
    expect(second.percent).toBe(0);
    expect(second.jobId).toBe('job-2');
  });

  it('handles missing totals and zero completed units without a fake ETA', () => {
    const progress = advanceLocalMp4ExportProgress(
      createLocalMp4ExportProgress('job-1', 'Preparing', 0),
      { phase: 'preparing', message: 'Preparing' },
      1000,
    );

    expect(computeWeightedPercent('rendering', undefined, undefined)).toBe(5);
    expect(estimateRemainingSeconds(progress, 1000)).toBeNull();
    expect(describeLocalMp4ExportProgress(progress, 1000)).toContain('Estimating time remaining');
  });

  it('estimates remaining time from actual elapsed time and measured progress', () => {
    const progress = advanceLocalMp4ExportProgress(
      createLocalMp4ExportProgress('job-1', 'Preparing', 0),
      { phase: 'uploading', message: 'Uploading', percent: 50 },
      10_000,
    );

    expect(estimateRemainingSeconds(progress, 10_000)).toBe(10);
    expect(describeLocalMp4ExportProgress(progress, 10_000)).toContain('About 10s left');
  });

  it('detects long-running active phases without failing the job', () => {
    const progress = advanceLocalMp4ExportProgress(
      createLocalMp4ExportProgress('job-1', 'Preparing', 0),
      { phase: 'composing', message: 'Composing' },
      1000,
    );

    expect(isLocalMp4ExportStalled(progress, 20_000)).toBe(false);
    expect(isLocalMp4ExportStalled(progress, 50_000)).toBe(true);
    expect(describeLocalMp4ExportProgress(progress, 50_000)).toContain('taking longer than usual');
  });
});
