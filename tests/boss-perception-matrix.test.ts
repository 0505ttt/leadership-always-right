import { describe, expect, it } from 'vitest';
import type { GameState, Pose, WorldDef } from '../src/contracts/game';
import { visible } from '../src/rules/boss';
import { playerSightHeight } from '../src/rules/runtime';
import { createGame } from '../src/rules/game';
import { makeWorldQuery } from '../src/world/query';

function fixture(options: { distance?: number; angle?: number; pose?: Pose; y?: number; lit?: boolean; wallHeight?: number; permanentStation?: boolean } = {}) {
  const world: WorldDef = {
    seed: 42, width: 40, depth: 40,
    rooms: [{ id: 0, name: '感知测试房', kind: 'work', x: 20, z: 20, w: 40, d: 40, lit: true, permanentLight: false, switch: { x: 2, z: 2 }, pressure: false }],
    walls: options.wallHeight ? [{ id: 'sight-wall', x: 20, z: 22, w: 10, d: .2, height: options.wallHeight, roomId: 0 }] : [],
    doors: [], desks: [{ id: 'home', roomId: 0, x: 5, z: 5, seat: { x: 5, z: 4 }, yaw: 0, home: true }],
    stations: options.permanentStation ? [{ id: 'clock', roomId: 0, x: 20, z: 22, yaw: 0 }] : [], exits: [], props: [], colleagues: [],
    spawn: { x: 20, z: 20 }, bossSpawn: { x: 20, z: 20 }, patrol: [{ x: 20, z: 20 }], validation: [],
  };
  const state: GameState = createGame(world), angle = options.angle ?? 0, distance = options.distance ?? 3.2;
  Object.assign(state.boss, { x: 20, z: 20, yaw: 0, lookYaw: 0 });
  Object.assign(state.player, { x: 20 + Math.sin(angle) * distance, z: 20 + Math.cos(angle) * distance, y: options.y ?? 0, pose: options.pose ?? 'standing', sticky: options.pose === 'rolling', workStance: options.pose === 'working' ? 'chair-standing' : 'seated' });
  state.lights[0] = options.lit ?? true;
  const query = makeWorldQuery(world);
  return { state, query, seen: visible(state, state.boss, state.player, 10, playerSightHeight(state), query) };
}

describe('leader perception matrix', () => {
  it.each([[.1, true], [1.1, true], [1.3, true], [3.2, true], [4, true], [9.99, true], [10.01, false]])('distance %s => %s', (distance, expected) => {
    expect(fixture({ distance }).seen).toBe(expected);
  });
  it.each([[0, true], [49.9, true], [-49.9, true], [50.1, false], [-50.1, false], [85, false], [-85, false], [180, false]])('view angle %s => %s', (degrees, expected) => {
    expect(fixture({ angle: degrees * Math.PI / 180 }).seen).toBe(expected);
  });
  it.each(['standing', 'crouching', 'working', 'rolling'] as Pose[])('sees a lit player in %s pose', pose => {
    expect(fixture({ pose }).seen).toBe(true);
  });
  it('does not see through darkness, but honors the permanent objective light', () => {
    expect(fixture({ lit: false }).seen).toBe(false);
    expect(fixture({ lit: false, permanentStation: true, distance: 1.2 }).seen).toBe(true);
  });
  it('uses actual wall height at the sight sample rather than making every wall infinitely tall', () => {
    expect(fixture({ wallHeight: 2.2 }).seen).toBe(false);
    expect(fixture({ wallHeight: 2.2, y: 1.3 }).seen).toBe(true);
  });
});
