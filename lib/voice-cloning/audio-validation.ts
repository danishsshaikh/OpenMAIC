import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  MAX_RECORDING_DURATION_SECONDS,
  MAX_RECORDING_SIZE_BYTES,
  MIN_RECORDING_DURATION_SECONDS,
  MIN_RECORDING_SIZE_BYTES,
} from '@/lib/voice-cloning/limits';

const execFileAsync = promisify(execFile);

export const VOICE_REFERENCE_SAMPLE_RATE = 24000;

export const VOICE_AUDIO_PROCESSING_CONFIG = {
  referenceSampleRate: VOICE_REFERENCE_SAMPLE_RATE,
  silenceThresholdDb: -45,
  maxSilenceRatio: 0.55,
  tooQuietMeanVolumeDb: -42,
  tooQuietPeakVolumeDb: -30,
  severeClippingPeakDb: -0.05,
  referenceLoudnessTarget: -20,
  referencePeakCeiling: -2.5,
  outputLoudnessTarget: -18,
  outputPeakCeiling: -2,
  outputLimiterLevel: 0.95,
  // Conservative denoising only. Stronger cleanup can damage speaker identity
  // and does not guarantee accent or speaker-similarity improvements.
  referenceDenoiseNoiseFloorDb: -28,
} as const;

const REFERENCE_PREPROCESSING_FILTER = [
  `silenceremove=start_periods=1:start_duration=0.25:start_threshold=${VOICE_AUDIO_PROCESSING_CONFIG.silenceThresholdDb}dB`,
  'areverse',
  `silenceremove=start_periods=1:start_duration=0.25:start_threshold=${VOICE_AUDIO_PROCESSING_CONFIG.silenceThresholdDb}dB`,
  'areverse',
  `afftdn=nf=${VOICE_AUDIO_PROCESSING_CONFIG.referenceDenoiseNoiseFloorDb}`,
  `loudnorm=I=${VOICE_AUDIO_PROCESSING_CONFIG.referenceLoudnessTarget}:TP=${VOICE_AUDIO_PROCESSING_CONFIG.referencePeakCeiling}:LRA=12`,
  `alimiter=limit=${VOICE_AUDIO_PROCESSING_CONFIG.outputLimiterLevel}`,
].join(',');

const GENERATED_AUDIO_MASTERING_FILTER = [
  `silenceremove=start_periods=1:start_duration=0.2:start_threshold=${VOICE_AUDIO_PROCESSING_CONFIG.silenceThresholdDb}dB`,
  'areverse',
  `silenceremove=start_periods=1:start_duration=0.2:start_threshold=${VOICE_AUDIO_PROCESSING_CONFIG.silenceThresholdDb}dB`,
  'areverse',
  `loudnorm=I=${VOICE_AUDIO_PROCESSING_CONFIG.outputLoudnessTarget}:TP=${VOICE_AUDIO_PROCESSING_CONFIG.outputPeakCeiling}:LRA=11`,
  `alimiter=limit=${VOICE_AUDIO_PROCESSING_CONFIG.outputLimiterLevel}`,
].join(',');

export const SUPPORTED_RECORDING_MIME_TYPES = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
]);

export type VoiceRecordingQualityCode =
  | 'decode_failed'
  | 'too_short'
  | 'too_long'
  | 'too_quiet'
  | 'too_much_silence'
  | 'clipped'
  | 'empty';

export class VoiceRecordingQualityError extends Error {
  readonly code: VoiceRecordingQualityCode;
  readonly userMessage: string;

