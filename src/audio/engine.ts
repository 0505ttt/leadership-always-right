import { DEFAULT_AUDIO_VOLUMES, normalizeAudioVolumes, type AudioDiagnostics, type AudioRoom, type AudioVolumes, type MusicMood, type OfficeAudio, type OfficeAudioEvent, type OfficeAudioFrame, type SoundCue, type SoundSource, type SpeechLine, type VoiceLineId } from './types';
import { synthesizeCue, synthesizeNote, synthesizeRoom, synthesizeImpulse, type PcmSound } from './synthesis';
import { MUSIC_MIX, planMusicBeat } from './music';

type Layer = 'bed' | 'bass' | 'melody' | 'rhythm' | 'effects' | 'ambience';
interface PlayingSound { source: AudioBufferSourceNode; nodes: AudioNode[]; priority: number; finish(): void }
export interface AudioDependencies {
  context?: () => AudioContext;
  speech?: SpeechSynthesis;
  utterance?: (text: string) => SpeechSynthesisUtterance;
  document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}
const MAX_SOURCES = 56, MAX_EVENT_IDS = 12000;
const VOICE_LINES: Record<VoiceLineId, readonly string[]> = {
  inspect: ['我看看大家落实得怎么样。', '进度先不说，态度要看得见。', '辛苦各位，我随便看看。'],
  'empty-desk': ['位置还在，人呢？', '椅子比人更有责任心。', '这个工位，思想有点松动。'],
  search: ['现在开始逐项核实。', '落实不到人，就找到人落实。', '别急着下班，先把口径对齐。'],
  caught: ['原来你在这里。', '先回工位，我们慢慢沟通。', '这么积极，是要去哪里？'],
  report: ['领导，这边需要您确认一下。', '我只是如实反馈一个情况。', '这个情况，还是向上同步一下。'],
  escape: ['今天的闭环，到这里结束。', '我先落实一下自己的下班。', '门外的空气，不用审批。'],
  release: ['这个问题，暂时先这样。', '大家继续保持。', '下一步，再看实际情况。'],
  complaint: ['这下真是站着挣钱了。', '流程已经走到了我身上。', '有些饼，确实越来越大了。'],
};
const VOICE_COOLDOWNS: Record<VoiceLineId | 'rule', number> = { inspect: 18, 'empty-desk': 12, search: 14, caught: 15, report: 20, escape: 30, release: 25, complaint: 38, rule: 3 };
const RULE_CUES: Record<string, [SoundCue, SoundCue]> = {
  cake: ['cake-inflate', 'cake-restore'], desk: ['desk-rise', 'desk-restore'], pot: ['pot-land', 'pot-return'],
  return: ['chair-stick', 'chair-release'], flow: ['flow-start', 'flow-stop'], transparent: ['wall-transparent', 'wall-solid'], pressure: ['pressure-lower', 'pressure-restore'], bed: ['pressure-lower', 'pressure-restore'],
};
const finite = (n: number) => Number.isFinite(n);
const clamp = (n: number, fallback = 0) => finite(n) ? Math.max(0, Math.min(1, n)) : fallback;

