import type { LoadingDiagnostics, LoadingProgress } from '../../../src/loading/types';

export type EntryPhase = 'home' | 'loading';

export interface EntryCallbacks {
  /** Resources are already ready: start gameplay immediately, never load again. */
  onStart?(): void;
  /** Enter the ready home page; keep synchronous for a real user-gesture audio unlock. */
  onEnter?(): void;
  onRetry?(id: string): void | Promise<void>;
  onSettingChange?(key: 'reducedMotion' | 'textScale', value: boolean | number): void;
}

export interface EntryDiagnostics extends LoadingDiagnostics {
  phase: EntryPhase;
  progress: LoadingProgress;
  motionEnabled: boolean;
}

export interface EntryExperience {
  setPhase(phase: EntryPhase): void;
  update(progress: LoadingProgress): void;
  setVisible(visible: boolean): void;
  getDiagnostics(): EntryDiagnostics;
  destroy(): void;
}

export type { LoadingProgress };
export { type LoadingStage, type LoadingFailure } from '../../../src/loading/types';
