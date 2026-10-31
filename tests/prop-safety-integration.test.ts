import { describe, expect, it } from 'vitest';
import type { ActiveRule, GameState, InputFrame, WorldDef, WorldQuery } from '../src/contracts/game';
import { createGame, stepGame } from '../src/rules/game';
import { runtimeFor } from '../src/rules/runtime';
import { handleObjectInput, updateObjects } from '../src/rules/objects';
import { safePropPlacement } from '../src/rules/prop-safety';
import { makeWorldQuery } from '../src/world/query';

const idle: InputFrame = { moveX: 0, moveZ: 0, yaw: 0, sprint: false, crouchPressed: false, jumpPressed: false, interact: false, interactPressed: false, potPressed: false, dropPressed: false, throwPressed: false, aim: false };

function fixture(corridor = false): { world: WorldDef; state: GameState; query: WorldQuery } {
  const world: WorldDef = {
    seed: 91032, width: 30, depth: 30,
    rooms: [{ id: 0, name: '安全集成房', kind: 'work', x: 15, z: 15, w: 30, d: 30, lit: true, permanentLight: true, switch: { x: 2, z: 2, yaw: 0 }, pressure: false }],
    walls: corridor ? [
      { id: 'corridor-north', x: 15, z: 6.825, w: .2, d: 13.65, height: 2.8, roomId: 0 },
      { id: 'corridor-south', x: 15, z: 23.175, w: .2, d: 13.65, height: 2.8, roomId: 0 },
    ] : [], doors: [],
    desks: [{ id: 'home', roomId: 0, x: 5, z: corridor ? 16.4 : 5.2, seat: { x: 5, z: corridor ? 15 : 4 }, workPoint: { x: 5, z: corridor ? 15.61 : 4.41 }, yaw: 0, home: true }],
    stations: [{ id: 'clock', roomId: 0, x: 25, z: 15, yaw: 0 }],
    exits: [{ id: 'exit', roomId: 0, x: 29, z: 25, yaw: Math.PI / 2, outward: { x: 1, z: 0 } }],
    props: [{ id: 'cake', kind: 'cake', roomId: 0, x: 15, z: 15 }], colleagues: [],
    spawn: { x: 5, z: corridor ? 15 : 4 }, bossSpawn: { x: 28, z: 28 }, patrol: [{ x: 28, z: 28 }], validation: [],
  };
  const state = createGame(world);
  state.player.pose = 'standing';
  runtimeFor(state).nextEnvironment = Infinity;
  return { world, state, query: makeWorldQuery(world) };
}

function warning(): ActiveRule {
  return { id: 77, kind: 'cake', quote: '测试画饼', effect: '测试最终体积', targetId: 'cake', roomId: 0, phase: 'warning', remaining: 0, duration: 22, age: 0 };
}

describe('prop safety gameplay integration', () => {
  it('cancels announced growth before the final square corner reaches the player', () => {
    const { world, state, query } = fixture();
    Object.assign(state.player, { x: 15.95, z: 15.95 });
    state.rules.push(warning());
    stepGame(state, idle, 1 / 60, world, query);
    expect(state.props[0].scale).toBe(1);
    expect(state.props[0].large).toBe(false);
    expect(state.rules).toHaveLength(0);
  });

  it('cancels a cake whose final volume would sever the return/clock route', () => {
    const { world, state, query } = fixture(true);
    state.rules.push(warning());
    stepGame(state, idle, 1 / 60, world, query);
    expect(state.props[0].large).toBe(false);
    expect(state.rules).toHaveLength(0);
    expect(state.inspection).toBeNull();
    expect(state.boss.mode).not.toBe('chase');
  });

  it('does not push a large cake into a position that seals the only return corridor', () => {
    const { world, state, query } = fixture(true);
    const cake = state.props[0];
    Object.assign(cake, { x: 14.99, z: 15, scale: 3, large: true });
    Object.assign(state.player, { x: 13.74, z: 15, yaw: Math.PI / 2 });
    stepGame(state, { ...idle, yaw: Math.PI / 2, interact: true, interactPressed: true }, 1 / 60, world, query);
    expect(cake.x).toBe(14.99);
    expect(state.message).toContain('必要通路');
  });

  it('reserves only a final-volume safe throw landing, or keeps the cake held', () => {
    const { world, state, query } = fixture(true);
    world.walls.push({ id: 'throw-limit', x: 16.5, z: 15, w: .2, d: 30, height: 2.8, roomId: 0 });
    const cake = state.props[0];
    Object.assign(cake, { scale: 3, large: true, held: true });
    Object.assign(state.player, { x: 10, z: 15, yaw: Math.PI / 2, holding: cake.id });
    handleObjectInput(state, { ...idle, yaw: Math.PI / 2, throwPressed: true }, world, query);
    const flight = runtimeFor(state).propFlights.get(cake.id);
    if (!flight) {
      expect(cake.held).toBe(true);
      expect(state.player.holding).toBe(cake.id);
    } else {
      expect(safePropPlacement(state, world, query, cake, flight.to, 3, true)).toBe(true);
    }
  });

  it('relocates or waits at flight completion instead of landing across the mandatory corridor', () => {
    const { world, state, query } = fixture(true);
    const cake = state.props[0];
    Object.assign(cake, { scale: 3, large: true, held: false, y: 1.1 });
    Object.assign(state.player, { x: 15, z: 10, yaw: 0 });
    runtimeFor(state).propFlights.set(cake.id, { from: { x: 15, z: 10 }, to: { x: 15, z: 15 }, elapsed: .5, duration: .55 });
    updateObjects(state, .06, world, query);
    expect(cake.x === 15 && cake.z === 15 && cake.y === 0).toBe(false);
    if (cake.y === 0) expect(safePropPlacement(state, world, query, cake, cake, 3, true)).toBe(true);
    else expect(runtimeFor(state).propFlights.has(cake.id)).toBe(true);
  });
});
