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

export interface IncomingVoiceClip {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

export function validateIncomingClipMetadata(clip: IncomingVoiceClip): void {
  const mimeType = clip.mimeType.toLowerCase();
  if (!SUPPORTED_RECORDING_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported audio type: ${clip.mimeType || 'unknown'}`);
  }
  if (clip.bytes.byteLength < MIN_RECORDING_SIZE_BYTES) {
    throw new Error('Recording is empty or too small');
  }
  if (clip.bytes.byteLength > MAX_RECORDING_SIZE_BYTES) {
    throw new Error('Recording is too large');
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
    throw new Error('Recording could not be decoded');
  }
  return duration;
}

export async function validateVoiceClipDecodability(filePath: string): Promise<number> {
  const duration = await probeDuration(filePath);
  if (duration < MIN_RECORDING_DURATION_SECONDS) {
    throw new Error('Recording is too short');
  }
  if (duration > MAX_RECORDING_DURATION_SECONDS) {
    throw new Error('Recording is too long');
  }
  return duration;
}

export async function normalizeVoiceEnrollmentClips(clips: IncomingVoiceClip[]): Promise<{
  referenceAudio: Uint8Array;
  durations: number[];
}> {
  if (clips.length !== 3) {
    throw new Error('Exactly three recordings are required');
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openmaic-voice-'));
  try {
    const normalizedPaths: string[] = [];
    const durations: number[] = [];
    for (const [index, clip] of clips.entries()) {
      validateIncomingClipMetadata(clip);
      const inputPath = path.join(tempDir, `clip-${index}.${extensionForMime(clip.mimeType)}`);
      const outputPath = path.join(tempDir, `clip-${index}.wav`);
      await fs.writeFile(inputPath, clip.bytes);
      durations.push(await validateVoiceClipDecodability(inputPath));
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
        '24000',
        '-af',
        'silenceremove=start_periods=1:start_duration=0.2:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_duration=0.2:start_threshold=-45dB,areverse,loudnorm=I=-18:TP=-2:LRA=11',
        outputPath,
      ]);
      await validateVoiceClipDecodability(outputPath);
      normalizedPaths.push(outputPath);
    }

    const concatListPath = path.join(tempDir, 'concat.txt');
    const silencePath = path.join(tempDir, 'silence.wav');
    await execFileAsync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=24000:cl=mono',
      '-t',
      '0.35',
      silencePath,
    ]);
    const sequence = normalizedPaths.flatMap((file, index) =>
      index === normalizedPaths.length - 1 ? [file] : [file, silencePath],
    );
    await fs.writeFile(
      concatListPath,
      sequence.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8',
    );
    const combinedPath = path.join(tempDir, 'reference.wav');
    await execFileAsync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-ac',
      '1',
      '-ar',
      '24000',
      combinedPath,
    ]);
    await validateVoiceClipDecodability(combinedPath);
    return { referenceAudio: new Uint8Array(await fs.readFile(combinedPath)), durations };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
