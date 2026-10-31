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
  navEndpoint: Vec2 | null;
  nextPathAt: number;
  stuckFor: number;
  patrolInspection: { index: number; until: number } | null;
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
  activeReport: Vec2 | null;
  propFlights: Map<string, { from: Vec2; to: Vec2; elapsed: number; duration: number }>;
  lastBubbleIndex: number;
  sprintExhausted: boolean;
  inspectionSearchPoints: Vec2[];
  inspectionSearchIndex: number;
  inspectionPauseUntil: number;
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
  const hasIntro=state.props.some(prop=>prop.id==='cake-intro');
  const runtime: Runtime = {
    random, nextEnvironment: (hasIntro?3:15) + random() * (hasIntro?1:3), lastEnvironment: -100,
    lastKinds: {}, nextRuleId: 1, rules: new Map(), orderActive: false,
    pendingReturn: false, workCalm: 0, eventSerial: 0, explicitEvent: null,
    observedEvents: new Set(), eventSeenId: '', eventSeenFor: 0,
    interactionId: '', interactionElapsed: 0, interactionLatched: false,
    workingDesk: homeId, lastInteractHeld: false, navTarget: null, navEndpoint: null,
    nextPathAt: 0, stuckFor: 0, patrolInspection: null, leaveTarget: null, lightUseFor: 0,
    dragDistance: 0, dragSpeed: 0, dragTravelled: 0, dragElapsed: 0,
    potReturningToHand: new Map(), throwWindup: new Map(),
    potReleasePosition: new Map(), reports: [], activeReport: null, propFlights: new Map(),
    lastBubbleIndex: -1, sprintExhausted: false,
    inspectionSearchPoints: [], inspectionSearchIndex: 0, inspectionPauseUntil: 0,
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
  if (state.player.pose === 'working' && state.player.workStance === 'chair-standing' && !state.player.sticky) return 1.75;
  return state.player.pose === 'crouching' ? 0.9 : state.player.pose === 'working' || state.player.sticky ? 1.42 : 1.75;
}

/** Body visibility sample: crouching really lowers it; an enlarged cake masks both sides. */
export function playerSightHeight(state: GameState): number {
  return (state.player.pose==='crouching'?.65:state.player.pose==='working'&&state.player.workStance!=='chair-standing'||state.player.sticky?.9:1.05)+state.player.y;
}

/** Gameplay support for the seat, independent of a particular chair mesh. */
export const WORK_CHAIR_HEIGHT = .55;

export function leaveWorkstation(state:GameState):void {
  runtimeFor(state).workingDesk=null;
  state.player.workstationId=null;
  state.player.workStance='seated';
}

export function setWorkingStance(state:GameState,deskId:string):void {
  const player=state.player;
  runtimeFor(state).workingDesk=deskId;
  player.workstationId=deskId;
  player.workStance=!player.sticky&&(state.deskHeights[deskId]??.75)>.85?'chair-standing':'seated';
  player.y=player.workStance==='chair-standing'?WORK_CHAIR_HEIGHT:0;
  player.vy=0;
}

export function flowFactor(state: GameState, position: Vec2, direction: Vec2, roomId: number, rooms: {id:number;x:number;z:number;w:number;d:number}[]): number {
  if (!state.flowRooms.includes(roomId) || direction.z >= -0.05) return 1;
  const room = rooms.find(item => item.id === roomId);
  if (!room) return 1;
  // A visible seven-metre strip, not the entire room and not a conveyor belt.
  return Math.abs(position.x - room.x) < Math.min(2.2, room.w / 3)
    && Math.abs(position.z - room.z) < 3.5 ? 0.6 : 1;
}