export function createOfficeAudio(initial: Partial<AudioVolumes> = DEFAULT_AUDIO_VOLUMES, dependencies: AudioDependencies = {}): OfficeAudio {
  let volumes = normalizeAudioVolumes(initial), context: AudioContext | undefined, master: GainNode | undefined, compressor: DynamicsCompressorNode | undefined, reverb: ConvolverNode | undefined, reverbSend: GainNode | undefined;
  const layers = new Map<Layer, GainNode>(), buffers = new Map<string, AudioBuffer>(), playing = new Set<PlayingSound>();
  const gainTargets = new WeakMap<AudioParam, number>();
  const seen = new Set<string>(), cooldowns = new Map<string, number>(), variants = new Map<string, number>();
  const doc = dependencies.document ?? (typeof document === 'undefined' ? undefined : document);
  const speech = dependencies.speech ?? (typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis);
  const makeUtterance = dependencies.utterance ?? ((text: string) => new SpeechSynthesisUtterance(text));
  const scheduleInterval = dependencies.setInterval ?? globalThis.setInterval;
  const cancelInterval = dependencies.clearInterval ?? globalThis.clearInterval;
  let interval: ReturnType<typeof setInterval> | undefined, frame: OfficeAudioFrame | undefined;
  let transition: Promise<void> | undefined, unlocked = false, manualPause = true, disposed = false;
  let lastError: string | null = null, eventsPlayed = 0, eventsDropped = 0, speechPlayed = 0;
  let nextBeat = 0, beatIndex = 0, warningUntil = 0, room: AudioRoom | undefined, roomSound: PlayingSound | undefined;
  let localVoices: SpeechSynthesisVoice[] = [], utterance: SpeechSynthesisUtterance | undefined, speechPriority = 0, speechDeadline = 0, speechGeneration = 0;
  const runningWanted = () => !disposed && unlocked && !manualPause && !!frame?.active && !doc?.hidden;
  const error = (cause: unknown) => { lastError = cause instanceof Error ? cause.message : String(cause); };
  const time = () => context?.currentTime ?? 0;
  const remember = (event: OfficeAudioEvent) => {
    if (!event.id || seen.has(event.id)) return false;
    // Fail closed instead of evicting old IDs and replaying them later in the same round.
    if (seen.size >= MAX_EVENT_IDS) { eventsDropped++; return false; }
    seen.add(event.id); return true;
  };
  function refreshVoices() {
    try { localVoices = speech?.getVoices().filter(voice => voice.localService && /^zh(?:[-_]|$)/i.test(voice.lang)) ?? []; }
    catch (cause) { localVoices = []; error(cause); }
  }
  function stopSpeech() {
    speechGeneration++;
    if (utterance) { utterance.onend = null; utterance.onerror = null; try { speech?.cancel(); } catch (cause) { error(cause); } }
    utterance = undefined; speechPriority = 0; speechDeadline = 0;
  }
  function stopSound(sound: PlayingSound) {
    try { sound.source.stop(); } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'InvalidStateError')) error(cause); }
    sound.finish();
  }
  function stopRuntime() {
    if (interval !== undefined) { cancelInterval(interval); interval = undefined; }
    stopSpeech();
    for (const sound of [...playing]) stopSound(sound);
    room = undefined; roomSound = undefined; nextBeat = 0; warningUntil = 0;
  }
  function gain(param: AudioParam, value: number, smoothing = .12) {
    if (gainTargets.get(param) === value) return;
    gainTargets.set(param, value);
    param.cancelScheduledValues(time()); param.setTargetAtTime(value, time(), smoothing);
  }
  function applyMix() {
    if (!context || !frame) return;
    const duck = utterance || time() < warningUntil ? .2 : 1;
    const [bed, bass, melody, rhythm] = MUSIC_MIX[frame.mood];
    if (reverbSend) gain(reverbSend.gain, frame.room === 'meeting' ? .13 : .018, .2);
    const music = volumes.music * duck * (frame.computer ? .45 : 1);
    for (const [layer, amount] of [['bed', bed], ['bass', bass], ['melody', melody], ['rhythm', rhythm]] as const) gain(layers.get(layer)!.gain, amount * music);
    gain(layers.get('effects')!.gain, volumes.effects * .7, .04);
    gain(layers.get('ambience')!.gain, volumes.effects * .6 * (utterance ? .22 : 1) * (frame.computer ? .25 : 1));
  }
  function audioBuffer(key: string, render: () => PcmSound): AudioBuffer {
    const cached = buffers.get(key); if (cached) return cached;
    const pcm = render(), buffer = context!.createBuffer(1, pcm.samples.length, pcm.sampleRate);
    buffer.copyToChannel(pcm.samples, 0); buffers.set(key, buffer); return buffer;
  }
  function play(buffer: AudioBuffer, layer: Layer, when: number, source: SoundSource = {}, loop = false, priority = 1): PlayingSound | undefined {
    if (!runningWanted() || !context || context.state !== 'running') return undefined;
    if (playing.size >= MAX_SOURCES) {
      const victim = [...playing].find(sound => sound.priority < priority);
      if (!victim) { eventsDropped++; return undefined; }
      stopSound(victim);
    }
    if (source.position && ![source.position.x, source.position.y, source.position.z].every(finite)) { eventsDropped++; return undefined; }
    const input = context.createBufferSource(), volume = context.createGain(), nodes: AudioNode[] = [input, volume];
    const occlusion = clamp(source.occlusion ?? 0), amount = clamp(source.gain ?? 1, 1);
    volume.gain.value = amount * (1 - occlusion * .62);
    input.buffer = buffer; input.loop = loop;
    let tail: AudioNode = input;
    if (occlusion > .01) {
      const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 12500 - occlusion * 11750; filter.Q.value = .5;
      tail.connect(filter); tail = filter; nodes.push(filter);
    }
    if (source.position) {
      const panner = context.createPanner(); panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 1.8; panner.maxDistance = 26; panner.rolloffFactor = 1.25;
      panner.positionX.value = source.position.x; panner.positionY.value = source.position.y; panner.positionZ.value = source.position.z;
      tail.connect(panner); tail = panner; nodes.push(panner);
    }
    tail.connect(volume); volume.connect(layers.get(layer)!);
    let finished = false;
    const sound: PlayingSound = { source: input, nodes, priority, finish() {
      if (finished) return; finished = true; input.onended = null; playing.delete(sound);
      for (const node of nodes) node.disconnect();
    } };
    input.onended = sound.finish; playing.add(sound);
    try { input.start(when); if (!loop) input.stop(when + buffer.duration + .01); }
    catch (cause) { sound.finish(); error(cause); return undefined; }
    return sound;
  }
  function nextVariant(key: string) { const value = variants.get(key) ?? 0; variants.set(key, value + 1); return value % 3; }
  function cue(cueName: SoundCue, source?: SoundSource) {
    if (volumes.effects === 0) return;
    const now = time(), last = cooldowns.get(`cue:${cueName}`) ?? -Infinity;
    const cooldown = cueName.startsWith('step-') ? .018 : cueName === 'keyboard' ? .035 : .045;
    if (now - last < cooldown) { eventsDropped++; return; }
    cooldowns.set(`cue:${cueName}`, now);
    const variant = nextVariant(cueName);
    if (play(audioBuffer(`cue:${cueName}:${variant}`, () => synthesizeCue(cueName, variant)), 'effects', now + .005, source, false, 3)) eventsPlayed++;
  }
  function speak(line: SpeechLine, source: SoundSource = {}) {
    if (!speech || volumes.voice === 0 || !runningWanted()) return;
    refreshVoices(); if (!localVoices.length) return;
    const now = time(), key = `${line.role}:${line.line}`, priority = line.priority ?? (line.line === 'rule' ? 3 : line.line === 'complaint' || line.line === 'inspect' ? 1 : 2);
    if (now - (cooldowns.get(key) ?? -Infinity) < VOICE_COOLDOWNS[line.line]) { eventsDropped++; return; }
    if (utterance && priority <= speechPriority) { eventsDropped++; return; }
    const options = line.line === 'rule' ? [] : VOICE_LINES[line.line];
    const text = (line.text ?? options[nextVariant(key) % options.length] ?? '').trim().slice(0, 120);
    if (!text) return;
    let attenuation = 1;
    if (source.position && frame) {
      const distance = Math.hypot(source.position.x - frame.listener.x, source.position.z - frame.listener.z);
      attenuation = 1 / (1 + .065 * distance * distance);
    }
    attenuation *= 1 - clamp(source.occlusion ?? 0) * .7;
    if (attenuation < .035) return;
    stopSpeech(); const generation = speechGeneration;
    const sentence = makeUtterance(text), voiceIndex = line.role === 'colleague' ? 1 : line.role === 'player' ? 2 : 0;
    sentence.voice = localVoices[voiceIndex % localVoices.length]; sentence.lang = sentence.voice.lang;
    sentence.pitch = line.role === 'colleague' ? 1.1 : line.role === 'player' ? 1.04 : .85;
    sentence.rate = line.role === 'leader-search' ? 1.08 : line.role === 'leader-broadcast' ? .92 : 1;
    sentence.volume = clamp(volumes.voice * attenuation * clamp(source.gain ?? 1, 1));
    sentence.onend = () => { if (generation === speechGeneration) { utterance = undefined; speechPriority = 0; applyMix(); } };
    sentence.onerror = event => { if (generation === speechGeneration) { if (event.error !== 'canceled' && event.error !== 'interrupted') error(`Speech synthesis: ${event.error}`); utterance = undefined; speechPriority = 0; applyMix(); } };
    utterance = sentence; speechPriority = priority; speechDeadline = now + Math.min(24, Math.max(5, text.length * .5)); cooldowns.set(key, now);
    try { speech.speak(sentence); speechPlayed++; } catch (cause) { stopSpeech(); error(cause); }
    applyMix();
  }
  function dispatch(event: OfficeAudioEvent) {
    if (!remember(event)) return;
    if (!runningWanted() || context?.state !== 'running') { eventsDropped++; return; }
    if (event.kind === 'cue') cue(event.cue, event.source);
    else if (event.kind === 'speech') speak(event.speech, event.source);
    else if (event.phase === 'warning') {
      warningUntil = time() + .9; cue('rule-warning');
      if (event.text) speak({ role: 'leader-broadcast', line: 'rule', text: event.text, priority: 3 });
    } else cue(RULE_CUES[event.rule][event.phase === 'active' ? 0 : 1], event.source);
  }
  function musicBeat(at: number) {
    if (!frame || volumes.music === 0) { beatIndex++; return; }
    for (const item of planMusicBeat(beatIndex, frame.mood)) {
      const buffer = item.kind === 'note'
        ? audioBuffer(`note:${item.midi}:${item.instrument}:${item.duration}`, () => synthesizeNote(item.midi, item.instrument, item.duration))
        : audioBuffer('percussion:paper', () => synthesizeCue('paper', 1));
      play(buffer, item.layer, at, { gain: item.gain }, false, 1);
    }
    beatIndex++;
  }
  function updateRoom() {
    if (!frame || room === frame.room || !context) return;
    if (roomSound) {
      const old = roomSound, volume = old.nodes[1] as GainNode;
      gain(volume.gain, 0, .12); try { old.source.stop(time() + .4); } catch (cause) { error(cause); old.finish(); }
    }
    room = frame.room;
    roomSound = play(audioBuffer(`room:${room}`, () => synthesizeRoom(room!)), 'ambience', time(), {}, true, 2);
    if (roomSound) { const volume = roomSound.nodes[1] as GainNode; volume.gain.value = 0; gain(volume.gain, 1, .25); }
  }
  function tick() {
    if (!runningWanted() || context?.state !== 'running') { stopRuntime(); return; }
    if (utterance && time() > speechDeadline) stopSpeech();
    applyMix(); updateRoom();
    if (nextBeat === 0 || time() - nextBeat > .4) nextBeat = time() + .025;
    let budget = 0;
    while (nextBeat < time() + .14 && budget++ < 3) { musicBeat(nextBeat); nextBeat += .375; }
  }
  function startRuntime() { if (interval === undefined && runningWanted()) { tick(); interval = scheduleInterval(tick, 40); } }
  function synchronizeContext() {
    if (!context || disposed || !unlocked || transition) return;
    const wanted = runningWanted();
    if (wanted && context.state === 'running') { startRuntime(); return; }
    if (!wanted) stopRuntime();
    if (!wanted && context.state === 'suspended') return;
    const operation = wanted ? context.resume() : context.suspend();
    transition = operation;
    void operation.then(() => {
      if (transition === operation) transition = undefined;
      if (disposed) return;
      if (runningWanted() !== wanted) synchronizeContext(); else if (wanted) startRuntime();
    }, cause => { if (transition === operation) transition = undefined; error(cause); unlocked = false; stopRuntime(); });
  }
  function initializeContext() {
    context = dependencies.context?.() ?? new AudioContext({ latencyHint: 'interactive' });
    master = context.createGain(); master.gain.value = .8;
    compressor = context.createDynamicsCompressor(); compressor.threshold.value = -16; compressor.knee.value = 14; compressor.ratio.value = 4; compressor.attack.value = .006; compressor.release.value = .2;
    master.connect(compressor); compressor.connect(context.destination);
    for (const name of ['bed', 'bass', 'melody', 'rhythm', 'effects', 'ambience'] as const) {
      const node = context.createGain(); node.gain.value = 0; node.connect(master); layers.set(name, node);
    }
    reverb = context.createConvolver(); reverb.normalize = false;
    reverb.buffer = audioBuffer('room:impulse', () => synthesizeImpulse(context!.sampleRate));
    reverbSend = context.createGain(); reverbSend.gain.value = .018;
    layers.get('effects')!.connect(reverbSend); reverbSend.connect(reverb); reverb.connect(master);
    refreshVoices();
  }
  const visibility = () => { if (doc?.hidden) { stopRuntime(); synchronizeContext(); } };
  doc?.addEventListener('visibilitychange', visibility);
  speech?.addEventListener('voiceschanged', refreshVoices);
  const api: OfficeAudio = {
    async resume() {
      if (disposed) return false;
      manualPause = false;
      try {
        if (!context) initializeContext();
        // This invocation is intentionally synchronous within the user gesture.
        const operation = context!.resume(); transition = operation; unlocked = true;
        await operation;
        if (transition === operation) transition = undefined;
        if (disposed) return false;
        synchronizeContext(); return true;
      } catch (cause) { transition = undefined; unlocked = false; error(cause); stopRuntime(); return false; }
    },
    update(next, events = []) {
      if (disposed) return;
      if (![next.listener.x, next.listener.y, next.listener.z, next.listener.yaw].every(finite)) { error('Non-finite audio listener'); api.pause(); return; }
      frame = { ...next, listener: { ...next.listener } };
      if (context) {
        const listener = context.listener;
        listener.positionX.value = next.listener.x; listener.positionY.value = next.listener.y; listener.positionZ.value = next.listener.z;
        listener.forwardX.value = Math.sin(next.listener.yaw); listener.forwardY.value = 0; listener.forwardZ.value = Math.cos(next.listener.yaw);
        listener.upX.value = 0; listener.upY.value = 1; listener.upZ.value = 0;
      }
      if (!runningWanted()) stopRuntime();
      synchronizeContext();
      for (const event of events) dispatch(event);
      if (runningWanted()) applyMix();
    },
    setVolumes(next) { volumes = normalizeAudioVolumes({ ...volumes, ...next }); if (volumes.voice === 0) stopSpeech(); applyMix(); },
    pause() { manualPause = true; stopRuntime(); synchronizeContext(); },
    reset() { manualPause = true; stopRuntime(); frame = undefined; seen.clear(); cooldowns.clear(); variants.clear(); beatIndex = 0; synchronizeContext(); },
    async dispose() {
      if (disposed) return;
      disposed = true; stopRuntime(); doc?.removeEventListener('visibilitychange', visibility); speech?.removeEventListener('voiceschanged', refreshVoices);
      buffers.clear(); seen.clear(); cooldowns.clear(); variants.clear();
      for (const layer of layers.values()) layer.disconnect(); layers.clear(); master?.disconnect(); compressor?.disconnect(); reverbSend?.disconnect(); reverb?.disconnect();
      if (context && context.state !== 'closed') try { await context.close(); } catch (cause) { error(cause); }
    },
    getDiagnostics(): AudioDiagnostics { return {
      unlocked, running: runningWanted() && context?.state === 'running', disposed, contextState: context?.state ?? 'uninitialized', activeSounds: playing.size,
      scheduledTimer: interval !== undefined, eventsPlayed, eventsDropped, speechPlayed, localChineseVoices: localVoices.length,
      voiceStatus: utterance ? 'speaking' : localVoices.length ? 'available' : 'unavailable', lastError, mood: frame?.mood ?? 'office', volumes: { ...volumes },
    }; },
  };
  return api;
}
