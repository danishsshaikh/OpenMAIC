import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, posix } from 'path';
import { NextResponse } from 'next/server';
import {
  assertFfmpegAvailable,
  buildConcatFfmpegArgs,
  buildSegmentFfmpegArgs,
  concatListLine,
  probeAudioDuration,
  runProcess,
} from '@/lib/export/mp4/ffmpeg';
import { cleanupMp4TempDir, createMp4TempDir } from '@/lib/export/mp4/temp-files';
import { LocalMp4ExportError } from '@/lib/export/mp4/types';
import { parseLocalMp4Manifest, requireUploadedFile } from '@/lib/export/mp4/validation';
import { sanitizeVideoFrameFilenamePart } from '@/lib/export/video-frame-planner';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

const log = createLogger('ExportVideoMp4Api');

export async function POST(request: Request) {
  let tempDir: string | null = null;

  try {
    const formData = await request.formData();
    const manifest = parseLocalMp4Manifest(formData.get('manifest'));
    const diagnostics = getFormDataDiagnostics(formData);
    log.info('Received local MP4 export request:', {
      ...diagnostics,
      segmentCount: manifest.segments.length,
    });

    try {
      await assertFfmpegAvailable();
    } catch (error) {
      return jsonError(
        'MISSING_FFMPEG',
        'Local MP4 export requires ffmpeg and ffprobe on the server PATH.',
        error,
        500,
      );
    }

    tempDir = await createMp4TempDir();
    const segmentPaths: string[] = [];
    const writtenAssets = new Map<string, string>();

    for (const segment of manifest.segments) {
      const framePath = await writeUploadedAsset(
        tempDir,
        segment.frameFile,
        requireUploadedFile(formData, `frame:${segment.frameFile}`),
        writtenAssets,
      );
      const audioPath = await writeUploadedAsset(
        tempDir,
        segment.audioFile,
        requireUploadedFile(formData, `audio:${segment.audioFile}`),
        writtenAssets,
      );
      const durationSeconds = await probeAudioDuration(audioPath);
      const segmentPath = join(tempDir, `segment-${String(segment.index).padStart(4, '0')}.mp4`);
      await runProcess(
        'ffmpeg',
        buildSegmentFfmpegArgs({
          framePath,
          audioPath,
          durationSeconds,
          outputPath: segmentPath,
        }),
      );
      segmentPaths.push(segmentPath);
    }

    const concatListPath = join(tempDir, 'segments.txt');
    await writeFile(concatListPath, `${segmentPaths.map(concatListLine).join('\n')}\n`);

    const outputPath = join(tempDir, 'openmaic-export.mp4');
    await runProcess('ffmpeg', buildConcatFfmpegArgs({ concatListPath, outputPath }));
    const output = await readFile(outputPath);
    const filename = `${sanitizeVideoFrameFilenamePart(manifest.stageTitle)}.mp4`;

    return new Response(output, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof LocalMp4ExportError) {
      return jsonError(error.code, error.message, error.details, 400);
    }
    return jsonError('MP4_EXPORT_FAILED', 'MP4 export failed.', error, 500);
  } finally {
    if (tempDir) await cleanupMp4TempDir(tempDir);
  }
}

async function writeUploadedAsset(
  tempDir: string,
  logicalPath: string,
  file: File,
  writtenAssets: Map<string, string>,
): Promise<string> {
  const safePath = safeAssetPath(logicalPath);
  const cached = writtenAssets.get(safePath);
  if (cached) return cached;

  const destination = join(tempDir, safePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await file.arrayBuffer()));
  writtenAssets.set(safePath, destination);
  return destination;
}

function safeAssetPath(logicalPath: string): string {
  const normalized = logicalPath.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    normalized.split('/').includes('..')
  ) {
    throw new LocalMp4ExportError('INVALID_UPLOAD_PATH', `Unsafe upload path: ${logicalPath}`);
  }
  return posix.normalize(normalized);
}

function jsonError(code: string, message: string, details: unknown, status: number) {
  log.error(`Local MP4 export error [${code}]: ${message}`, details);
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details: details instanceof Error ? details.message : details,
      },
    },
    { status },
  );
}

function getFormDataDiagnostics(formData: FormData) {
  let fileCount = 0;
  let frameCount = 0;
  let audioCount = 0;
  let totalBytes = 0;
  let frameBytes = 0;
  let audioBytes = 0;
  let largestFileBytes = 0;

  for (const [key, value] of formData.entries()) {
    if (!(value instanceof File)) continue;
    fileCount++;
    totalBytes += value.size;
    largestFileBytes = Math.max(largestFileBytes, value.size);
    if (key.startsWith('frame:')) {
      frameCount++;
      frameBytes += value.size;
    } else if (key.startsWith('audio:')) {
      audioCount++;
      audioBytes += value.size;
    }
  }

  return {
    fileCount,
    frameCount,
    audioCount,
    totalBytes,
    totalMb: (totalBytes / 1024 / 1024).toFixed(2),
    frameBytes,
    audioBytes,
    largestFileBytes,
  };
}
