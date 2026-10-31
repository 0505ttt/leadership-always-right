import { describe, expect, it } from 'vitest';
import type { LoadingProgress } from '../src/loading/types';
import { entryIsReady, loadingProgressKey } from '../src/gameplay/entry-gate';

const ready: LoadingProgress = { stage: 'ready', completedResources: 16, totalResources: 16, failedItems: [], detail: 'done' };

describe('unified entry readiness and render snapshots', () => {
  it('requires both real ready progress and completed scene preparation', () => {
    expect(entryIsReady(ready, false)).toBe(false);
    expect(entryIsReady(ready, true)).toBe(true);
    expect(entryIsReady({ ...ready, stage: 'shaders' }, true)).toBe(false);
  });

  it('rejects ready-labelled progress while any failure remains', () => {
    expect(entryIsReady({ ...ready, failedItems: [{ id: 'cake-v2', label: 'cake-v2', message: 'failed' }] }, true)).toBe(false);
  });

  it('deduplicates identical progress but changes for every user-visible failure update', () => {
    const failure = { id: 'pot-v1', label: 'pot-v1', message: 'network', retryable: true } as const;
    const a: LoadingProgress = { ...ready, stage: 'error', failedItems: [failure] };
    expect(loadingProgressKey(a)).toBe(loadingProgressKey({ ...a, failedItems: [{ ...failure }] }));
    expect(loadingProgressKey(a)).not.toBe(loadingProgressKey({ ...a, failedItems: [{ ...failure, message: 'different' }] }));
    expect(loadingProgressKey(ready)).not.toBe(loadingProgressKey({ ...ready, completedResources: 15 }));
    expect(loadingProgressKey(ready)).not.toBe(loadingProgressKey({ ...ready, detail: 'different' }));
  });
});
