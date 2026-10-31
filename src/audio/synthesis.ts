import type { AudioRoom, SoundCue } from './types';

export const SYNTHESIS_SAMPLE_RATE = 24000;
const TAU = Math.PI * 2;
function randomGenerator(seed: number) {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
const hash = (text: string) => [...text].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const pulse = (t: number, start: number, decay: number) => t < start ? 0 : Math.exp(-(t - start) * decay);
const attack = (t: number, seconds = .006) => Math.min(1, t / seconds);
const clamp = (sample: number) => Math.max(-.93, Math.min(.93, sample));
export interface PcmSound { samples: Float32Array<ArrayBuffer>; sampleRate: number }

/** Original office theme instruments, generated locally. No third-party recording or melody. */
export function synthesizeNote(midi: number, instrument: 'keys' | 'pad' | 'bass' | 'tick', duration = .8): PcmSound {
  const sampleRate = SYNTHESIS_SAMPLE_RATE, samples = new Float32Array(Math.ceil(duration * sampleRate));
  const hz = 440 * 2 ** ((midi - 69) / 12), random = randomGenerator(midi * 113 + instrument.length);
  let smoothed = 0;
  for (let index = 0; index < samples.length; index++) {
    const t = index / sampleRate, phase = TAU * hz * t;
    smoothed += ((random() * 2 - 1) - smoothed) * .18;
    let value: number;
    if (instrument === 'keys') {
      const tine = Math.sin(phase + .65 * Math.sin(phase * 2.006) * Math.exp(-9 * t));
      value = attack(t) * Math.exp(-5.2 * t) * (tine * .55 + Math.sin(phase * 3.002) * .12 * Math.exp(-9 * t) + smoothed * .11 * Math.exp(-50 * t));
    } else if (instrument === 'pad') {
      const envelope = Math.min(1, t / .13) * Math.min(1, (duration - t) / .28);
      value = envelope * (Math.sin(phase) * .29 + Math.sin(phase * 1.003) * .2 + Math.sin(phase * 2) * .07);
    } else if (instrument === 'bass') {
      value = attack(t, .014) * Math.exp(-3.4 * t) * (Math.sin(phase) * .68 + Math.sin(2 * phase) * .17 + Math.sin(3 * phase) * .05);
    } else {
      value = attack(t, .001) * Math.exp(-62 * t) * (smoothed * .7 + Math.sin(phase) * .22);
    }
    samples[index] = clamp(value * Math.min(1, (duration - t) / .015));
  }
  return { samples, sampleRate };
}

export function soundDuration(cue: SoundCue): number {
  if (cue === 'desk-rise' || cue === 'desk-restore') return 1.5;
  if (cue === 'cake-inflate') return 1.7;
  if (cue === 'pressure-lower' || cue === 'pressure-restore') return 1.35;
  if (cue === 'pot-hit-metal' || cue === 'pot-land') return 1.05;
  if (cue === 'printer') return 1.4;
  if (cue === 'water') return .85;
  if (cue.startsWith('step-') || cue.startsWith('shoe-')) return .22;
  if (cue === 'keyboard' || cue === 'chat-key' || cue === 'mouse') return .11;
  return .68;
}

/** Different variants change material partials, impact timing, envelope and noise, not just pitch. */
export function synthesizeCue(cue: SoundCue, variant = 0): PcmSound {
  const sampleRate = SYNTHESIS_SAMPLE_RATE, duration = soundDuration(cue), samples = new Float32Array(Math.ceil(duration * sampleRate));
  const random = randomGenerator(hash(cue) + variant * 7927), spacing = .026 + variant * .008;
  const variation = 1 + (variant - 1) * .035;
  let low = 0, medium = 0;
  for (let index = 0; index < samples.length; index++) {
    const t = index / sampleRate, noise = random() * 2 - 1;
    low += (noise - low) * .045; medium += (noise - medium) * .26;
    const tonal = (hz: number, decay: number, offset = 0) => t < offset ? 0 : Math.sin(TAU * hz * variation * (t - offset)) * pulse(t, offset, decay);
    let value = 0;
    if (cue.startsWith('step-') || cue.startsWith('shoe-')) {
      const heel = pulse(t, .003, 43), toe = pulse(t, .057 + spacing, 55);
      const surface = cue === 'step-tile' ? .22 : cue === 'step-wood' ? .12 : .035;
      value = low * 2.8 * (heel + toe * .4) + noise * surface * (heel + toe) + tonal(cue === 'step-wood' ? 175 : 93, 30) * .27;
      if (cue === 'shoe-turn') value += medium * .45 * Math.sin(Math.PI * t / duration) ** 2;
      if (cue === 'shoe-stop') value *= .8;
    } else if (cue === 'keyboard' || cue === 'chat-key' || cue === 'mouse') {
      const key = pulse(t, .001, 160) + pulse(t, spacing, 210) * .5;
      value = noise * .28 * key + tonal(1250 + variant * 130, 170) * .3 + tonal(2700 - variant * 170, 220) * .12;
    } else if (cue.includes('pot') || cue === 'cup') {
      if (cue === 'pot-throw' || cue === 'pot-return') {
        const envelope = Math.sin(Math.PI * t / duration) ** 2;
        value = medium * .32 * envelope + tonal(420, 12, .05) * .08;
      } else {
        const hard = cue === 'pot-hit-metal' || cue === 'pot-land' || cue === 'cup';
        const damp = cue === 'pot-hit-body' ? 26 : cue === 'pot-hit-wood' ? 17 : 4.6;
        const impacts = cue === 'pot-roll' ? [0, .11, .22 + spacing, .39, .54] : cue === 'pot-pickup' ? [0, .09] : [0, .06];
        for (const when of impacts) {
          const age = t - when; if (age < 0) continue;
          const body = Math.sin(TAU * 211 * age) + .46 * Math.sin(TAU * (327 + variant * 17) * age) + .25 * Math.sin(TAU * 587 * age) + .13 * Math.sin(TAU * 933 * age);
          value += body * .22 * Math.exp(-damp * age) * attack(age, .002) + noise * (hard ? .17 : .07) * Math.exp(-100 * age);
        }
      }
    } else if (cue.startsWith('desk-') || cue.startsWith('pressure-')) {
      const envelope = Math.min(1, t / .09) * Math.min(1, (duration - t) / .16);
      const speed = cue.endsWith('restore') ? -1 : 1;
      value = envelope * (Math.sin(TAU * (51 * t + speed * 9 * t * t)) * .19 + Math.sin(TAU * 117 * t) * .08 + low * .45);
      value += noise * .1 * (pulse(t, .08, 40) + pulse(t, .48 + spacing, 65));
      value += tonal(310 + variant * 51, 13, duration - .28) * .13;
    } else if (cue.startsWith('cake-')) {
      const envelope = Math.sin(Math.PI * t / duration) ** 2;
      value = envelope * (low * 1.3 + Math.sin(TAU * (64 * t + 32 * t * t) + 1.7 * Math.sin(t * 23)) * .2);
      value += tonal(98, 19, duration * .67) * .2;
    } else if (cue.startsWith('chair-')) {
      const rolling = cue === 'chair-roll';
      value = low * (rolling ? 1.2 : .8) * Math.sin(Math.PI * t / duration) ** 2;
      value += Math.sin(TAU * (145 * t + 50 * t * t) + Math.sin(t * 38)) * (rolling ? .07 : .2) * Math.exp(-4 * t) * attack(t);
      if (cue === 'chair-stick' || cue === 'chair-release') value += tonal(115, 5) * Math.sin(t * 23) * .26;
      if (cue === 'chair-threshold' || cue === 'chair-sit') value += tonal(83, 27) * .37 + noise * pulse(t, .01, 65) * .13;
    } else if (cue === 'printer' || cue === 'paper' || cue === 'water') {
      value = medium * .36 * (Math.sin(Math.PI * t / duration) ** 2);
      if (cue === 'printer') value += (Math.sin(TAU * 94 * t) * .12 + Math.sin(TAU * 245 * t) * .07) * Math.sin(Math.PI * t / duration) ** 2;
      if (cue === 'water') value += Math.sin(TAU * (470 * t + .7 * Math.sin(t * 31))) * .08 * Math.sin(t * 37) ** 2;
    } else if (cue.startsWith('flow-') || cue.startsWith('wall-')) {
      value = medium * .27 * Math.sin(Math.PI * t / duration) ** 2;
      if (cue.startsWith('wall-')) value += tonal(760, 5) * .14 + tonal(1149, 8, .06) * .1;
    } else if (cue.startsWith('door-') || cue.startsWith('light-')) {
      value = noise * pulse(t, .003, 95) * .27 + tonal(110, 29) * .26;
      if (cue === 'door-open') value += medium * .13 * Math.sin(Math.PI * t / duration) ** 2 + tonal(265, 7, .05) * .07;
      if (cue === 'light-on') value += Math.sin(TAU * 100 * t) * .025 * Math.min(1, t * 20);
    } else {
      const first = cue === 'rule-warning' ? 659 : cue === 'door-locked' ? 220 : 523;
      const second = cue === 'computer-win' ? 784 : cue === 'company-hour' ? 698 : 659;
      value = tonal(first, 9) * .3 + tonal(second, 10, .14) * .27;
      value += noise * pulse(t, .001, 130) * .04;
    }
    samples[index] = clamp(value * attack(t, .002) * Math.min(1, (duration - t) / .025));
  }
  return { samples, sampleRate };
}

/** Quiet room beds. Gameplay actions (steps/chairs/pots) are never invented by this generator. */
export function synthesizeRoom(room: AudioRoom): PcmSound {
  const sampleRate = SYNTHESIS_SAMPLE_RATE, duration = 8, samples = new Float32Array(duration * sampleRate);
  const random = randomGenerator(hash(room)); let low = 0;
  for (let index = 0; index < samples.length; index++) {
    const t = index / sampleRate, noise = random() * 2 - 1;
    low += (noise - low) * .012;
    let value = low * .55 + Math.sin(TAU * 60 * t) * .022 + Math.sin(TAU * 121 * t) * .009;
    if (room === 'print') value += Math.sin(TAU * 87 * t) * .035 * Math.sin(Math.PI * t / 4) ** 8;
    if (room === 'tea') value += noise * .015 * Math.sin(Math.PI * t / 8) ** 12;
    if (room === 'meeting') value *= .57;
    if (room === 'storage') value *= .45;
    // Silent seam avoids clicks in a deterministic loop; cross-fading room changes keeps the theme untouched.
    samples[index] = value * Math.min(1, t / .15, (duration - t) / .15);
  }
  return { samples, sampleRate };
}

/** Original short, dark room impulse for modest meeting-room reflections. */
export function synthesizeImpulse(sampleRate = SYNTHESIS_SAMPLE_RATE): PcmSound {
  const samples = new Float32Array(Math.ceil(sampleRate * .48));
  const random = randomGenerator(8841); let low = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate; low += (random() * 2 - 1 - low) * .35;
    samples[i] = t < .018 ? 0 : low * Math.exp(-t * 18) * .065;
  }
  for (const [seconds, amount] of [[.029, .13], [.061, .075], [.094, .045]]) samples[Math.round(seconds * sampleRate)] += amount;
  return { samples, sampleRate };
}
