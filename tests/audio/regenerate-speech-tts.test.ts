import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bulkGet: vi.fn(),
  get: vi.fn(),
  bulkDelete: vi.fn(),
  settingsState: vi.fn(),
  generateAndStoreTTS: vi.fn(),
}));

vi.mock('@/lib/utils/database', () => ({
  db: {
    audioFiles: {
      bulkGet: mocks.bulkGet,
      get: mocks.get,
      bulkDelete: mocks.bulkDelete,
    },
  },
}));

vi.mock('@/lib/store/settings', () => ({
  useSettingsStore: {
    getState: mocks.settingsState,
  },
}));

vi.mock('@/lib/hooks/use-scene-generator', () => ({
  generateAndStoreTTS: mocks.generateAndStoreTTS,
}));

import { filterSpeechActionsNeedingAudio } from '@/lib/audio/regenerate-speech-tts';

describe('filterSpeechActionsNeedingAudio', () => {
  beforeEach(() => {
    mocks.bulkGet.mockReset();
    mocks.get.mockReset();
    mocks.bulkDelete.mockReset();
    mocks.settingsState.mockReset();
    mocks.generateAndStoreTTS.mockReset();
    mocks.bulkGet.mockResolvedValue([]);
  });

  it('skips empty text', async () => {
    const result = await filterSpeechActionsNeedingAudio([{ id: 'a1', text: '   ' }]);

    expect(result).toEqual([]);
    expect(mocks.bulkGet).not.toHaveBeenCalled();
  });

  it('skips lines with audioUrl', async () => {
    const result = await filterSpeechActionsNeedingAudio([
      { id: 'a1', text: 'Hello', audioUrl: '/audio/a1.mp3' },
    ]);

    expect(result).toEqual([]);
    expect(mocks.bulkGet).not.toHaveBeenCalled();
  });

  it('skips lines with cached stamped audioId', async () => {
    mocks.bulkGet.mockResolvedValue([{ id: 'tts-a1' }]);

    const result = await filterSpeechActionsNeedingAudio([
      { id: 'a1', text: 'Hello', audioId: 'tts-a1' },
    ]);

    expect(result).toEqual([]);
    expect(mocks.bulkGet).toHaveBeenCalledWith(['tts-a1']);
  });

  it('includes lines with missing stamped audioId cache', async () => {
    mocks.bulkGet.mockResolvedValue([undefined]);
    const action = { id: 'a1', text: 'Hello', audioId: 'tts-a1' };

    const result = await filterSpeechActionsNeedingAudio([action]);

    expect(result).toEqual([action]);
    expect(mocks.bulkGet).toHaveBeenCalledWith(['tts-a1']);
  });

  it('includes non-empty lines without audioId or audioUrl', async () => {
    const action = { id: 'a1', text: 'Hello' };

    const result = await filterSpeechActionsNeedingAudio([action]);

    expect(result).toEqual([action]);
    expect(mocks.bulkGet).not.toHaveBeenCalled();
  });

  it('returns only the lines bulk Voice all should regenerate', async () => {
    mocks.bulkGet.mockResolvedValue([{ id: 'tts-ready' }, undefined]);
    const readyByUrl = { id: 'url', text: 'Already voiced', audioUrl: '/audio/url.mp3' };
    const readyByCache = { id: 'ready', text: 'Already voiced', audioId: 'tts-ready' };
    const missingCache = { id: 'missing-cache', text: 'Needs audio', audioId: 'tts-missing' };
    const missingAudioId = { id: 'missing-id', text: 'Needs audio' };
    const empty = { id: 'empty', text: '' };
    const noStringId = { text: 'No id' };

    const result = await filterSpeechActionsNeedingAudio([
      readyByUrl,
      readyByCache,
      missingCache,
      missingAudioId,
      empty,
      noStringId,
    ]);

    expect(result).toEqual([missingCache, missingAudioId]);
    expect(mocks.bulkGet).toHaveBeenCalledWith(['tts-ready', 'tts-missing']);
  });
});
