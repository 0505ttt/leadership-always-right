import type { GameState, PropState, Rect, Vec2, WorldDef, WorldQuery } from '../contracts/game';
import { deskWorkingPoint } from '../world/workstations';

const ACTOR_RADIUS = .3;
const ROUTE_HEIGHT = 1.42;
const ROUTE_CACHE_AGE = .35;
const ROUTE_CACHE_LIMIT = 96;

interface RouteCacheEntry { at: number; safe: boolean }
const routeCaches = new WeakMap<WorldDef, Map<string, RouteCacheEntry>>();

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

function volume(prop: PropState, point: Vec2, scale: number): { rect: Rect; radius: number; height: number } {
  const half = prop.kind === 'box' ? .275 : .3 * scale;
  return {
    rect: { x: point.x, z: point.z, w: half * 2, d: half * 2 },
    radius: Math.SQRT2 * half,
    height: prop.kind === 'box' ? .55 : .4 * scale,
  };
}

function circleTouchesRect(point: Vec2, rect: Rect, radius: number): boolean {
  const dx = Math.max(Math.abs(point.x - rect.x) - rect.w / 2, 0);
  const dz = Math.max(Math.abs(point.z - rect.z) - rect.d / 2, 0);
  return dx * dx + dz * dz < radius * radius - 1e-8;
}

function clearOfActors(state: GameState, rect: Rect, height: number): boolean {
  const actors = [state.player, state.boss, ...state.colleagues];
  return actors.every(actor => ((actor as Vec2 & { y?: number }).y ?? 0) >= height - 1e-6
    || !circleTouchesRect(actor, rect, ACTOR_RADIUS + .05));
}

function clearOfWorkstations(world: WorldDef, rect: Rect): boolean {
  return world.desks.every(desk => {
    const work = deskWorkingPoint(desk);
    // These are ground-level operating reservations, not actor positions. They
    // remain protected while a worker is standing on the raised chair.
    return !circleTouchesRect(work, rect, .78)
      && !circleTouchesRect(desk.seat, rect, .64)
      && !circleTouchesRect({ x: (work.x + desk.seat.x) / 2, z: (work.z + desk.seat.z) / 2 }, rect, .58);
  });
}

function routeIsUsable(query: WorldQuery, state: GameState, from: Vec2, to: Vec2): boolean {
  if (distance(from, to) < .01) return true;
  const path = query.path(from, to, state);
  if (!path.length) return false;
  let current = { ...from };
  for (const next of path) {
    const arrived = query.move(current, { x: next.x - current.x, z: next.z - current.z }, ACTOR_RADIUS, ROUTE_HEIGHT, state);
    if (distance(arrived, next) > .03) return false;
    current = arrived;
  }
  return true;
}

function mandatoryRoutesUsable(state: GameState, world: WorldDef, query: WorldQuery): boolean {
  const home = world.desks.find(desk => desk.home);
  const homeApproach = home?.seat ?? world.spawn;
  if (!routeIsUsable(query, state, state.player, homeApproach)) return false;
  if (home && !routeIsUsable(query, state, homeApproach, deskWorkingPoint(home))) return false;
  for (const station of world.stations) {
    if (!routeIsUsable(query, state, homeApproach, station)) return false;
    if (!world.exits.some(exit => routeIsUsable(query, state, station, exit))) return false;
  }
  return true;
}

function routeKey(state: GameState, world: WorldDef, prop: PropState, point: Vec2, scale: number): string {
  const props = state.props.map(item => item.id === prop.id
    ? `${item.id}:${point.x.toFixed(3)}:${point.z.toFixed(3)}:${scale.toFixed(3)}`
    : `${item.id}:${item.x.toFixed(3)}:${item.z.toFixed(3)}:${item.scale.toFixed(3)}:${Number(item.held)}:${(item.y ?? 0).toFixed(2)}`);
  const decorations = (world.decorationColliders ?? []).map(item => `${item.id}:${item.x}:${item.z}:${item.w}:${item.d}:${item.height}`);
  return [
    props.join('|'), decorations.join('|'), [...state.openedExits].sort().join(','),
    state.player.x.toFixed(1), state.player.z.toFixed(1),
  ].join(';;');
}

function certifiedRoutes(state: GameState, world: WorldDef, query: WorldQuery, prop: PropState, point: Vec2, scale: number): boolean {
  let cache = routeCaches.get(world);
  if (!cache) { cache = new Map(); routeCaches.set(world, cache); }
  const key = routeKey(state, world, prop, point, scale);
  const cached = cache.get(key);
  if (cached && state.elapsed - cached.at <= ROUTE_CACHE_AGE) return cached.safe;
  const safe = mandatoryRoutesUsable(state, world, query);
  if (cache.size >= ROUTE_CACHE_LIMIT) cache.clear();
  cache.set(key, { at: state.elapsed, safe });
  return safe;
}

/**
 * Evaluate the real square footprint used by rendering and collision. The broad
 * WorldQuery placement check uses its circumscribed radius; actor and operating
 * clearances use exact square-vs-circle tests so corners are not missed.
 */
export function safePropPlacement(
  state: GameState,
  world: WorldDef,
  query: WorldQuery,
  prop: PropState,
  point: Vec2 = prop,
  scale = prop.scale,
  checkRoutes = true,
): boolean {
  if (prop.held && state.player.holding !== prop.id) return false;
  if (!Number.isFinite(point.x + point.z + scale) || scale <= 0) return false;
  const { rect, radius, height } = volume(prop, point, scale);
  if (!clearOfActors(state, rect, height) || !clearOfWorkstations(world, rect)) return false;
  const previous = { x: prop.x, z: prop.z, scale: prop.scale, held: prop.held, y: prop.y };
  try {
    prop.x = point.x; prop.z = point.z; prop.scale = scale; prop.y = 0;
    // Exclude the candidate itself for the broad static query, then include it
    // for path certification against every other current and measured solid.
    prop.held = true;
    if (!query.validPlacement(point, radius, state)) return false;
    if (!checkRoutes) return true;
    prop.held = false;
    return certifiedRoutes(state, world, query, prop, point, scale);
  } finally {
    prop.x = previous.x; prop.z = previous.z; prop.scale = previous.scale; prop.held = previous.held; prop.y = previous.y;
  }
}
