import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { SceneOutline } from '@/lib/types/generation';
import {
  clearSceneContentJobsForTests,
  createOrReuseSceneContentJob,
  createSceneContentDedupeKey,
  readSceneContentJob,
  runSceneContentJob,
} from '@/lib/server/scene-content-jobs';

const outline: SceneOutline = {
  id: 'outline-sim',
  type: 'interactive',
  title: 'BST Traversal Simulator',
  description: 'Explore tree traversal order.',
  keyPoints: ['Insert nodes', 'Run traversal'],
  order: 1,
  widgetType: 'simulation',
  widgetOutline: { concept: 'bst_traversal', keyVariables: ['order'] },
};

describe('scene content jobs', () => {
  beforeEach(() => {
    clearSceneContentJobsForTests();
  });

  test('starts quickly, stays generating while work is pending, and completes with content', async () => {
    const deferred = createDeferred();
    const job = createJob('owner-a', dedupeFor({ outline })).job;
    const run = runSceneContentJob(job.id, async () => {
      await deferred.promise;
      return { content: { html: '<html></html>' }, effectiveOutline: outline };
    });

    expect(readSceneContentJob(job.id, 'owner-a')?.status).toBe('generating');

    deferred.resolve();
    await run;

    const completed = readSceneContentJob(job.id, 'owner-a');
    expect(completed?.status).toBe('completed');
    expect(completed?.result?.content).toEqual({ html: '<html></html>' });
  });

  test('reports failed generation without leaving the job running', async () => {
    const job = createJob('owner-a', dedupeFor({ outline })).job;

    await runSceneContentJob(job.id, async () => {
      throw new Error('model failed with bounded diagnostic');
    });

    const failed = readSceneContentJob(job.id, 'owner-a');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('model failed');
  });

  test('dedupes equivalent active simulation requests so the generator runs once', async () => {
    const deferred = createDeferred();
    const dedupeKey = dedupeFor({ outline, model: 'gemma' });
    const first = createJob('owner-a', dedupeKey);
    const second = createJob('owner-a', dedupeKey);
    const generate = vi.fn(async () => {
      await deferred.promise;
      return { content: { html: '<html></html>' }, effectiveOutline: outline };
    });

    const runs = [
      !first.reused ? runSceneContentJob(first.job.id, generate) : Promise.resolve(),
      !second.reused ? runSceneContentJob(second.job.id, generate) : Promise.resolve(),
    ];

    expect(second.reused).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(generate).toHaveBeenCalledTimes(1);

    deferred.resolve();
    await Promise.all(runs);
  });

  test('allows a new retry job after a genuine failed job', async () => {
    const dedupeKey = dedupeFor({ outline });
    const first = createJob('owner-a', dedupeKey).job;
    await runSceneContentJob(first.id, async () => {
      throw new Error('first failed');
    });

    const retry = createJob('owner-a', dedupeKey);

    expect(retry.reused).toBe(false);
    expect(retry.job.id).not.toBe(first.id);
  });

  test('materially different requests create different jobs', () => {
    const first = createJob('owner-a', dedupeFor({ outline })).job;
    const changed = createJob(
      'owner-a',
      dedupeFor({ outline: { ...outline, keyPoints: ['changed'] } }),
    ).job;

    expect(changed.id).not.toBe(first.id);
  });

  test('does not expose one owner job to another owner', () => {
    const job = createJob('owner-a', dedupeFor({ outline })).job;

    expect(readSceneContentJob(job.id, 'owner-b')).toBeNull();
  });

  test('unknown job ids fail safely', () => {
    expect(readSceneContentJob('missing-job', 'owner-a')).toBeNull();
  });
});

function createJob(ownerUserId: string, dedupeKey: string) {
  return createOrReuseSceneContentJob({
    ownerUserId,
    dedupeKey,
    stageId: 'stage-1',
    outlineId: outline.id,
    outlineTitle: outline.title,
    widgetType: 'simulation',
    modelString: 'test:gemma',
  });
}

function dedupeFor(input: unknown): string {
  return createSceneContentDedupeKey(input);
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
