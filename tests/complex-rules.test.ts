import { describe, expect, it } from 'vitest';
import type { ActiveRule, GameState, InputFrame, Vec2, WorldDef, WorldQuery } from '../src/contracts/game';
import { createGame, stepGame } from '../src/rules/game';
import { requestReturnWarning } from '../src/rules/boss';
import { attachPot } from '../src/rules/objects';
import { playerHeight, runtimeFor } from '../src/rules/runtime';
import { makeWorldQuery } from '../src/world/query';

const idle: InputFrame = {
  moveX: 0, moveZ: 0, yaw: 0, sprint: false, crouchPressed: false, jumpPressed: false,
  interact: false, interactPressed: false, potPressed: false, dropPressed: false, throwPressed: false, aim: false,
};
const durations = { cake: 22, desk: 20, flow: 16, transparent: 18, pressure: 14 } as const;
type SpatialKind = keyof typeof durations;
type Fixture = { world: WorldDef; state: GameState; query: WorldQuery };
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** Controlled mechanism fixture, not a generated layout or evidence of natural browser play. */
function fixture(): Fixture {
  const world: WorldDef = {
    seed: 4261, width: 48, depth: 18,
    rooms: [0, 1, 2].map(id => ({
      id, name: `组合测试房${id}`, kind: id ? 'meeting' : 'work', x: 8 + 16 * id, z: 9,
      w: 16, d: 18, lit: true, permanentLight: false, switch: { x: 1 + 16 * id, z: 2 }, pressure: id > 0,
    })),
    walls: [16, 32].flatMap((x, index) => [
      { id: `boundary-${index}-north`, x, z: 3.7, w: .18, d: 7.4, height: 2.8, roomId: index },
      { id: `boundary-${index}-south`, x, z: 14.3, w: .18, d: 7.4, height: 2.8, roomId: index },
    ]).concat([1, 2].map(id => ({
      id: `panel-${id}`, x: 10 + 16 * id, z: 8, w: .16, d: 3, height: 2.2, roomId: id, partition: true,
    }))),
    doors: [16, 32].map((x, index) => ({ id: `door-${index}`, a: index, b: index + 1, x, z: 9, axis: 'z', width: 3.2 })),
    desks: [
      { id: 'home', roomId: 0, x: 4, z: 5, seat: { x: 4, z: 3.8 }, yaw: 0, home: true },
      ...[1, 2].map(id => ({ id: `desk-${id}`, roomId: id, x: 8 + 16 * id, z: 5, seat: { x: 8 + 16 * id, z: 3.8 }, yaw: 0 })),
    ],
    stations: [1, 2].map(id => ({ id: `clock-${id}`, roomId: id, x: 12 + 16 * id, z: 14, yaw: 0 })),
    exits: [
      { id: 'east', roomId: 2, x: 47.35, z: 3, yaw: Math.PI / 2, outward: { x: 1, z: 0 } },
      { id: 'west', roomId: 0, x: .65, z: 3, yaw: -Math.PI / 2, outward: { x: -1, z: 0 } },
    ],
    props: [1, 2].map(id => ({ id: `cake-${id}`, kind: 'cake', roomId: id, x: 8 + 16 * id, z: 13 })),
    colleagues: [0, 1].map(id => ({ id: `colleague-${id}`, name: `同事${id}`, deskId: `remote-${id}`, roomId: 0, x: 4 + 4 * id, z: 14, yaw: 0, pot: true })),
    spawn: { x: 4, z: 3.8 }, bossSpawn: { x: 3, z: 16 }, patrol: [{ x: 3, z: 16 }], validation: [],
  };
  const state = createGame(world);
  // Only random scheduling is suspended. Player, boss, objects, collisions and restoration use stepGame.
  runtimeFor(state).nextEnvironment = Infinity;
  return { world, state, query: makeWorldQuery(world) };
}

function advance(f: Fixture, seconds: number, input: Partial<InputFrame> = {}): void {
  const steps = Math.ceil(seconds * 60);
  for (let i = 0; i < steps; i++) {
    stepGame(f.state, { ...idle, yaw: f.state.player.yaw, ...input }, Math.min(1 / 60, seconds - i / 60), f.world, f.query);
  }
}

function spatialBudget(state: GameState): void {
  const counted = state.rules.filter(rule => rule.kind !== 'return' && rule.kind !== 'pot' && rule.phase !== 'restoring');
  expect(counted.length).toBeLessThanOrEqual(2);
  expect(new Set(counted.map(rule => rule.roomId)).size).toBe(counted.length);
  expect(state.rules.filter(rule => rule.phase === 'warning').length).toBeLessThanOrEqual(1);
}

