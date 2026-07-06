import { describe, expect, it } from 'vitest';
import { LOCAL_MP4_EXPORT_VERSION } from '@/lib/export/mp4/types';
import { parseLocalMp4Manifest, requireUploadedFile } from '@/lib/export/mp4/validation';

describe('local MP4 request validation', () => {
  it('parses a valid manifest', () => {
    const form = new FormData();
    form.set(
      'manifest',
      JSON.stringify({
        version: LOCAL_MP4_EXPORT_VERSION,
        stageTitle: 'Course',
        frameWidth: 1280,
        frameHeight: 720,
        warnings: [],
        segments: [
          {
            id: 'segment-0001',
            index: 1,
            sceneId: 's1',
            sceneTitle: 'Intro',
            sceneType: 'slide',
            sceneIndex: 1,
            actionId: 'a1',
            actionIndex: 0,
            text: 'Hello',
            frameFile: 'frames/001-intro.png',
            audioFile: 'audio/001-intro/speech-001.mp3',
          },
        ],
      }),
    );

    expect(parseLocalMp4Manifest(form.get('manifest')).segments).toHaveLength(1);
  });

  it('rejects manifests without segments', () => {
    const form = new FormData();
    form.set(
      'manifest',
      JSON.stringify({
        version: LOCAL_MP4_EXPORT_VERSION,
        stageTitle: 'Course',
        frameWidth: 1280,
        frameHeight: 720,
        warnings: [],
        segments: [],
      }),
    );

    expect(() => parseLocalMp4Manifest(form.get('manifest'))).toThrow(
      'No generated narration audio is available for MP4 export',
    );
  });

  it('requires uploaded frame/audio files by key', () => {
    const form = new FormData();
    form.set('frame:frames/001.png', new File(['x'], '001.png', { type: 'image/png' }));

    expect(requireUploadedFile(form, 'frame:frames/001.png')).toBeInstanceOf(File);
    expect(() => requireUploadedFile(form, 'audio:a.mp3')).toThrow('Missing uploaded file');
  });
});
