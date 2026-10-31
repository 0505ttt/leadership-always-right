import { describe, expect, it } from 'vitest';
import type { GameState, InputFrame, Vec2, WorldDef, WorldQuery } from '../src/contracts/game';
import { createGame, stepGame } from '../src/rules/game';
import { runtimeFor } from '../src/rules/runtime';
import { makeWorldQuery } from '../src/world/query';

const idle: InputFrame = { moveX: 0, moveZ: 0, yaw: 0, sprint: false, crouchPressed: false, jumpPressed: false, interact: false, interactPressed: false, potPressed: false, dropPressed: false, throwPressed: false, aim: false };
const gap = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

function fixture(): { world: WorldDef; query: WorldQuery; state: GameState } {
  const world: WorldDef = {
    seed: 123, width: 50, depth: 50, validation: [],
    rooms: [{ id: 0, name: '工作区', kind: 'work', x: 25, z: 25, w: 50, d: 50, lit: true, permanentLight: false, switch: { x: 6, z: 6 }, pressure: false }],
    walls: [], doors: [], props: [], colleagues: [],
    desks: [{ id: 'home', roomId: 0, x: 4, z: 5.2, seat: { x: 4, z: 4 }, yaw: 0, home: true }],
    stations: [{ id: 'clock', roomId: 0, x: 10, z: 10, yaw: 0 }],
    exits: [
      { id: 'east', roomId: 0, x: 49, z: 25, yaw: Math.PI / 2, outward: { x: 1, z: 0 } },
      { id: 'west', roomId: 0, x: 1, z: 25, yaw: -Math.PI / 2, outward: { x: -1, z: 0 } },
    ],
    spawn: { x: 4, z: 4 }, bossSpawn: { x: 20, z: 20 }, patrol: [{ x: 20, z: 20 }, { x: 30, z: 20 }],
  };
  const query = makeWorldQuery(world), state = createGame(world);
  // These scenarios isolate perception and counterplay from randomized rules.
  runtimeFor(state).nextEnvironment = Infinity;
  state.player.pose = 'standing';
  return { world, query, state };
}

function run(state: GameState, world: WorldDef, query: WorldQuery, seconds: number, input: Partial<InputFrame> = {}): void {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
    stepGame(state, { ...idle, ...input }, Math.min(1 / 60, seconds - frame / 60), world, query);
  }
}

describe('observant patrols without hidden-player tracking', () => {
  it('keeps watching a visible departing worker before turning to the next waypoint', () => {
    const { world, query, state } = fixture();
    Object.assign(state.boss, { x: 20, z: 20, yaw: 0 });
    Object.assign(state.player, { x: 20, z: 27 });
    world.patrol = [{ x: 10, z: 20 }];
    run(state, world, query, 1.18);
    expect(state.rules.some(rule => rule.kind === 'return')).toBe(false);
    run(state, world, query, .05);
    const warning = state.rules.find(rule => rule.kind === 'return');
    expect(warning?.phase).toBe('warning');
    expect(warning?.remaining).toBeGreaterThan(2.9);
    run(state, world, query, 2.9);
    expect(state.player.pose).not.toBe('dragged');
  });

  it('scans an objective forecourt and detects someone outside the arrival-facing cone', () => {
    const { world, query, state } = fixture();
    Object.assign(state.boss, { x: 10, z: 10.95, yaw: 0 });
    Object.assign(state.player, { x: 5, z: 10.95 });
    world.patrol = [{ x: 10, z: 10.95 }, { x: 30, z: 10.95 }];
    run(state, world, query, 5);
    expect(state.eventLog.some(event => event.event === 'boss:patrol-inspection')).toBe(true);
    expect(state.eventLog.some(event => event.event === 'boss:warning')).toBe(true);
    expect(state.boss.lastSeen).toEqual({ x: 5, z: 10.95 });
  });

  it('leaves an empty objective inspection in under four seconds', () => {
    const { world, query, state } = fixture();
    Object.assign(state.boss, { x: 10, z: 10.95, yaw: 0 });
    Object.assign(state.player, { x: 40, z: 40 });
    world.patrol = [{ x: 10, z: 10.95 }, { x: 30, z: 10.95 }];
    run(state, world, query, 4);
    expect(state.boss.patrolIndex).toBe(1);
    expect(gap(state.boss, world.patrol[0])).toBeGreaterThan(.5);
    expect(runtimeFor(state).patrolInspection).toBeNull();
  });

  it('starts a queued report investigation immediately during an objective scan', () => {
    const { world, query, state } = fixture();
    Object.assign(state.boss, { x: 10, z: 10.95 });
    Object.assign(state.player, { x: 40, z: 40 });
    world.patrol = [{ x: 10, z: 10.95 }];
    run(state, world, query, .1);
    expect(runtimeFor(state).patrolInspection).not.toBeNull();
    const reported = { x: 40, z: 10 };
    runtimeFor(state).reports.push(reported);
    run(state, world, query, 1 / 60);
    expect(state.boss.mode).toBe('search');
    expect(state.boss.lastSeen).toEqual(reported);
    expect(runtimeFor(state).reports).toEqual([]);
  });

  it('turns toward an already visible worker circling within warning range', () => {
    const { world, query, state } = fixture();
    Object.assign(state.player, { x: 20, z: 21 });
    world.patrol = [{ ...state.boss }];
    run(state, world, query, 1.25);
    for (let frame = 1; frame <= 60; frame++) {
      const angle = frame / 60 * 1.5;
      state.player.x = state.boss.x + Math.sin(angle);
      state.player.z = state.boss.z + Math.cos(angle);
      stepGame(state, idle, 1 / 60, world, query);
    }
    expect(state.rules.some(rule => rule.kind === 'return' && rule.phase === 'warning')).toBe(true);
    expect(state.boss.yaw).toBeCloseTo(1.5, 4);
    expect(state.eventLog.some(event => event.event === 'boss:warning-cancelled')).toBe(false);
    expect(state.player.pose).not.toBe('dragged');
  });

  it('cancels an occluded order, investigates the actual old point and requires fresh warning on reacquisition', () => {
    const { world } = fixture();
    world.walls.push({ id: 'cover', roomId: 0, x: 25, z: 25, w: .2, d: 10, height: 2.8 });
    const query = makeWorldQuery(world), state = createGame(world);
    runtimeFor(state).nextEnvironment = Infinity;
    Object.assign(state.player, { pose: 'standing', x: 24, z: 20 });
    Object.assign(state.boss, { x: 20, z: 20, yaw: Math.PI / 2 });
    world.patrol = [{ ...state.boss }];
    run(state, world, query, 1.25);
    const observed = { ...state.boss.lastSeen! };
    Object.assign(state.player, { x: 28, z: 27 });
    run(state, world, query, .1);
    expect(state.boss.mode).toBe('search');
    expect(runtimeFor(state).orderActive).toBe(false);
    expect(state.rules.some(rule => rule.kind === 'return' && rule.phase === 'warning')).toBe(false);
    Object.assign(state.player, { x: 29, z: 28 });
    run(state, world, query, .3);
    expect(state.boss.lastSeen).toEqual(observed);
    expect(runtimeFor(state).navTarget).toEqual(observed);
    Object.assign(state.player, observed);
    run(state, world, query, 1.1);
    expect(state.rules.some(rule => rule.kind === 'return' && rule.phase === 'warning')).toBe(false);
    run(state, world, query, .15);
    expect(state.rules.find(rule => rule.kind === 'return')?.remaining).toBeGreaterThan(2.9);
    expect(state.player.pose).not.toBe('dragged');
  });
});

