import { describe, expect, it } from 'vitest';
import {
  buildConcatFfmpegArgs,
  buildSegmentFfmpegArgs,
  concatListLine,
  parseFfprobeDuration,
} from '@/lib/export/mp4/ffmpeg';

describe('local MP4 ffmpeg helpers', () => {
  it('parses ffprobe duration output', () => {
    expect(parseFfprobeDuration('1.234000\n')).toBe(1.234);
    expect(() => parseFfprobeDuration('N/A')).toThrow('Invalid ffprobe duration');
  });

  it('builds argv-based segment commands without shell interpolation', () => {
    expect(
      buildSegmentFfmpegArgs({
        framePath: '/tmp/frame one.png',
        audioPath: '/tmp/audio one.mp3',
        durationSeconds: 2.5,
        outputPath: '/tmp/out.mp4',
      }),
    ).toEqual([
      '-y',
      '-loop',
      '1',
      '-framerate',
      '30',
      '-i',
      '/tmp/frame one.png',
      '-i',
      '/tmp/audio one.mp3',
      '-t',
      '2.500',
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
      '/tmp/out.mp4',
    ]);
  });

  it('builds concat args and escapes concat list entries', () => {
    expect(
      buildConcatFfmpegArgs({ concatListPath: '/tmp/list.txt', outputPath: '/tmp/out.mp4' }),
    ).toEqual([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      '/tmp/list.txt',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      '/tmp/out.mp4',
    ]);
    expect(concatListLine("/tmp/teacher's segment.mp4")).toBe(
      "file '/tmp/teacher'\\''s segment.mp4'",
    );
  });
});
