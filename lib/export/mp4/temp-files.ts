import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export async function createMp4TempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'openmaic-mp4-'));
}

export async function cleanupMp4TempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
