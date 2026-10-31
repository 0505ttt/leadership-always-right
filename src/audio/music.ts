import type { MusicMood } from './types';
export const MUSIC_MIX: Record<MusicMood, [number, number, number, number]> = {
  office: [.12, .12, .075, .015], inspection: [.08, .12, .025, .065], pursuit: [.1, .2, .055, .17],
  release: [.12, .11, .1, .015], success: [.17, .17, .18, .045], computer: [.06, .1, .1, .04],
};
export type MusicLayer = 'bed' | 'bass' | 'melody' | 'rhythm';
export type MusicNote = { kind: 'note'; midi: number; instrument: 'keys' | 'pad' | 'bass' | 'tick'; layer: MusicLayer; duration: number; gain: number } | { kind: 'paper'; layer: 'rhythm'; gain: number };
// Original motif with one chromatic approach; all moods retain one continuous 48-second form.
const MOTIF = [72, 76, 79, 78, 76, 74, 71, 72, 74, 77, 76, 72, 71, 69, 67, 71] as const;
export function planMusicBeat(beat: number, mood: MusicMood): MusicNote[] {
  const result: MusicNote[] = [], step = beat % 128, phrase = Math.floor(step / 32), index = step % 16;
  const chordRoot = [48, 53, 50, 55][Math.floor(step / 8) % 4];
  const note = (midi: number, instrument: 'keys' | 'pad' | 'bass' | 'tick', layer: MusicLayer, duration: number, gain = 1) => result.push({ kind: 'note', midi, instrument, layer, duration, gain });
  if (step % 8 === 0) for (const offset of [12, 16, 19]) note(chordRoot + offset, 'pad', 'bed', 2.8, .65);
  if (step % 4 === 0) note(chordRoot - 12, 'bass', 'bass', 1.15);
  if (mood === 'success' || mood === 'computer' || (phrase !== 2 && step % 2 === 0)) note(MOTIF[index] + (phrase === 1 ? -12 : 0), 'keys', 'melody', .85);
  if (mood === 'pursuit' || mood === 'inspection' || step % 4 === 2) {
    note(step % 4 === 0 ? 43 : 76, 'tick', 'rhythm', .13, step % 4 === 0 ? 1 : .45);
    if (mood === 'pursuit' && step % 2 === 1) result.push({ kind: 'paper', layer: 'rhythm', gain: .2 });
  }
  return result;
}
