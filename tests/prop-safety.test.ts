import { describe, expect, it } from 'vitest';
import type { GameState, PropState, Vec2, WorldDef, WorldQuery } from '../src/contracts/game';
import { createGame } from '../src/rules/game';
import { safePropPlacement } from '../src/rules/prop-safety';
import { deskWorkingPoint } from '../src/world/workstations';
import { makeWorldQuery } from '../src/world/query';

interface Fixture { world: WorldDef; state: GameState; query: WorldQuery; cake: PropState }

function fixture(corridor = false): Fixture {
  const walls = corridor ? [
    { id: 'corridor-north', x: 15, z: 6.825, w: .2, d: 13.65, height: 2.8, roomId: 0 },
    { id: 'corridor-south', x: 15, z: 23.175, w: .2, d: 13.65, height: 2.8, roomId: 0 },
  ] : [];
  const world: WorldDef = {
    seed: 91031, width: 30, depth: 30,
    rooms: [{ id: 0, name: '安全测试房', kind: 'work', x: 15, z: 15, w: 30, d: 30, lit: true, permanentLight: true, switch: { x: 2, z: 2, yaw: 0 }, pressure: false }],
    walls,
    doors: [],
    desks: [{ id: 'home', roomId: 0, x: 5, z: corridor ? 16.4 : 5.2, seat: { x: 5, z: corridor ? 15 : 4 }, workPoint: { x: 5, z: corridor ? 15.61 : 4.41 }, yaw: 0, home: true }],
    stations: [{ id: 'clock', roomId: 0, x: 25, z: 15, yaw: 0 }],
    exits: [{ id: 'exit', roomId: 0, x: 29, z: 25, yaw: Math.PI / 2, outward: { x: 1, z: 0 } }],
    props: [{ id: 'cake', kind: 'cake', roomId: 0, x: 15, z: 15 }],
    colleagues: [],
    spawn: { x: 5, z: corridor ? 15 : 4 }, bossSpawn: { x: 28, z: 28 }, patrol: [{ x: 28, z: 28 }], validation: [],
  };
  const state = createGame(world);
  state.player.pose = 'standing';
  const query = makeWorldQuery(world);
  return { world, state, query, cake: state.props[0] };
}

function safe(f: Fixture, point: Vec2, scale = 3): boolean {
  return safePropPlacement(f.state, f.world, f.query, f.cake, point, scale, true);
}

describe('final-volume prop safety', () => {
  it('rejects an actor at a final square corner that center-distance checks miss', () => {
    const f = fixture();
    Object.assign(f.state.player, { x: 15.95, z: 15.95 });
    expect(Math.hypot(f.state.player.x - 15, f.state.player.z - 15)).toBeGreaterThan(.9 + .35);
    expect(safe(f, { x: 15, z: 15 })).toBe(false);
  });

  it('protects each desk approach, real chair root and mount/dismount space', () => {
    const f = fixture();
    f.world.desks.push({ id: 'second', roomId: 0, x: 9, z: 9.2, seat: { x: 9, z: 8 }, workPoint: { x: 9, z: 8.41 }, yaw: 0 });
    f.state.deskHeights.second = .75;
    for (const desk of f.world.desks) {
      const work = deskWorkingPoint(desk);
      expect(safe(f, { x: work.x + 1.35, z: work.z }), desk.id).toBe(false);
      expect(safe(f, { x: desk.seat.x + 1.35, z: desk.seat.z }), `${desk.id}:approach`).toBe(false);
      expect(safe(f, { x: (work.x + desk.seat.x) / 2 + 1.35, z: (work.z + desk.seat.z) / 2 }), `${desk.id}:docking`).toBe(false);
    }
  });

  it('uses measured decoration colliders registered after world generation', () => {
    const f = fixture();
    f.world.decorationColliders = [{ id: 'cabinet', roomId: 0, x: 15, z: 15, w: 2, d: 2, height: 1.2 }];
    expect(safe(f, { x: 16.95, z: 15 })).toBe(false);
    expect(safe(f, { x: 20, z: 15 })).toBe(true);
  });

  it('rejects a final cake sealing the home/clock route and accepts a legal side placement', () => {
    const f = fixture(true);
    expect(safe(f, { x: 15, z: 15 })).toBe(false);
    expect(safe(f, { x: 12, z: 15 })).toBe(true);
  });

  it('does not repeat full-map pathfinding for identical frame evaluations', () => {
    const f = fixture();
    let searches = 0;
    const path = f.query.path.bind(f.query);
    f.query.path = (a, b, state) => { searches++; return path(a, b, state); };
    expect(safe(f, { x: 15, z: 15 })).toBe(true);
    const initial = searches;
    expect(initial).toBeGreaterThan(0);
    for (let frame = 0; frame < 60; frame++) expect(safe(f, { x: 15, z: 15 })).toBe(true);
    expect(searches).toBe(initial);
  });
});
