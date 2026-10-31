export type LoadingStage = 'download' | 'parse' | 'textures' | 'audio' | 'scene' | 'shaders' | 'ready' | 'error';

export interface LoadingFailure {
  id: string;
  label: string;
  message: string;
  retryable?: boolean;
}

/** Every value comes from the real loader. Omit byte totals when they are not reliable. */
export interface LoadingProgress {
  stage: LoadingStage;
  completedResources: number;
  totalResources: number;
  bytes?: { completed: number; total: number };
  failedItems?: readonly LoadingFailure[];
  detail?: string;
}

export interface LoadingCallbacks {
  /** Called synchronously from the button gesture so audio can be unlocked. */
  onEnter(): void;
  onRetry(id: string): void | Promise<void>;
  onTutorial?(): void;
}

export interface LoadingDiagnostics {
  sampleCount: number;
  cards: { id: string; samples: number; width: number; height: number; cssWidth: number; cssHeight: number; dpr: number; scheduled: boolean; scans: number; targets: number }[];
}

export interface LoadingScreen {
  update(progress: LoadingProgress): void;
  /** Root can hide the component during gameplay without discarding sampled fields. */
  setVisible(visible: boolean): void;
  getDiagnostics(): LoadingDiagnostics;
  destroy(): void;
}

export interface FieldSymbol {
  id: string;
  title: string;
  slogan: string;
  path: string;
  seed: number;
  scale: number;
  background: string;
  ink: string;
  detection: string;
  light: boolean;
}
