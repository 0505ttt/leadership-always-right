import { describe, expect, it } from 'vitest';
import { createOfficeAudio } from '../src/audio/engine';
import { normalizeAudioVolumes, type OfficeAudioFrame, type OfficeAudioEvent } from '../src/audio/types';
import { synthesizeCue, synthesizeNote, synthesizeRoom } from '../src/audio/synthesis';

class Param {
  value = 0; targets: number[] = [];
  cancelScheduledValues() { return this; }
  setTargetAtTime(value: number) { this.value = value; this.targets.push(value); return this; }
}
class Node {
  connected: Node[] = []; disconnected = 0;
  connect(node: Node) { this.connected.push(node); return node; }
  disconnect() { this.connected = []; this.disconnected++; }
}
class Gain extends Node { gain = new Param(); }
class BufferData {
  duration: number; channel: Float32Array;
  constructor(length: number, public sampleRate: number) { const rate=sampleRate; this.duration = length / rate; this.channel = new Float32Array(length); }
  copyToChannel(data: Float32Array) { this.channel.set(data); }
}
class Source extends Node {
  buffer?: BufferData; loop = false; onended: (() => void) | null = null; startTime = 0; endTime = Infinity; started = false; stopped = 0;
  constructor(private clock: FakeContext) { super(); }
  start(at: number) { this.startTime = at; this.started = true; }
  stop(at?: number) { this.stopped++; this.endTime = at ?? this.clock.currentTime; if (at === undefined) this.finish(); }
  finish() { const cb = this.onended; this.onended = null; cb?.(); }
}
class FakeContext {
  sampleRate=48000; state: AudioContextState = 'suspended'; currentTime = 0; destination = new Node(); sources: Source[] = []; gains: Gain[] = []; filters: (Node & { type: string; frequency: Param; Q: Param })[] = [];
  panners: (Node & { panningModel: string; distanceModel: string; refDistance: number; maxDistance: number; rolloffFactor: number; positionX: Param; positionY: Param; positionZ: Param })[] = [];
  listener = { positionX: new Param(), positionY: new Param(), positionZ: new Param(), forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(), upX: new Param(), upY: new Param(), upZ: new Param() };
  resumeCalls = 0; suspendCalls = 0; closeCalls = 0; rejectResume = false; holdResume = false; finishResume?: () => void;
  createGain() { const value = new Gain(); this.gains.push(value); return value; }
  createDynamicsCompressor() { return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() }); }
  createConvolver() { const rate=this.sampleRate;let data:BufferData|undefined;return Object.defineProperty(Object.assign(new Node(),{normalize:false}),'buffer',{get:()=>data,set:(value:BufferData|undefined)=>{if(value&&value.sampleRate!==rate)throw new Error('Convolver rate mismatch');data=value;}}); }
  createBuffer(_channels: number, length: number, rate: number) { return new BufferData(length, rate); }
  createBufferSource() { const source = new Source(this); this.sources.push(source); return source; }
  createBiquadFilter() { const filter = Object.assign(new Node(), { type: '', frequency: new Param(), Q: new Param() }); this.filters.push(filter); return filter; }
  createPanner() { const panner = Object.assign(new Node(), { panningModel: '', distanceModel: '', refDistance: 0, maxDistance: 0, rolloffFactor: 0, positionX: new Param(), positionY: new Param(), positionZ: new Param() }); this.panners.push(panner); return panner; }
  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.rejectResume) return Promise.reject(new Error('gesture denied'));
    if (this.holdResume) return new Promise(resolve => { this.finishResume = () => { if (this.state !== 'closed') this.state = 'running'; resolve(); }; });
    this.state = 'running'; return Promise.resolve();
  }
  suspend() { this.suspendCalls++; this.state = 'suspended'; return Promise.resolve(); }
  close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
  advance(seconds: number) { this.currentTime += seconds; for (const source of this.sources) if (source.endTime <= this.currentTime) source.finish(); }
}
class Speech {
  voices = [{ name: 'Local Mandarin', lang: 'zh-CN', localService: true }, { name: 'Local Mandarin 2', lang: 'zh-TW', localService: true }, { name: 'Cloud Mandarin', lang: 'zh-CN', localService: false }];
  spoken: SpeechSynthesisUtterance[] = []; cancelCalls = 0; listeners = new Set<() => void>();
  getVoices() { return this.voices; }
  speak(line: SpeechSynthesisUtterance) { this.spoken.push(line); }
  cancel() { this.cancelCalls++; }
  addEventListener(_event: string, callback: () => void) { this.listeners.add(callback); }
  removeEventListener(_event: string, callback: () => void) { this.listeners.delete(callback); }
}
const active: OfficeAudioFrame = { active: true, listener: { x: 0, y: 1.4, z: 0, yaw: 0 }, room: 'work', mood: 'office' };
const event = (id = 'step'): OfficeAudioEvent => ({ id, kind: 'cue', cue: 'step-carpet' });
function harness() {
  const context = new FakeContext(), speech = new Speech(), timers = new Map<number, () => void>(), visibleListeners = new Set<() => void>(); let timerId = 0;
  const document = { hidden: false, addEventListener(_event: string, fn: () => void) { visibleListeners.add(fn); }, removeEventListener(_event: string, fn: () => void) { visibleListeners.delete(fn); } };
  const audio = createOfficeAudio(undefined, {
    context: () => context as unknown as AudioContext,
    speech: speech as unknown as SpeechSynthesis,
    utterance: text => ({ text, onend: null, onerror: null }) as SpeechSynthesisUtterance,
    document: document as unknown as Document,
    setInterval: ((fn: () => void) => { const id = ++timerId; timers.set(id, fn); return id; }) as unknown as typeof setInterval,
    clearInterval: ((id: number) => { timers.delete(id); }) as unknown as typeof clearInterval,
  });
  const tick = (seconds = .04) => { context.advance(seconds); for (const fn of [...timers.values()]) fn(); };
  return { audio, context, speech, timers, document, visibleListeners, tick };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

it('does not initialize audio or retain events before a user gesture', async () => {
  const h = harness(); h.audio.update(active, [event('before')]);
  expect(h.audio.getDiagnostics().contextState).toBe('uninitialized'); expect(h.context.resumeCalls).toBe(0);
  expect(await h.audio.resume()).toBe(true); h.audio.update(active, [event('before'), event('after')]);
  expect(h.audio.getDiagnostics().eventsPlayed).toBe(1); expect(h.timers.size).toBe(1);
  await h.audio.dispose();
});
it('deduplicates event identity and clears identity only on a new round', async () => {
  const h = harness(); h.audio.update(active); await h.audio.resume();
  h.audio.update(active, [event('same'), event('same')]); h.tick(.5); h.audio.update(active, [event('same')]);
  expect(h.audio.getDiagnostics().eventsPlayed).toBe(1);
  h.audio.reset(); expect(h.timers.size).toBe(0); expect(h.audio.getDiagnostics().activeSounds).toBe(0);
  h.audio.update(active); await h.audio.resume(); h.audio.update(active, [event('same')]);
  expect(h.audio.getDiagnostics().eventsPlayed).toBe(2); await h.audio.dispose();
});
it('stops all sources and timers on pause, drops paused events, and resumes without a backlog', async () => {
  const h = harness(); h.audio.update(active); await h.audio.resume(); h.audio.update(active, [event('one')]);
  h.audio.pause(); await flush(); expect(h.context.state).toBe('suspended'); expect(h.timers.size).toBe(0); expect(h.audio.getDiagnostics().activeSounds).toBe(0);
  h.audio.update({ ...active, active: false }, [event('paused')]);
  await h.audio.resume(); expect(h.timers.size).toBe(0);
  h.audio.update(active, [event('paused')]); await flush(); expect(h.audio.getDiagnostics().eventsPlayed).toBe(1);
  expect(h.timers.size).toBe(1); await h.audio.dispose();
});
it('honors pause that arrives while the browser resume promise is pending', async () => {
  const h = harness(); h.context.holdResume = true; h.audio.update(active);
  const resumed = h.audio.resume(); h.audio.pause(); h.context.finishResume!(); await resumed; await flush();
  expect(h.context.state).toBe('suspended'); expect(h.timers.size).toBe(0); await h.audio.dispose();
});
it('reports autoplay failure and stays silent without retrying every frame', async () => {
  const h = harness(); h.context.rejectResume = true; h.audio.update(active); expect(await h.audio.resume()).toBe(false);
  for (let i = 0; i < 20; i++) h.audio.update(active);
  expect(h.context.resumeCalls).toBe(1); expect(h.audio.getDiagnostics().lastError).toContain('gesture denied'); expect(h.timers.size).toBe(0); await h.audio.dispose();
});
it('cancels speech on pause and permits only a higher-priority line to interrupt', async () => {
  const h = harness(); h.audio.update(active); await h.audio.resume();
  h.audio.update(active, [{ id: 'idle', kind: 'speech', speech: { role: 'colleague', line: 'complaint' } }]);
  expect(h.speech.spoken).toHaveLength(1); const oldEnd = h.speech.spoken[0].onend;
  h.audio.update(active, [{ id: 'low', kind: 'speech', speech: { role: 'leader-near', line: 'inspect' } }]); expect(h.speech.spoken).toHaveLength(1);
  h.audio.update(active, [{ id: 'rule', kind: 'rule', rule: 'desk', phase: 'warning', text: '把工作标准提高。' }]);
  expect(h.speech.spoken).toHaveLength(2); expect(h.speech.cancelCalls).toBe(1);
  oldEnd?.call(h.speech.spoken[0], {} as SpeechSynthesisEvent);
  expect(h.audio.getDiagnostics().voiceStatus).toBe('speaking');
  h.audio.pause(); expect(h.speech.cancelCalls).toBe(2); expect(h.audio.getDiagnostics().voiceStatus).toBe('available'); await h.audio.dispose();
});
it('uses only local Chinese voices, respects voice cooldown, and immediately cancels at zero volume', async () => {
  const h = harness(); h.audio.update(active); await h.audio.resume();
  const speechEvent: OfficeAudioEvent = { id: 'inspection-1', kind: 'speech', speech: { role: 'leader-near', line: 'inspect' } };
  h.audio.update(active, [speechEvent]); expect(h.speech.spoken[0].voice?.localService).toBe(true); expect(h.audio.getDiagnostics().localChineseVoices).toBe(2);
  h.speech.spoken[0].onend?.call(h.speech.spoken[0], {} as SpeechSynthesisEvent);
  h.tick(1); h.audio.update(active, [{ ...speechEvent, id: 'inspection-2' }]); expect(h.speech.spoken).toHaveLength(1);
  h.tick(20); h.audio.update(active, [{ ...speechEvent, id: 'inspection-3' }]); expect(h.speech.spoken).toHaveLength(2);
  h.audio.setVolumes({ voice: 0 }); expect(h.speech.cancelCalls).toBe(1);
  h.audio.update(active, [{ id: 'muted', kind: 'rule', rule: 'flow', phase: 'warning', text: '流程倒着走。' }]); expect(h.speech.spoken).toHaveLength(2); await h.audio.dispose();
});
it('does not silently use a cloud voice when no installed Chinese voice exists', async () => {
  const h = harness(); h.speech.voices = h.speech.voices.filter(v => !v.localService); h.audio.update(active); await h.audio.resume();
  h.audio.update(active, [{ id: 'rule', kind: 'rule', rule: 'desk', phase: 'warning', text: '提高标准。' }]);
  expect(h.speech.spoken).toHaveLength(0); expect(h.audio.getDiagnostics().voiceStatus).toBe('unavailable'); expect(h.audio.getDiagnostics().eventsPlayed).toBe(1); await h.audio.dispose();
});
it('places real event sound in space and muffles a solid-wall path without mutating the input', async () => {
  const h = harness(); h.audio.update(active); await h.audio.resume();
  const source = { position: { x: 4, y: 0, z: 2 }, occlusion: 1 }; const before = structuredClone(source);
  h.audio.update(active, [{ id: 'spatial', kind: 'cue', cue: 'pot-hit-metal', source }]);
  expect(h.context.panners.at(-1)?.positionX.value).toBe(4); expect(h.context.filters.at(-1)?.frequency.value).toBeLessThan(1000); expect(source).toEqual(before);
  expect(h.audio.getDiagnostics().mood).toBe('office'); await h.audio.dispose();
});
it('pauses automatically on document hiding and removes listeners at disposal', async () => {
  const h = harness(); h.audio.update(active); await h.audio.resume(); h.document.hidden = true; for (const fn of h.visibleListeners) fn(); await flush();
  expect(h.timers.size).toBe(0); expect(h.audio.getDiagnostics().activeSounds).toBe(0);
  h.document.hidden = false; for (const fn of h.visibleListeners) fn(); expect(h.timers.size).toBe(0);
  h.audio.update(active); await flush(); expect(h.timers.size).toBe(1);
  await h.audio.dispose(); await h.audio.dispose(); expect(h.context.closeCalls).toBe(1); expect(h.visibleListeners.size).toBe(0); expect(h.speech.listeners.size).toBe(0); expect(h.timers.size).toBe(0);
});
it('bounds live sources even when a platform never delivers ended callbacks', async () => {
  const h = harness(); h.audio.update(active); await h.audio.resume();
  for (let i = 0; i < 120; i++) { h.context.currentTime += .06; h.audio.update(active, [{ id: `hit-${i}`, kind: 'cue', cue: 'pot-hit-metal' }]); }
  expect(h.audio.getDiagnostics().activeSounds).toBeLessThanOrEqual(56); expect(h.audio.getDiagnostics().eventsDropped).toBeGreaterThan(0);
  h.audio.pause(); expect(h.audio.getDiagnostics().activeSounds).toBe(0); expect(h.context.sources.every(source => source.disconnected === 1)).toBe(true); await h.audio.dispose();
});
it('changes room/mood without resetting the musical clock and keeps volume state independent', async () => {
  const h = harness(); h.audio.update(active); await h.audio.resume(); h.tick(.4);
  const sourceCount = h.context.sources.length; h.audio.setVolumes({ music: .2, effects: .3 });
  h.audio.update({ ...active, room: 'meeting', mood: 'pursuit' }); h.tick(.01);
  expect(h.context.sources.length - sourceCount).toBeLessThanOrEqual(1);
  h.audio.reset(); expect(h.audio.getDiagnostics().volumes).toEqual({ music: .2, effects: .3, voice: .85 });
  const diagnostic = h.audio.getDiagnostics(); diagnostic.volumes.music = 1; expect(h.audio.getDiagnostics().volumes.music).toBe(.2); await h.audio.dispose();
});
it('does not accumulate identical gain automation on every game frame', async () => {
  const h = harness(); h.audio.update(active); await h.audio.resume();
  const scheduled = () => h.context.gains.reduce((count, node) => count + node.gain.targets.length, 0);
  const before = scheduled();
  for (let frame = 0; frame < 120; frame++) h.audio.update(active);
  expect(scheduled()).toBe(before); await h.audio.dispose();
});
it('clamps malformed persisted volume values and never emits non-finite DSP samples', () => {
  expect(normalizeAudioVolumes({ music: 4, effects: -1, voice: Number.NaN })).toEqual({ music: 1, effects: 0, voice: .85 });
  for (const sound of [synthesizeCue('pot-hit-metal', 2), synthesizeCue('cake-inflate'), synthesizeCue('desk-rise'), synthesizeNote(72, 'keys'), synthesizeRoom('tea')]) {
    expect(sound.samples.every(Number.isFinite)).toBe(true); expect(sound.samples.some(n => Math.abs(n) > .01)).toBe(true); expect(sound.samples.every(n => Math.abs(n) <= 1)).toBe(true);
  }
  const a = synthesizeCue('step-wood', 0).samples, b = synthesizeCue('step-wood', 1).samples;
  expect(a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0)).toBeGreaterThan(1);
});
