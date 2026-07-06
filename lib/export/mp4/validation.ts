import {
  LOCAL_MP4_EXPORT_VERSION,
  LocalMp4ExportError,
  type LocalMp4ExportManifest,
} from './types';

export function parseLocalMp4Manifest(value: FormDataEntryValue | null): LocalMp4ExportManifest {
  if (typeof value !== 'string') {
    throw new LocalMp4ExportError('INVALID_MANIFEST', 'Missing MP4 export manifest');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LocalMp4ExportError('INVALID_MANIFEST', 'MP4 export manifest is not valid JSON');
  }

  if (!isRecord(parsed)) {
    throw new LocalMp4ExportError('INVALID_MANIFEST', 'MP4 export manifest must be an object');
  }

  if (parsed.version !== LOCAL_MP4_EXPORT_VERSION) {
    throw new LocalMp4ExportError('INVALID_MANIFEST', 'Unsupported MP4 export manifest version');
  }

  if (typeof parsed.stageTitle !== 'string' || !parsed.stageTitle.trim()) {
    throw new LocalMp4ExportError('INVALID_MANIFEST', 'MP4 export manifest is missing stageTitle');
  }

  if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    throw new LocalMp4ExportError(
      'NO_SEGMENTS',
      'No generated narration audio is available for MP4 export',
    );
  }

  for (const segment of parsed.segments) {
    if (!isRecord(segment)) {
      throw new LocalMp4ExportError('INVALID_MANIFEST', 'MP4 segment must be an object');
    }
    for (const key of ['id', 'frameFile', 'audioFile', 'sceneId', 'sceneTitle', 'text']) {
      if (typeof segment[key] !== 'string' || !segment[key]) {
        throw new LocalMp4ExportError('INVALID_MANIFEST', `MP4 segment is missing ${key}`);
      }
    }
    if (typeof segment.index !== 'number' || typeof segment.actionIndex !== 'number') {
      throw new LocalMp4ExportError('INVALID_MANIFEST', 'MP4 segment indexes must be numbers');
    }
  }

  return parsed as unknown as LocalMp4ExportManifest;
}

export function requireUploadedFile(formData: FormData, key: string): File {
  const value = formData.get(key);
  if (!(value instanceof File)) {
    throw new LocalMp4ExportError('MISSING_UPLOAD', `Missing uploaded file: ${key}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
