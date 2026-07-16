export type LocalMp4ExportPhase =
  | 'preparing'
  | 'rendering'
  | 'compressing'
  | 'audio'
  | 'uploading'
  | 'composing'
  | 'finalizing'
  | 'complete'
  | 'failed';

export interface LocalMp4ExportProgress {
  jobId: string;
  phase: LocalMp4ExportPhase;
  message: string;
  completedUnits?: number;
  totalUnits?: number;
  percent?: number;
  startedAtMs: number;
  updatedAtMs: number;
}

interface ProgressUpdate {
  phase: LocalMp4ExportPhase;
  message: string;
  completedUnits?: number;
  totalUnits?: number;
  percent?: number;
}

const PHASE_RANGES: Record<LocalMp4ExportPhase, { start: number; end: number }> = {
  preparing: { start: 2, end: 5 },
  rendering: { start: 5, end: 25 },
  compressing: { start: 25, end: 35 },
  audio: { start: 35, end: 70 },
  uploading: { start: 70, end: 85 },
  composing: { start: 85, end: 92 },
  finalizing: { start: 92, end: 98 },
  complete: { start: 100, end: 100 },
  failed: { start: 0, end: 0 },
};

export function createLocalMp4ExportProgress(
  jobId: string,
  message: string,
  nowMs = Date.now(),
): LocalMp4ExportProgress {
  return {
    jobId,
    phase: 'preparing',
    message,
    percent: 0,
    startedAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function advanceLocalMp4ExportProgress(
  previous: LocalMp4ExportProgress,
  update: ProgressUpdate,
  nowMs = Date.now(),
): LocalMp4ExportProgress {
  const nextPercent =
    update.percent ??
    computeWeightedPercent(update.phase, update.completedUnits, update.totalUnits);
  const percent =
    update.phase === 'failed'
      ? previous.percent
      : Math.max(previous.percent ?? 0, clampPercent(nextPercent));

  return {
    ...previous,
    ...update,
    percent,
    updatedAtMs: nowMs,
  };
}

export function computeWeightedPercent(
  phase: LocalMp4ExportPhase,
  completedUnits?: number,
  totalUnits?: number,
): number {
  const range = PHASE_RANGES[phase];
  if (phase === 'complete') return 100;
  if (phase === 'failed') return 0;
  if (!range) return 0;

  if (!totalUnits || totalUnits <= 0 || completedUnits === undefined) return range.start;
  const ratio = Math.max(0, Math.min(1, completedUnits / totalUnits));
  return range.start + (range.end - range.start) * ratio;
}

export function estimateRemainingSeconds(progress: LocalMp4ExportProgress, nowMs = Date.now()) {
  const percent = progress.percent ?? 0;
  if (percent < 5 || percent >= 92) return null;

  const elapsedSeconds = elapsedExportSeconds(progress, nowMs);
  if (elapsedSeconds <= 0) return null;

  return Math.max(1, Math.round((elapsedSeconds / percent) * (100 - percent)));
}

export function elapsedExportSeconds(progress: LocalMp4ExportProgress, nowMs = Date.now()) {
  return Math.max(0, Math.round((nowMs - progress.startedAtMs) / 1000));
}

export function isLocalMp4ExportStalled(progress: LocalMp4ExportProgress, nowMs = Date.now()) {
  return (
    progress.phase !== 'complete' &&
    progress.phase !== 'failed' &&
    nowMs - progress.updatedAtMs > 45000
  );
}

export function formatExportDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

export function describeLocalMp4ExportProgress(
  progress: LocalMp4ExportProgress,
  nowMs = Date.now(),
) {
  const details: string[] = [];
  if (progress.completedUnits !== undefined && progress.totalUnits !== undefined) {
    details.push(`${progress.completedUnits} of ${progress.totalUnits}`);
  }
  details.push(`${Math.round(progress.percent ?? 0)}%`);
  details.push(`Elapsed ${formatExportDuration(elapsedExportSeconds(progress, nowMs))}`);

  const remaining = estimateRemainingSeconds(progress, nowMs);
  details.push(
    remaining === null
      ? 'Estimating time remaining'
      : `About ${formatExportDuration(remaining)} left`,
  );

  if (isLocalMp4ExportStalled(progress, nowMs)) {
    details.push('This step is taking longer than usual, but the export is still running');
  }

  return details.join(' • ');
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
