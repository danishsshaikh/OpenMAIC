import { spawn } from 'child_process';

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) {
        resolve(result);
      } else {
        reject(
          new Error(
            `${command} exited with code ${code}: ${result.stderr.trim() || result.stdout.trim()}`,
          ),
        );
      }
    });
  });
}

export async function assertFfmpegAvailable() {
  await runProcess('ffmpeg', ['-version']);
  await runProcess('ffprobe', ['-version']);
}

export async function probeAudioDuration(audioPath: string): Promise<number> {
  const result = await runProcess('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ]);
  return parseFfprobeDuration(result.stdout);
}

export function parseFfprobeDuration(stdout: string): number {
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Invalid ffprobe duration: ${stdout.trim() || '(empty)'}`);
  }
  return duration;
}

export function buildSegmentFfmpegArgs({
  framePath,
  audioPath,
  durationSeconds,
  outputPath,
}: {
  framePath: string;
  audioPath: string;
  durationSeconds: number;
  outputPath: string;
}): string[] {
  return [
    '-y',
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    framePath,
    '-i',
    audioPath,
    '-t',
    durationSeconds.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

export function buildConcatFfmpegArgs({
  concatListPath,
  outputPath,
}: {
  concatListPath: string;
  outputPath: string;
}): string[] {
  return [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

export function concatListLine(filePath: string): string {
  return `file '${filePath.replaceAll("'", "'\\''")}'`;
}
