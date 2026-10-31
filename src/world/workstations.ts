import type { Desk, Vec2 } from '../contracts/game';

/** Older authored fixtures use one anchor; generated offices keep approach and chair apart. */
export function deskWorkingPoint(desk: Desk): Vec2 {
  return desk.workPoint ?? desk.seat;
}
