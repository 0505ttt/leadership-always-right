import type { GameState, Vec2, RuleKind } from '../contracts/game';

export interface RuleMetadata {
  potId?: string;
  sourceOwner?: string;
  warnedForEvidence?: boolean;
}
export interface Runtime {
  random: () => number;
  nextEnvironment: number;
  lastEnvironment: number;
  lastKinds: Partial<Record<RuleKind, number>>;
  nextRuleId: number;
  rules: Map<number, RuleMetadata>;
  orderActive: boolean;
  pendingReturn: boolean;
  workCalm: number;
  eventSerial: number;
  explicitEvent: { id: string; until: number; kind: string } | null;
  observedEvents: Set<string>;
  eventSeenId: string;
  eventSeenFor: number;
  interactionId: string;
  interactionElapsed: number;
  interactionLatched: boolean;
  workingDesk: string | null;
  lastInteractHeld: boolean;
  navTarget: Vec2 | null;
  nextPathAt: number;
  stuckFor: number;
  leaveTarget: Vec2 | null;
  lightUseFor: number;
  dragDistance: number;
  dragSpeed: number;
  dragTravelled: number;
  dragElapsed: number;
  potReturningToHand: Map<string, boolean>;
  throwWindup: Map<string, number>;
  potReleasePosition: Map<string, Vec2>;
  reports: Vec2[];
  propFlights: Map<string, { from: Vec2; to: Vec2; elapsed: number; duration: number }>;
  lastBubbleIndex: number;
  sprintExhausted: boolean;
}

const runtimes = new WeakMap<GameState, Runtime>();

export function seededRandom(seed: number): () => number {
  let value = seed | 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function initRuntime(state: GameState, homeId: string | null): Runtime {
  const random = seededRandom(state.seed ^ 0x1b0a55);
  const runtime: Runtime = {
    random, nextEnvironment: 24 + random() * 12, lastEnvironment: -100,
    lastKinds: {}, nextRuleId: 1, rules: new Map(), orderActive: false,
    pendingReturn: false, workCalm: 0, eventSerial: 0, explicitEvent: null,
    observedEvents: new Set(), eventSeenId: '', eventSeenFor: 0,
    interactionId: '', interactionElapsed: 0, interactionLatched: false,
    workingDesk: homeId, lastInteractHeld: false, navTarget: null,
    nextPathAt: 0, stuckFor: 0, leaveTarget: null, lightUseFor: 0,
    dragDistance: 0, dragSpeed: 0, dragTravelled: 0, dragElapsed: 0,
    potReturningToHand: new Map(), throwWindup: new Map(),
    potReleasePosition: new Map(), reports: [], propFlights: new Map(),
    lastBubbleIndex: -1, sprintExhausted: false,
  };
  runtimes.set(state, runtime);
  return runtime;
}

export function runtimeFor(state: GameState): Runtime {
  const runtime = runtimes.get(state);
  if (!runtime) throw new Error('GameState must be created with createGame().');
  return runtime;
}

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const copyPoint = (point: Vec2): Vec2 => ({ x: point.x, z: point.z });
export const forward = (yaw: number): Vec2 => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
export const lerp = (a: number, b: number, fraction: number): number => a + (b - a) * fraction;

export function logEvent(state: GameState, event: string): void {
  state.eventLog.push({ time: Math.round(state.elapsed * 100) / 100, event });
  if (state.eventLog.length > 400) state.eventLog.shift();
}

export function announceMessage(state: GameState, text: string, duration = 3): void {
  state.message = text;
  state.messageUntil = state.elapsed + duration;
}

export function explicitAction(state: GameState, kind: string, duration = 1.4): void {
  const runtime = runtimeFor(state);
  runtime.explicitEvent = { id: `${kind}-${++runtime.eventSerial}`, until: state.elapsed + duration, kind };
  state.player.protection = 0;
}

export function playerHeight(state: GameState): number {
  return state.player.pose === 'crouching' ? 0.9 : state.player.pose === 'working' || state.player.sticky ? 1.42 : 1.75;
}

/** Body visibility sample: crouching really lowers it; an enlarged cake masks both sides. */
export function playerSightHeight(state: GameState): number {
  return (state.player.pose==='crouching'?.65:state.player.pose==='working'||state.player.sticky?.9:1.05)+state.player.y;
}

export function flowFactor(state: GameState, position: Vec2, direction: Vec2, roomId: number, rooms: {id:number;x:number;z:number;w:number;d:number}[]): number {
  if (!state.flowRooms.includes(roomId) || direction.z >= -0.05) return 1;
  const room = rooms.find(item => item.id === roomId);
  if (!room) return 1;
  // A visible seven-metre strip, not the entire room and not a conveyor belt.
  return Math.abs(position.x - room.x) < Math.min(2.2, room.w / 3)
    && Math.abs(position.z - room.z) < 3.5 ? 0.6 : 1;
}