/**
 * Deliberately controlled announcement timing to reach the allowed two-space stress state.
 * It preserves one warning at a time and one space rule per room, but does NOT claim that
 * today's 24–36-second natural scheduler produces this overlap.
 */
function activateControlled(f: Fixture, kind: SpatialKind, roomId: number): ActiveRule {
  const runtime = runtimeFor(f.state);
  const targetId = kind === 'desk' ? `desk-${roomId}` : kind === 'cake' ? `cake-${roomId}`
    : kind === 'transparent' ? `panel-${roomId}` : `room-${roomId}`;
  const rule: ActiveRule = {
    id: runtime.nextRuleId++, kind, targetId, roomId, quote: '受控组合测试', effect: '不是自然发令记录',
    phase: 'warning', remaining: 3, duration: durations[kind], age: 0,
  };
  f.state.rules.push(rule);
  spatialBudget(f.state);
  advance(f, 4.1);
  expect(rule.phase).toBe('active');
  spatialBudget(f.state);
  return rule;
}

function probeEffect(f: Fixture, rule: ActiveRule): void {
  const { state, query, world } = f;
  const room = world.rooms.find(item => item.id === rule.roomId)!;
  if (rule.kind === 'pressure') {
    expect(query.clearance({ x: room.x, z: room.z }, state)).toBeCloseTo(1.6);
  } else if (rule.kind === 'desk') {
    const desk = world.desks.find(item => item.id === rule.targetId)!;
    expect(state.deskHeights[desk.id]).toBeCloseTo(1.9);
    const start = { x: desk.x - 2, z: desk.z };
    expect(query.move(start, { x: 4, z: 0 }, .3, 1.75, state).x).toBeCloseTo(desk.x + 2);
  } else if (rule.kind === 'cake') {
    const cake = state.props.find(item => item.id === rule.targetId)!;
    expect(cake.large).toBe(true); expect(cake.scale).toBeCloseTo(3);
    const start = { x: cake.x - 2, z: cake.z }, end = { x: cake.x + 2, z: cake.z };
    expect(query.move(start, { x: 4, z: 0 }, .3, 1.75, state).x).toBeLessThan(cake.x - 1);
    expect(query.lineOfSight(start, end, 1.05, state)).toBe(false);
  } else if (rule.kind === 'flow') {
    expect(state.flowRooms).toContain(room.id);
  } else if (rule.kind === 'transparent') {
    const panel = world.walls.find(item => item.id === rule.targetId)!;
    const a = { x: panel.x - 1.5, z: panel.z }, b = { x: panel.x + 1.5, z: panel.z };
    expect(query.lineOfSight(a, b, 1.05, state)).toBe(true);
    expect(query.lineOfSight(b, a, 1.05, state)).toBe(true);
    expect(query.move(a, { x: 3, z: 0 }, .3, 1.42, state).x).toBeLessThan(panel.x - .3);
  }
}

function assertRoutes(f: Fixture): void {
  for (const target of [...f.world.stations, ...f.world.exits]) {
    const path = f.query.path(f.world.spawn, target, f.state);
    expect(path.length, `route to ${target.id}`).toBeGreaterThan(0);
    let current = { ...f.world.spawn };
    for (const next of path) {
      // Independently replay the route against the chair's actual collision envelope.
      const arrived = f.query.move(current, { x: next.x - current.x, z: next.z - current.z }, .3, 1.42, f.state);
      expect(distance(arrived, next), `chair segment to ${target.id}`).toBeLessThan(.002);
      current = arrived;
    }
  }
}

function walk(f: Fixture, target: Vec2): void {
  let path: Vec2[] = [];
  for (let frame = 0; frame < 3600; frame++) {
    if (f.state.ending || distance(f.state.player, target) < .08) return;
    if (!path.length || frame % 20 === 0) path = f.query.path(f.state.player, target, f.state);
    expect(path.length, 'actual input route exists').toBeGreaterThan(0);
    while (path.length > 1 && distance(f.state.player, path[0]) < .035) path.shift();
    const next = path[0];
    const yaw = Math.atan2(next.x - f.state.player.x, next.z - f.state.player.z);
    advance(f, 1 / 60, { moveZ: Math.min(1, distance(f.state.player, next) / (4.8 / 60)), yaw });
    expect(Number.isFinite(f.state.player.x + f.state.player.z + f.state.player.y)).toBe(true);
    expect(f.state.player.pose).not.toBe('dragged');
  }
  throw new Error(`Bounded input route did not reach ${target.x},${target.z}`);
}

