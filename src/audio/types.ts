/** Presentation-only audio contracts. No type or callback can mutate game state. */
export type AudioRoom = 'work' | 'meeting' | 'front' | 'tea' | 'boss' | 'storage' | 'admin' | 'print';
export type MusicMood = 'office' | 'inspection' | 'pursuit' | 'release' | 'success' | 'computer';
export type AudioRule = 'cake' | 'desk' | 'pot' | 'return' | 'flow' | 'transparent' | 'pressure';
export interface AudioPosition { x: number; y: number; z: number }
export interface SoundSource {
  position?: AudioPosition;
  /** 0 clear, 1 solid wall. Supplied by the authoritative world's solid visibility query. */
  occlusion?: number;
  gain?: number;
}
export interface AudioVolumes { music: number; effects: number; voice: number }
export const DEFAULT_AUDIO_VOLUMES: Readonly<AudioVolumes> = Object.freeze({ music: .4, effects: .75, voice: .85 });
export type SoundCue =
  | 'step-carpet' | 'step-tile' | 'step-wood' | 'shoe-turn' | 'shoe-stop'
  | 'keyboard' | 'mouse' | 'paper' | 'printer' | 'cup' | 'water'
  | 'chair-sit' | 'chair-drag' | 'chair-roll' | 'chair-threshold' | 'chair-stick' | 'chair-release'
  | 'desk-rise' | 'desk-restore' | 'cake-inflate' | 'cake-restore' | 'pressure-lower' | 'pressure-restore'
  | 'flow-start' | 'flow-stop' | 'wall-transparent' | 'wall-solid'
  | 'pot-pickup' | 'pot-throw' | 'pot-hit-metal' | 'pot-hit-wood' | 'pot-hit-body' | 'pot-land' | 'pot-roll' | 'pot-return'
  | 'light-on' | 'light-off' | 'door-open' | 'door-locked' | 'clock-in' | 'rule-warning'
  | 'computer-enter' | 'computer-exit' | 'computer-move' | 'computer-win' | 'chat-key' | 'chat-arrive' | 'company-hour';
export type VoiceRole = 'leader-broadcast' | 'leader-near' | 'leader-search' | 'colleague' | 'player';
export type VoiceLineId = 'inspect' | 'empty-desk' | 'search' | 'caught' | 'report' | 'escape' | 'release' | 'complaint';
export interface SpeechLine {
  role: VoiceRole;
  line: VoiceLineId | 'rule';
  /** Rule declarations use the exact visible authoritative text. Never narrate chat automatically. */
  text?: string;
  priority?: 1 | 2 | 3;
}
export type OfficeAudioEvent =
  | { id: string; kind: 'cue'; cue: SoundCue; source?: SoundSource }
  | { id: string; kind: 'speech'; speech: SpeechLine; source?: SoundSource }
  | { id: string; kind: 'rule'; rule: AudioRule; phase: 'warning' | 'active' | 'restore'; text?: string; source?: SoundSource };
export interface OfficeAudioFrame {
  /** False for pause, background, loading, or inactive page. No sounds are queued while false. */
  active: boolean;
  listener: AudioPosition & { yaw: number };
  room: AudioRoom;
  /** Adapter chooses this only from player-observable events, never hidden enemy distance. */
  mood: MusicMood;
  /** Optional full-screen computer attenuation. Interface reserved until its gameplay exists. */
  computer?: boolean;
}
export interface AudioDiagnostics {
  unlocked: boolean; running: boolean; disposed: boolean;
  contextState: string; activeSounds: number; scheduledTimer: boolean;
  eventsPlayed: number; eventsDropped: number; speechPlayed: number;
  localChineseVoices: number; voiceStatus: 'unavailable' | 'available' | 'speaking';
  lastError: string | null; mood: MusicMood; volumes: AudioVolumes;
}
export interface OfficeAudio {
  /** Call directly in a trusted start/resume click. Resolves false if browser refuses audio. */
  resume(): Promise<boolean>;
  update(frame: OfficeAudioFrame, events?: readonly OfficeAudioEvent[]): void;
  setVolumes(volumes: Partial<AudioVolumes>): void;
  pause(): void;
  /** New round: stops old sources/voice, clears event identities and musical phrase. Keeps volume. */
  reset(): void;
  dispose(): Promise<void>;
  getDiagnostics(): AudioDiagnostics;
}
export function normalizeAudioVolumes(value: Partial<AudioVolumes> | null | undefined): AudioVolumes {
  const finite = (key: keyof AudioVolumes) => typeof value?.[key] === 'number' && Number.isFinite(value[key])
    ? Math.max(0, Math.min(1, value[key]!)) : DEFAULT_AUDIO_VOLUMES[key];
  return { music: finite('music'), effects: finite('effects'), voice: finite('voice') };
}
