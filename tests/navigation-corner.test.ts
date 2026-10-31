import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Vec2, WorldDef } from '../src/contracts/game';
import { createGame } from '../src/rules/game';
import { makeWorldQuery, switchOperatingPoint } from '../src/world/query';

it('follows the measured office wall-end route without trapping the rolling-chair mover', () => {
  const world = JSON.parse(readFileSync(new URL('./fixtures/navigation-corner-world.json', import.meta.url), 'utf8')) as WorldDef;
  const state = createGame(world), query = makeWorldQuery(world);
  const target = switchOperatingPoint(world.rooms.find(room => room.kind === 'boss')!), path = query.path(world.spawn, target, state);
  expect(path.length).toBeGreaterThan(0);
  let current: Vec2 = { ...world.spawn }, failure = '';
  for (const waypoint of path) {
    let steps = 0;
    while (Math.hypot(waypoint.x - current.x, waypoint.z - current.z) > .06 && steps++ < 1000) {
      const dx = waypoint.x - current.x, dz = waypoint.z - current.z, length = Math.hypot(dx, dz);
      const next = query.move(current, { x: dx / length * Math.min(.1, length), z: dz / length * Math.min(.1, length) }, .3, 1.42, state, 0);
      if (Math.hypot(next.x - current.x, next.z - current.z) < .00001) {
        failure = `stuck at ${JSON.stringify(current)} toward ${JSON.stringify(waypoint)} via ${JSON.stringify(path)}`;
        break;
      }
      current = next;
    }
    if (failure) break;
  }
  expect(failure).toBe('');
  expect(Math.hypot(target.x - current.x, target.z - current.z)).toBeLessThanOrEqual(.12);
});