describe('real consequences and counterplay', () => {
  it('preserves the eight-second protection and makes the leader leave at least eight metres after capture', () => {
    const { world, query, state } = fixture();
    Object.assign(state.player, { x: 20, z: 21 });
    Object.assign(state.boss, { x: 20, z: 20.1, mode: 'chase' });
    runtimeFor(state).orderActive = true;
    state.clocked = true;
    for (let frame = 0; frame < 300 && !state.player.sticky; frame++) stepGame(state, idle, 1 / 60, world, query);
    expect(state.catches).toBe(1);
    expect(state.player.protection).toBe(8);
    expect(state.clocked).toBe(true);
    expect(state.boss.mode).toBe('leave');
    for (let frame = 0; frame < 240 && state.boss.mode === 'leave'; frame++) {
      stepGame(state, idle, 1 / 60, world, query);
      if (gap(state.boss, world.spawn) < 8) expect(state.boss.mode).toBe('leave');
      expect(state.catches).toBe(1);
    }
    expect(gap(state.boss, world.spawn)).toBeGreaterThanOrEqual(8);
    expect(state.boss.mode).toBe('patrol');
    expect(state.player.protection).toBeGreaterThan(4);
  });

  it('interrupts a four-second exit attempt made directly in front of the leader, after the full warning', () => {
    const { world, query, state } = fixture();
    Object.assign(state.player, { x: 48.2, z: 25 });
    Object.assign(state.boss, { x: 41, z: 25, yaw: Math.PI / 2 });
    world.patrol = [{ ...state.boss }];
    state.clocked = true;
    run(state, world, query, 3.15, { interact: true, yaw: Math.PI / 2 });
    expect(state.player.pose).not.toBe('dragged');
    run(state, world, query, .85, { interact: true, yaw: Math.PI / 2 });
    expect(state.player.pose).toBe('dragged');
    expect(state.openedExits).toEqual([]);
    const warning = state.eventLog.find(event => event.event === 'boss:warning')!;
    const capture = state.eventLog.find(event => event.event === 'boss:caught')!;
    expect(capture.time - warning.time).toBeGreaterThanOrEqual(3.45);
    expect(state.clocked).toBe(true);
  });

  it('lets a completed light-switch action break exposure and prevent capture', () => {
    const { world, query, state } = fixture();
    Object.assign(state.player, { x: 6, z: 5.4 });
    Object.assign(state.boss, { x: 6, z: 6.3, yaw: Math.PI });
    world.patrol = [{ ...state.boss }];
    run(state, world, query, 1.25);
    expect(state.boss.mode).toBe('warning');
    run(state, world, query, .25, { interact: true });
    expect(state.lights[0]).toBe(false);
    run(state, world, query, 3);
    expect(state.player.pose).not.toBe('dragged');
    expect(state.boss.contactFor).toBe(0);
    expect(state.clocked).toBe(false);
    expect(runtimeFor(state).orderActive).toBe(false);
  });

  it('does not learn an unobserved clock record or read the hidden destination', () => {
    const { world, query, state } = fixture();
    Object.assign(state.player, { x: 10, z: 9.2 });
    Object.assign(state.boss, { x: 41, z: 25, yaw: Math.PI / 2 });
    world.patrol = [{ ...state.boss }, { x: 41, z: 35 }];
    run(state, world, query, 1.5, { interact: true });
    expect(state.clocked).toBe(true);
    expect(state.boss.evidenceId).toBeNull();
    expect(state.boss.lastSeen).toBeNull();
    expect(state.eventLog.some(event => event.event === 'boss:warning')).toBe(false);
  });
});
