import type { Desk, GameState, Vec2, WorldDef, WorldQuery } from '../contracts/game';

/** Older authored fixtures use one anchor; generated offices keep approach and chair apart. */
export function deskWorkingPoint(desk: Desk): Vec2 {
  return desk.workPoint ?? desk.seat;
}

export interface WorkstationAccessIssue { deskId: string; reason: 'approach' | 'docking' | 'raised-docking' | 'raised-clearance' }

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

function usableRoute(query: WorldQuery, state: GameState, from: Vec2, to: Vec2): boolean {
  if (distance(from, to) < .01) return true;
  const path = query.path(from, to, state);
  if (!path.length) return false;
  let current = { ...from };
  for (const next of path) {
    const arrived = query.move(current, { x: next.x - current.x, z: next.z - current.z }, .3, 1.42, state);
    if (distance(arrived, next) > .03) return false;
    current = arrived;
  }
  return true;
}

/** Check every computer/work approach and real chair dock after visual solids are registered. */
export function validateWorkstationAccess(world: WorldDef, state: GameState, query: WorldQuery): WorkstationAccessIssue[] {
  const issues: WorkstationAccessIssue[] = [];
  for (const desk of world.desks) {
    if (!usableRoute(query, state, world.spawn, desk.seat)) { issues.push({ deskId: desk.id, reason: 'approach' }); continue; }
    const work = deskWorkingPoint(desk);
    if (!usableRoute(query, state, desk.seat, work)) issues.push({ deskId: desk.id, reason: 'docking' });
    const raised = { ...state, deskHeights: { ...state.deskHeights, [desk.id]: 1.9 } };
    if (!usableRoute(query, raised, desk.seat, work)) issues.push({ deskId: desk.id, reason: 'raised-docking' });
    if (query.clearance(work, raised) < 2.35) issues.push({ deskId: desk.id, reason: 'raised-clearance' });
  }
  return issues;
}
