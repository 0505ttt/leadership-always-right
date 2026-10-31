import { expect, it } from 'vitest';
import type { ActiveRule, GameState, PropState, RuleKind, WorldDef, WorldQuery } from '../src/contracts/game';
import { createGame, stepGame } from '../src/rules/game';
import { updateEnvironment } from '../src/rules/environment';
import { runtimeFor } from '../src/rules/runtime';
import { safePropPlacement } from '../src/rules/prop-safety';
import { generateWorld } from '../src/world/generate';
import { makeWorldQuery } from '../src/world/query';

function fixture() {
  const world = generateWorld(42), room = world.rooms.find(room => room.kind === 'meeting')!;
  world.props = world.props.filter(prop => prop.id !== 'cake-intro' && prop.kind !== 'bed');
  world.props.push({ id: 'bed-0', kind: 'bed' as PropState['kind'], roomId: room.id, x: room.x, z: room.z + 5 });
  const state = createGame(world), query = makeWorldQuery(world), runtime = runtimeFor(state);
  runtime.random = () => .99; runtime.lastEnvironment = -100; runtime.nextEnvironment = 0; state.elapsed = 20;
  return { world, state, query, runtime, room };
}
function advance(state: GameState, world: WorldDef, query: WorldQuery, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds - 1e-8; elapsed += .05) { state.elapsed += .05; updateEnvironment(state, .05, world, query); }
}
function startBed(state: GameState, world: WorldDef, query: WorldQuery): ActiveRule {
  const rule: ActiveRule = { id: 998, kind: 'bed', quote: '公司就是你家，还回什么家。', effect: '预告落床', targetId: 'bed-0', roomId: world.rooms.find(room => room.kind === 'meeting')!.id, phase: 'warning', remaining: 3, duration: 16, age: 0 };
  state.rules.push(rule); runtimeFor(state).rules.set(rule.id, {});
  return rule;
}

it('schedules a warned bed, lands with physical volume, then withdraws', () => {
  const { world, state, query } = fixture();
  const rule = startBed(state, world, query);
  expect(rule.quote).toContain('公司就是你家');
  expect(rule.phase).toBe('warning');
  advance(state, world, query, 3.1);
  const bed = state.props.find(prop => prop.id === 'bed-0')!;
  expect(rule.phase).toBe('active');
  expect(bed.dormant).toBe(false);
  expect(bed.y).toBeGreaterThan(2);
  advance(state, world, query, .9);
  expect(bed.y).toBe(0);
  expect(query.supportHeight(bed, state)).toBeCloseTo(.58, 8);
  advance(state, world, query, 17);
  expect(state.rules.some(rule => rule.kind === 'bed')).toBe(false);
  expect(bed.dormant, JSON.stringify({ bed, rules: state.rules, events: state.eventLog.filter(entry => entry.event.includes('bed')) })).toBe(true);
});

it('rejects a final bed footprint that touches a player', () => {
  const { world, state, query, room } = fixture();
  const bed = state.props.find(prop => prop.id === 'bed-0')!;
  Object.assign(state.player, { x: room.x + 1.2, z: room.z + 5.8, y: 0 });
  expect(safePropPlacement(state, world, query, bed, bed, 1, false)).toBe(false);
});

it('cancels rather than forcing a landing when every final location is invalid', () => {
  const { world, state, query } = fixture();
  const rule: ActiveRule = { id: 999, kind: 'bed' as RuleKind, quote: '公司就是你家，还回什么家。', effect: '落床', targetId: 'bed-0', roomId: world.rooms.find(room => room.kind === 'meeting')!.id, phase: 'warning', remaining: 0, duration: 16, age: 0 };
  state.rules.push(rule); runtimeFor(state).rules.set(rule.id, {});
  query.validPlacement = () => false;
  updateEnvironment(state, .05, world, query);
  expect(state.rules.some(item => item.id === rule.id)).toBe(false);
  expect(state.props.find(prop => prop.id === 'bed-0')!.dormant).toBe(true);
  expect(state.message).toContain('没有安全落点');
});

it('selects the shipped bed during a natural normal-density round', () => {
  const world = generateWorld(42), state = createGame(world), query = makeWorldQuery(world);
  state.player.protection = Infinity;
  const input = { moveX: 0, moveZ: 0, yaw: 0, sprint: false, crouchPressed: false, jumpPressed: false, interact: false, interactPressed: false, potPressed: false, dropPressed: false, throwPressed: false, aim: false };
  let found: ActiveRule | undefined;
  for (let frame = 0; frame < 6000 && !found; frame++) {
    stepGame(state, input, .1, world, query);
    found = state.rules.find(rule => rule.kind === 'bed');
  }
  expect(found, JSON.stringify(runtimeFor(state).lastKinds)).toBeDefined();
  expect(found!.targetId).toBe('bed-home');
});