function attachExistingPot(f: Fixture): string {
  const pot = f.state.pots[0];
  expect(attachPot(f.state, pot, 'player')).toBe(true);
  advance(f, .8);
  expect(pot.phase).toBe('attached');
  return pot.id;
}

const pairs: [SpatialKind, SpatialKind][] = [
  ['pressure', 'desk'], ['pressure', 'cake'], ['pressure', 'flow'], ['pressure', 'transparent'],
  ['desk', 'cake'], ['desk', 'flow'], ['desk', 'transparent'], ['cake', 'flow'], ['cake', 'transparent'], ['flow', 'transparent'],
];

describe('controlled two-space matrix: real steps, solid queries and restoration', () => {
  it.each(pairs)('%s + %s in distinct rooms preserves chair routes and restores both effects', (first, second) => {
    const f = fixture();
    const a = activateControlled(f, first, 1), b = activateControlled(f, second, 2);
    expect(f.state.rules.filter(rule => rule.phase === 'active')).toHaveLength(2);
    probeEffect(f, a); probeEffect(f, b); assertRoutes(f);
    advance(f, 27);
    expect(f.state.rules).toEqual([]);
    expect(f.state.pressureRooms).toEqual([]); expect(f.state.pressureHeights).toEqual({});
    expect(f.state.flowRooms).toEqual([]); expect(f.state.transparentWalls).toEqual([]);
    expect(Object.values(f.state.deskHeights).every(height => Math.abs(height - .75) < 1e-8)).toBe(true);
    expect(f.state.props.every(prop => !prop.large && prop.scale === 1)).toBe(true);
    assertRoutes(f);
  });
});