  constructor(code: VoiceRecordingQualityCode, userMessage: string, details?: string) {
    super(details || userMessage);
    this.name = 'VoiceRecordingQualityError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

export function isVoiceRecordingQualityError(error: unknown): error is VoiceRecordingQualityError {
  return (
    error instanceof VoiceRecordingQualityError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'VoiceRecordingQualityError')
  );
}

export interface IncomingVoiceClip {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

export interface VoiceRecordingQualityMetrics {
  durationSeconds: number;
  meanVolumeDb: number;
  maxVolumeDb: number;
  silenceSeconds: number;
  silenceRatio: number;
}

export interface NormalizedVoiceReference {
  referenceAudio: Uint8Array;
  durationSeconds: number;
  quality: VoiceRecordingQualityMetrics;
  format: 'wav';
}

export function validateIncomingClipMetadata(clip: IncomingVoiceClip): void {
  const mimeType = clip.mimeType.toLowerCase();
  if (!SUPPORTED_RECORDING_MIME_TYPES.has(mimeType)) {
    throw new VoiceRecordingQualityError(
      'decode_failed',
      'The recording could not be read. Please try recording again.',
      `Unsupported audio type: ${clip.mimeType || 'unknown'}`,
    );
  }
  if (clip.bytes.byteLength < MIN_RECORDING_SIZE_BYTES) {
    throw new VoiceRecordingQualityError(
      'empty',
      'The recording appears empty. Please check your microphone and try again.',
    );
  }
  if (clip.bytes.byteLength > MAX_RECORDING_SIZE_BYTES) {
    throw new VoiceRecordingQualityError(
      'too_long',
      'The recording is too large. Please record a shorter sample.',
    );
  }
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('mpeg')) return 'mp3';
  return 'wav';
}

async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('invalid duration');
    }
    return duration;
  } catch (error) {
    throw new VoiceRecordingQualityError(
      'decode_failed',
      'The recording could not be read. Please try recording again.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function parseDbValue(report: string, label: string): number | null {
  const match = new RegExp(`${label}:\\s*(-?\\d+(?:\\.\\d+)?)\\s*dB`).exec(report);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseTotalSilenceSeconds(report: string): number {
  const matches = report.matchAll(/silence_duration:\s*(\d+(?:\.\d+)?)/g);
  let total = 0;
  for (const match of matches) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

export function qualityMetricsFromFfmpegReports(input: {
  durationSeconds: number;
  volumeReport: string;
  silenceReport: string;
}): VoiceRecordingQualityMetrics {
  const meanVolumeDb = parseDbValue(input.volumeReport, 'mean_volume');
  const maxVolumeDb = parseDbValue(input.volumeReport, 'max_volume');
  if (meanVolumeDb === null || maxVolumeDb === null) {
    throw new VoiceRecordingQualityError(
      'decode_failed',
      'The recording could not be analyzed. Please try recording again.',
    );
  }
  const silenceSeconds = parseTotalSilenceSeconds(input.silenceReport);
  return {
    durationSeconds: input.durationSeconds,
    meanVolumeDb,
    maxVolumeDb,
    silenceSeconds,
    silenceRatio: input.durationSeconds > 0 ? silenceSeconds / input.durationSeconds : 1,
  };
}

export function evaluateVoiceRecordingQuality(metrics: VoiceRecordingQualityMetrics): void {
  if (metrics.durationSeconds < MIN_RECORDING_DURATION_SECONDS) {
    throw new VoiceRecordingQualityError(
      'too_short',
      'The recording is too short. Please read the full paragraph naturally.',
    );
  }
  if (metrics.durationSeconds > MAX_RECORDING_DURATION_SECONDS) {
    throw new VoiceRecordingQualityError(
      'too_long',
      'The recording is too long. Please keep it close to ten seconds.',
    );
  }
  if (
    metrics.meanVolumeDb <= VOICE_AUDIO_PROCESSING_CONFIG.tooQuietMeanVolumeDb ||
    metrics.maxVolumeDb <= VOICE_AUDIO_PROCESSING_CONFIG.tooQuietPeakVolumeDb
  ) {
    throw new VoiceRecordingQualityError(
      'too_quiet',
      'The recording is too quiet. Please try again a little closer to your microphone.',
    );
  }
  if (metrics.silenceRatio >= VOICE_AUDIO_PROCESSING_CONFIG.maxSilenceRatio) {
    throw new VoiceRecordingQualityError(
      'too_much_silence',
      'The recording contains too much silence. Please read the full paragraph naturally.',
    );
  }
  if (metrics.maxVolumeDb >= VOICE_AUDIO_PROCESSING_CONFIG.severeClippingPeakDb) {
    throw new VoiceRecordingQualityError(
      'clipped',
      'The recording appears clipped or distorted. Please try again at a normal speaking volume.',
    );
  }
}

async function runFfmpegAnalysis(args: string[]): Promise<string> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', args);
    return stderr;
  } catch (error) {
    throw new VoiceRecordingQualityError(
      'decode_failed',
      'The recording could not be analyzed. Please try recording again.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function analyzeVoiceRecordingQuality(
  filePath: string,
): Promise<VoiceRecordingQualityMetrics> {
  const durationSeconds = await probeDuration(filePath);
  const volumeReport = await runFfmpegAnalysis([
    '-hide_banner',
    '-i',
    filePath,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ]);
  const silenceReport = await runFfmpegAnalysis([
    '-hide_banner',
    '-i',
    filePath,
    '-af',
    `silencedetect=n=${VOICE_AUDIO_PROCESSING_CONFIG.silenceThresholdDb}dB:d=0.4`,
    '-f',
    'null',
    '-',
  ]);
  const metrics = qualityMetricsFromFfmpegReports({
    durationSeconds,
    volumeReport,
    silenceReport,
  });
  evaluateVoiceRecordingQuality(metrics);
  return metrics;
}

export async function validateVoiceClipDecodability(filePath: string): Promise<number> {
  const duration = await probeDuration(filePath);
  if (duration < MIN_RECORDING_DURATION_SECONDS) {
    throw new VoiceRecordingQualityError(
      'too_short',
      'The recording is too short. Please read the full paragraph naturally.',
    );
  }
  if (duration > MAX_RECORDING_DURATION_SECONDS) {
    throw new VoiceRecordingQualityError(
      'too_long',
      'The recording is too long. Please keep it close to ten seconds.',
    );
  }
  return duration;
}

export async function normalizeVoiceEnrollmentRecording(
  recording: IncomingVoiceClip,
): Promise<NormalizedVoiceReference> {
  validateIncomingClipMetadata(recording);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openmaic-voice-'));
  try {
    const inputPath = path.join(tempDir, `recording.${extensionForMime(recording.mimeType)}`);
    const outputPath = path.join(tempDir, 'reference.wav');
    await fs.writeFile(inputPath, recording.bytes);

    const quality = await analyzeVoiceRecordingQuality(inputPath);
    await execFileAsync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      String(VOICE_REFERENCE_SAMPLE_RATE),
      '-af',
      REFERENCE_PREPROCESSING_FILTER,
      outputPath,
    ]);
    const durationSeconds = await validateVoiceClipDecodability(outputPath);
    return {
      referenceAudio: new Uint8Array(await fs.readFile(outputPath)),
      durationSeconds,
      quality,
      format: 'wav',
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function normalizeVoiceEnrollmentClips(clips: IncomingVoiceClip[]): Promise<{
  referenceAudio: Uint8Array;
  durations: number[];
}> {
  if (clips.length !== 1) {
    throw new Error('Exactly one recording is required');
  }
  const normalized = await normalizeVoiceEnrollmentRecording(clips[0]);
  return { referenceAudio: normalized.referenceAudio, durations: [normalized.durationSeconds] };
}

export async function masterGeneratedVoiceAudio(
  audio: Uint8Array,
  format: string,
): Promise<{ audio: Uint8Array; format: 'wav' }> {
  if (audio.byteLength < MIN_RECORDING_SIZE_BYTES) {
    throw new Error('Generated voice audio is empty');
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openmaic-voice-output-'));
  try {
    const inputPath = path.join(tempDir, `raw.${extensionForMime(`audio/${format}`)}`);
    const outputPath = path.join(tempDir, 'mastered.wav');
    await fs.writeFile(inputPath, audio);
    await execFileAsync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      String(VOICE_REFERENCE_SAMPLE_RATE),
      '-af',
      GENERATED_AUDIO_MASTERING_FILTER,
      outputPath,
    ]);
    await probeDuration(outputPath);
    return { audio: new Uint8Array(await fs.readFile(outputPath)), format: 'wav' };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
