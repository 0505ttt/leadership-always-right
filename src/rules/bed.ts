import type { ActiveRule, GameState, PropState, Vec2, WorldDef, WorldQuery } from '../contracts/game';
import { DIMENSIONS } from '../contracts/game';
import { clamp } from './runtime';
import { safePropPlacement } from './prop-safety';

const OFFSETS = [[0, 0], [1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8], [2.8, 0], [-2.8, 0]] as const;

export function findBedPlacement(state: GameState, world: WorldDef, query: WorldQuery, bed: PropState): Vec2 | null {
  const room = world.rooms.find(item => item.id === bed.roomId);
  if (!room) return null;
  for (const [dx, dz] of OFFSETS) {
    const point = { x: bed.x + dx, z: bed.z + dz };
    if (Math.abs(point.x - room.x) + DIMENSIONS.bedWidth / 2 > room.w / 2 - .25) continue;
    if (Math.abs(point.z - room.z) + DIMENSIONS.bedDepth / 2 > room.d / 2 - .25) continue;
    if (safePropPlacement(state, world, query, bed, point, 1, true)) return point;
  }
  return null;
}

export function activateBed(state: GameState, world: WorldDef, query: WorldQuery, bed: PropState): boolean {
  const point = findBedPlacement(state, world, query, bed);
  if (!point) return false;
  Object.assign(bed, point, { y: 2.8, dormant: false });
  return true;
}

/** A bed that becomes unsafe during descent is cancelled, never dropped onto a person. */
export function updateBed(state: GameState, rule: ActiveRule, world: WorldDef, query: WorldQuery): boolean {
  const bed = state.props.find(prop => prop.id === rule.targetId && prop.kind === 'bed');
  if (!bed) return false;
  if (rule.phase === 'active') {
    if (!findBedPlacement(state, world, query, bed)) { bed.dormant = true; bed.y = 2.8; return false; }
    bed.dormant = false;
    bed.y = 2.8 * (1 - clamp(rule.age / .8, 0, 1));
    return true;
  }
  if (rule.phase === 'restoring') {
    bed.y = 2.8 * clamp(rule.age / .8, 0, 1);
    if (rule.age >= .8) bed.dormant = true;
  }
  return true;
}