describe('persistent pot and sticky chair in spatial rules', () => {
  it.each([false, true])('pressure and reverse flow keep a pot carrier mobile (sticky=%s)', sticky => {
    const f = fixture();
    Object.assign(f.state.player, { x: 24, z: 10, pose: sticky ? 'rolling' : 'standing', sticky });
    runtimeFor(f.state).workingDesk = null;
    const potId = attachExistingPot(f);
    activateControlled(f, 'pressure', 1); activateControlled(f, 'flow', 2);
    expect(f.state.player.pose).toBe(sticky ? 'rolling' : 'crouching');
    const z = f.state.player.z;
    advance(f, .4, { moveZ: 1, yaw: Math.PI, jumpPressed: true });
    expect(z - f.state.player.z).toBeCloseTo((sticky ? 3.6 : 1.6) * .85 * .4, 5);
    expect(f.state.player.y).toBe(0);
    walk(f, { x: 40, z: 10 });
    const before = f.state.player.z;
    advance(f, .4, { moveZ: 1, yaw: Math.PI });
    expect(before - f.state.player.z).toBeCloseTo((sticky ? 3.6 : 3.1) * .85 * .6 * .4, 5);
    if (!sticky) {
      advance(f, 1 / 60, { crouchPressed: true });
      const crouched = f.state.player.z;
      advance(f, .4, { moveZ: 1, yaw: Math.PI });
      expect(crouched - f.state.player.z).toBeCloseTo(1.3 * .4, 5);
    } else {
      advance(f, 1 / 60, { crouchPressed: true, jumpPressed: true });
      expect(f.state.player.pose).toBe('rolling'); expect(f.state.player.y).toBe(0);
    }
    expect(f.state.player.potId).toBe(potId);
    expect(f.state.pots).toHaveLength(2); expect(new Set(f.state.pots.map(pot => pot.owner)).size).toBe(2);
  });

  it.each(pairs.slice(0, 3))('keeps a pot+sticky player able to clock, open and physically exit through %s + %s', (first, second) => {
    const f = fixture();
    f.state.player.sticky = true;
    const potId = attachExistingPot(f);
    activateControlled(f, first, 1); activateControlled(f, second, 2);
    advance(f, 1 / 60, { interact: true, interactPressed: true });
    const station = f.world.stations[1], exit = f.world.exits[0];
    walk(f, { x: station.x, z: station.z - .7 });
    advance(f, 1.4, { interact: true, yaw: 0 }); expect(f.state.clocked).toBe(false);
    advance(f, .12, { interact: true, yaw: 0 }); expect(f.state.clocked).toBe(true);
    advance(f, 1 / 60);
    walk(f, { x: exit.x - .7, z: exit.z });
    advance(f, 3.9, { interact: true, yaw: Math.PI / 2 }); expect(f.state.openedExits).toEqual([]);
    advance(f, .12, { interact: true, yaw: Math.PI / 2 }); expect(f.state.openedExits).toEqual([exit.id]);
    expect(f.state.ending).toBeNull();
    walk(f, { x: exit.x + 1.8, z: exit.z });
    expect(f.state.ending).toBe('escaped'); expect(f.state.player.x).toBeGreaterThan(f.world.width);
    expect(f.state.player.sticky).toBe(true); expect(f.state.player.potId).toBe(potId);
  });

  it('physically captures a pressured pot carrier, drags them home and conserves the pot and clock-in', () => {
    const f = fixture();
    Object.assign(f.state.player, { x: 24, z: 10, pose: 'standing' });
    runtimeFor(f.state).workingDesk = null;
    const potId = attachExistingPot(f);
    f.state.clocked = true; // A previously earned objective is part of this controlled starting fixture.
    activateControlled(f, 'pressure', 1);
    Object.assign(f.state.boss, { x: 24, z: 9.1, yaw: 0, path: [] });
    requestReturnWarning(f.state);
    let sawChase = false, sawDrag = false;
    const dragPoints: Vec2[] = [];
    for (let frame = 0; frame < 720 && f.state.catches === 0; frame++) {
      advance(f, 1 / 60);
      sawChase ||= f.state.boss.mode === 'chase'; sawDrag ||= f.state.player.pose === 'dragged';
      if (f.state.player.pose === 'dragged') {
        dragPoints.push({ x: f.state.player.x, z: f.state.player.z });
        if (f.query.roomAt(f.state.player)?.id === 1) {
          expect(f.state.pressureHeights[1]).toBeGreaterThanOrEqual(f.state.player.y + playerHeight(f.state) + .049);
        }
      }
    }
    expect(sawChase && sawDrag).toBe(true); expect(dragPoints.length).toBeGreaterThan(10);
    expect(f.state.catches).toBe(1); expect(distance(f.state.player, f.world.spawn)).toBeLessThan(.01);
    expect(f.state.player.sticky).toBe(true); expect(f.state.player.potId).toBe(potId); expect(f.state.clocked).toBe(true);
    expect(f.state.pots).toHaveLength(2);
    advance(f, .4, { moveZ: 1, yaw: Math.PI });
    expect(f.state.player.pose).toBe('rolling'); expect(distance(f.state.player, f.world.spawn)).toBeGreaterThan(.5);
  });
});

describe('legal physical overlap during safe restoration', () => {
  it('restoring raised desk + new pressure never crushes a sticky pot carrier, and finishes after exit', () => {
    const f = fixture();
    Object.assign(f.state.player, { x: 22, z: 5, pose: 'rolling', sticky: true });
    runtimeFor(f.state).workingDesk = null;
    attachExistingPot(f);
    const deskRule = activateControlled(f, 'desk', 1), desk = f.world.desks[1];
    walk(f, { x: desk.x, z: desk.z });
    for (let frame = 0; frame < 1500 && deskRule.phase === 'active'; frame++) advance(f, 1 / 60);
    expect(deskRule.phase).toBe('restoring');
    expect(f.state.deskHeights[desk.id]).toBeGreaterThanOrEqual(1.42 + .16 - 1e-8);
    activateControlled(f, 'pressure', 1); // Restoration does not occupy a new spatial slot.
    spatialBudget(f.state);
    expect(f.state.player.pose).toBe('rolling'); expect(f.state.player.y).toBe(0);
    expect(f.query.clearance(f.state.player, f.state)).toBeGreaterThanOrEqual(1.42 + .049);
    expect(f.query.clearance(f.state.player, f.state)).toBeLessThanOrEqual(1.6);
    // The shared AI path query uses standing height; walk out directly using the chair's real envelope.
    advance(f, 2, { moveZ: 1, yaw: Math.PI / 2 });
    expect(f.state.player.x).toBeGreaterThan(desk.x + 1.2);
    advance(f, 1);
    expect(f.state.deskHeights[desk.id]).toBeCloseTo(.75);
    expect(f.state.rules).not.toContain(deskRule);
    expect(f.state.player.sticky).toBe(true); expect(f.state.player.potId).not.toBeNull();
    assertRoutes(f);
  });
});
