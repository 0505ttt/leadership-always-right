import type { LoadingProgress } from '../loading/types';

/** Both the reported loader state and the completed scene preparation gate entry. */
export function entryIsReady(progress: LoadingProgress, visualAssetsReady: boolean): boolean {
  return visualAssetsReady && progress.stage === 'ready' && (progress.failedItems?.length ?? 0) === 0;
}

/** Stable snapshot key prevents DOM/focus reconstruction on every animation frame. */
export function loadingProgressKey(progress: LoadingProgress): string {
  return JSON.stringify({
    stage: progress.stage,
    completed: progress.completedResources,
    total: progress.totalResources,
    bytes: progress.bytes ?? null,
    detail: progress.detail ?? '',
    failed: (progress.failedItems ?? []).map(item => [item.id, item.label, item.message, item.retryable !== false]),
  });
}
