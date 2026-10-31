import { describe, expect, it } from 'vitest';
import { createGame } from '../src/rules/game';
import { generateWorld } from '../src/world/generate';
import { makeWorldQuery } from '../src/world/query';
import { validateWorkstationAccess } from '../src/world/workstations';

describe('all workstation access after furniture assembly', () => {
  it('accepts every desk approach and real chair docking segment in the normal world', () => {
    const world = generateWorld(42), state = createGame(world), query = makeWorldQuery(world);
    expect(validateWorkstationAccess(world, state, query)).toEqual([]);
  });

  it('reports the exact desk whose approach is blocked by a measured furnishing', () => {
    const world = generateWorld(42), state = createGame(world);
    const desk = world.desks.find(item => !item.home)!;
    world.decorationColliders = [{ id: 'test-cabinet', roomId: desk.roomId, x: desk.seat.x, z: desk.seat.z, w: 1.4, d: 1.4, height: 1.2 }];
    const query = makeWorldQuery(world);
    expect(validateWorkstationAccess(world, state, query)).toContainEqual({ deskId: desk.id, reason: 'approach' });
  });
});
