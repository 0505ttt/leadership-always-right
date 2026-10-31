import * as THREE from 'three';
import type { GameState, Room, StaticDecorationCollider, Vec2, Wall, WorldDef } from '../contracts/game';
import { VisualResourcePool, makeLabel } from './visual-utils';
import { RoomDecorationKit } from './room-decoration-kit';
import { batchStaticRoomDecorations } from './static-batch';

export type RoomDecorationModelId = 'printer-v1' | 'storage-shelf-v1' | 'mug-v1' | 'paper-stack-v1' | 'stationery-v1' | 'water-station-v1' | 'box-v1' | 'plant-v1';
export interface RoomDecorationCollider extends StaticDecorationCollider { yaw: number; note: string }
export interface RoomDecorationOptions {
  models?: (id: RoomDecorationModelId) => THREE.Object3D | undefined;
  reservedColliders?: readonly StaticDecorationCollider[];
}
export interface RoomDecorationUpdateState extends Pick<GameState, 'deskHeights' | 'transparentWalls'>, Partial<Pick<GameState, 'pressureRooms' | 'pressureHeights'>> {}
export interface DecorationFocusPoint { roomId: number; kind: 'sign' | 'material' | 'overview'; position: [number, number, number]; target: [number, number, number] }
export interface RoomDecorationDiagnostics {
  rooms: { roomId: number; name: string; kind: string; placed: number; signs: number; colliders: number }[];
  skipped: { roomId: number; id: string; reason: string }[];
  missingModels: RoomDecorationModelId[];
  materials: string[];
  colliders: readonly RoomDecorationCollider[];
  wallAttachments: { id: string; roomId: number; wallId: string; position: [number, number, number]; width: number; height: number }[];
  focusPoints: readonly DecorationFocusPoint[];
  violations: string[];
  staticBatches?: { sourceMeshes: number; mergedMeshes: number };
}
export interface RoomDecorations {
  readonly root: THREE.Group;
  readonly decorationColliders: readonly RoomDecorationCollider[];
  prepare(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene?: THREE.Scene): Promise<void>;
  update(state: RoomDecorationUpdateState): void;
  getDiagnostics(): RoomDecorationDiagnostics;
  dispose(): void;
}

type Interval = { lo: number; hi: number };
type WallSide = { wall: Wall; vertical: boolean; normal: Vec2; tangent: Vec2; intervals: Interval[]; yaw: number };
type Footprint = { x: number; z: number; w: number; d: number; height?: number; id?: string };
type FloorSpec = { w: number; d: number; h: number; yaw?: number; visualOnly?: boolean; note?: string };
type PlacementPart = { id: string; object: THREE.Object3D; spec: FloorSpec; offset: Vec2 };

const WORK_COPY: Record<string, { short: string; title: string; lines: string[]; pin: string[] }> = {
  '第二事业部': { short: '第二事业部 · 交付', title: '交付板｜本周验收', lines: ['V2.4  待验收  小周', '客户回执  已收到', '风险：周五仍是周五'], pin: ['文件流转', '先登记，再转身'] },
  '增长一组': { short: '增长一组 · 复盘', title: '增长复盘｜实验 047', lines: ['访问  1,280  ↑ 8%', '留下  312  → 观察', '结论：先保留证据'], pin: ['实验便签', '不把愿望写成曲线'] },
  '产品三组': { short: '产品三组 · 需求', title: '需求停车场', lines: ['待澄清：入口在哪里', '暂缓：再加一个入口', '已拒绝：删掉出口'], pin: ['需求归档', '停车场禁止超车'] },
};
const ROOM_LABEL: Record<string, string> = { work: '办公区', meeting: '会议区', front: '接待区', tea: '茶水间', boss: '总经理室', storage: '储物间', admin: '行政服务', print: '打印中心' };

function subtract(intervals: Interval[], blocked: Interval): Interval[] {
  return intervals.flatMap(interval => {
    if (blocked.hi <= interval.lo || blocked.lo >= interval.hi) return [interval];
    const result: Interval[] = [];
    if (blocked.lo > interval.lo) result.push({ lo: interval.lo, hi: Math.min(blocked.lo, interval.hi) });
    if (blocked.hi < interval.hi) result.push({ lo: Math.max(blocked.hi, interval.lo), hi: interval.hi });
    return result;
  });
}
function overlaps(a: Footprint, b: Footprint, margin: number): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margin && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + margin;
}
function dimensions(spec: FloorSpec): { w: number; d: number } {
  const quarter = Math.abs(Math.sin(spec.yaw ?? 0)) > .5;
  return { w: quarter ? spec.d : spec.w, d: quarter ? spec.w : spec.d };
}
function rotatedOffset(offset: Vec2, yaw: number): Vec2 {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return { x: offset.x * cos + offset.z * sin, z: -offset.x * sin + offset.z * cos };
}

/** Independent room dressing. World geometry is read-only; all placements are derived from its final coordinates. */
export function createRoomDecorations(world: WorldDef, options: RoomDecorationOptions = {}): RoomDecorations {
  const pool = new VisualResourcePool();
  const kit = new RoomDecorationKit(pool);
  const root = new THREE.Group();
  root.name = 'room-decorations';
  const colliders: RoomDecorationCollider[] = [];
  const skipped: RoomDecorationDiagnostics['skipped'] = [];
  const missingModels = new Set<RoomDecorationModelId>();
  const wallAttachments: RoomDecorationDiagnostics['wallAttachments'] = [];
  const focusPoints: DecorationFocusPoint[] = [];
  const violations: string[] = [];
  const activePressureHeights = new Map<number, number>();
  const wallBindings: { object: THREE.Object3D; wallId: string; roomId: number; baseY: number; height: number }[] = [];
  const deskTags = new Map<string, THREE.Group>();
  const floorSolids: Footprint[] = [];
  const roomStats = new Map<number, { placed: number; signs: number; colliders: number }>();
  const wallReservations = new Map<string, Interval[]>();
  const rugRooms = new Set<number>();

  const baseObstacles: Footprint[] = [
    ...world.desks.flatMap<Footprint>(desk => {
      const workPoint = desk.workPoint ?? desk.seat;
      return [
        { x: desk.x, z: desk.z, w: 1.72, d: .98, id: desk.id },
        { x: desk.seat.x, z: desk.seat.z, w: .82, d: .86, id: `${desk.id}:seat` },
        { x: workPoint.x, z: workPoint.z, w: .82, d: .86, id: `${desk.id}:workPoint` },
        {
          x: (desk.seat.x + workPoint.x) / 2,
          z: (desk.seat.z + workPoint.z) / 2,
          w: Math.abs(desk.seat.x - workPoint.x) + .82,
          d: Math.abs(desk.seat.z - workPoint.z) + .86,
          id: `${desk.id}:docking`,
        },
      ];
    }),
    ...world.colleagues.map<Footprint>(person => ({ x: person.x, z: person.z, w: .76, d: .76, id: `colleague:${person.id}` })),
    ...world.rooms.map<Footprint>(room => ({
      x: room.switch.x + Math.sin(room.switch.yaw ?? 0) * .65,
      z: room.switch.z + Math.cos(room.switch.yaw ?? 0) * .65,
      w: .85, d: .85, id: `switch-operating:${room.id}`,
    })),
    ...world.patrol.map<Footprint>((point, index) => ({ x: point.x, z: point.z, w: .85, d: .85, id: `patrol:${index}` })),
    ...world.props.map<Footprint>(prop => ({ x: prop.x, z: prop.z, w: prop.kind === 'cake' ? 1.8 : prop.kind === 'bed' ? 2.05 : .85, d: prop.kind === 'cake' ? 1.8 : prop.kind === 'bed' ? 1.25 : .85, id: prop.id })),
    ...world.stations.flatMap<Footprint>(station => [
      { x: station.x, z: station.z, w: 1.35, d: 1.35, id: station.id },
      { x: station.x + Math.sin(station.yaw) * .55, z: station.z + Math.cos(station.yaw) * .55, w: .75, d: .75, id: `${station.id}:machine` },
    ]),
    ...world.exits.map<Footprint>(exit => ({ x: exit.x - exit.outward.x * .75, z: exit.z - exit.outward.z * .75, w: 2.25, d: 2.25, id: exit.id })),
    ...world.doors.map<Footprint>(door => ({ x: door.x, z: door.z, w: door.axis === 'x' ? door.width + .55 : 1.35, d: door.axis === 'z' ? door.width + .55 : 1.35, id: door.id })),
    ...world.walls.filter(wall => wall.partition).map<Footprint>(wall => ({ x: wall.x, z: wall.z, w: wall.w, d: wall.d, id: wall.id })),
    ...(options.reservedColliders ?? []).map<Footprint>(item => ({ ...item })),
  ];

  function wallSides(room: Room, forSigns = false): WallSide[] {
    const result: WallSide[] = [];
    for (const wall of world.walls) {
      if (wall.partition || wall.crawl) continue;
      const vertical = wall.d > wall.w;
      const onBoundary = vertical ? Math.abs(Math.abs(wall.x - room.x) - room.w / 2) < .13 : Math.abs(Math.abs(wall.z - room.z) - room.d / 2) < .13;
      if (!onBoundary) continue;
      const normal = vertical ? { x: Math.sign(room.x - wall.x), z: 0 } : { x: 0, z: Math.sign(room.z - wall.z) };
      if (!normal.x && !normal.z) continue;
      const wallCoordinate = vertical ? wall.x : wall.z;
      const faceCoordinate = wallCoordinate + (vertical ? normal.x * wall.w / 2 : normal.z * wall.d / 2);
      const lo = Math.max(vertical ? wall.z - wall.d / 2 : wall.x - wall.w / 2, vertical ? room.z - room.d / 2 : room.x - room.w / 2) + .1;
      const hi = Math.min(vertical ? wall.z + wall.d / 2 : wall.x + wall.w / 2, vertical ? room.z + room.d / 2 : room.x + room.w / 2) - .1;
      if (hi - lo < .25) continue;
      let intervals: Interval[] = [{ lo, hi }];
      for (const door of world.doors) {
        if (door.axis !== (vertical ? 'z' : 'x')) continue;
        if (Math.abs((vertical ? door.x : door.z) - wallCoordinate) > .4) continue;
        const center = vertical ? door.z : door.x;
        intervals = subtract(intervals, { lo: center - door.width / 2 - .32, hi: center + door.width / 2 + .32 });
      }
      for (const exit of world.exits) {
        if (Math.abs((vertical ? exit.x : exit.z) - wallCoordinate) > .65) continue;
        const center = vertical ? exit.z : exit.x;
        intervals = subtract(intervals, { lo: center - 1.55, hi: center + 1.55 });
      }
      if (room.switch.wallId === wall.id || Math.hypot(room.switch.x - faceCoordinate * (vertical ? 1 : 0) - (vertical ? 0 : room.switch.x), vertical ? 0 : room.switch.z - faceCoordinate) < .2) {
        const center = vertical ? room.switch.z : room.switch.x;
        intervals = subtract(intervals, { lo: center - .37, hi: center + .37 });
      }
      if (forSigns) for (const reserved of wallReservations.get(`${room.id}:${wall.id}`) ?? []) intervals = subtract(intervals, reserved);
      result.push({ wall, vertical, normal, intervals, tangent: vertical ? { x: 0, z: 1 } : { x: 1, z: 0 }, yaw: normal.x > 0 ? Math.PI / 2 : normal.x < 0 ? -Math.PI / 2 : normal.z > 0 ? 0 : Math.PI });
    }
    return result.sort((a, b) => a.wall.id.localeCompare(b.wall.id));
  }

  function wallPosition(side: WallSide, along: number, y: number, offset = .014): THREE.Vector3 {
    const thickness = side.vertical ? side.wall.w : side.wall.d;
    const coordinate = (side.vertical ? side.wall.x : side.wall.z) + (side.vertical ? side.normal.x : side.normal.z) * (thickness / 2 + offset);
    return side.vertical ? new THREE.Vector3(coordinate, y, along) : new THREE.Vector3(along, y, coordinate);
  }

  function mount(room: Room, id: string, object: THREE.Object3D, width: number, height: number, y: number, kind?: 'sign' | 'material'): boolean {
    const low = world.rooms.find(item => item.id === room.id)?.pressure ?? false;
    const actualY = low ? Math.min(y, 1.5 - height / 2) : y;
    const sides = wallSides(room, true).map(side => ({ side, intervals: side.intervals.filter(interval => interval.hi - interval.lo >= width + .16) })).filter(item => item.intervals.length);
    sides.sort((a, b) => {
      const aLength = Math.max(...a.intervals.map(interval => interval.hi - interval.lo));
      const bLength = Math.max(...b.intervals.map(interval => interval.hi - interval.lo));
      return bLength - aLength || a.side.wall.id.localeCompare(b.side.wall.id);
    });
    const rotation = (room.id * 3 + wallAttachments.length) % Math.max(1, sides.length);
    for (let attempt = 0; attempt < sides.length; attempt++) {
      const { side, intervals } = sides[(attempt + rotation) % sides.length];
      for (const interval of intervals) {
        const center = (interval.lo + interval.hi) / 2;
        const candidates = [center, interval.lo + width / 2 + .08, interval.hi - width / 2 - .08];
        const along = candidates.find(value => value - width / 2 >= interval.lo && value + width / 2 <= interval.hi);
        if (along === undefined) continue;
        const frame = new THREE.Group();
        frame.name = id;
        frame.position.copy(wallPosition(side, along, actualY));
        frame.rotation.y = side.yaw;
        frame.userData.visualOnly = true;
        frame.add(object);
        root.add(frame);
        wallBindings.push({ object: frame, wallId: side.wall.id, roomId: room.id, baseY: actualY, height });
        wallAttachments.push({ id, roomId: room.id, wallId: side.wall.id, position: [frame.position.x, frame.position.y, frame.position.z], width, height });
        const reservationKey = `${room.id}:${side.wall.id}`;
        wallReservations.set(reservationKey, [...wallReservations.get(reservationKey) ?? [], { lo: along - width / 2 - .12, hi: along + width / 2 + .12 }]);
        const stats = roomStats.get(room.id)!; stats.signs++;
        if (kind) {
          const normal = new THREE.Vector3(side.normal.x, 0, side.normal.z);
          const distance = kind === 'sign' ? Math.max(1.65, width * .95) : Math.max(1.45, width * .8);
          const position = frame.position.clone().addScaledVector(normal, distance);
          position.y = kind === 'sign' ? Math.max(1.25, actualY) : Math.max(.95, actualY + .05);
          focusPoints.push({ roomId: room.id, kind, position: [position.x, position.y, position.z], target: [frame.position.x, actualY, frame.position.z] });
        }
        return true;
      }
    }
    skipped.push({ roomId: room.id, id, reason: `没有扣除门洞、出口和开关后的 ${width.toFixed(2)}m 连续墙面` });
    return false;
  }

  function rejection(room: Room, candidate: Footprint, extraFloor: Footprint[] = []): string | undefined {
    if (Math.abs(candidate.x - room.x) + candidate.w / 2 > room.w / 2 - .12 || Math.abs(candidate.z - room.z) + candidate.d / 2 > room.d / 2 - .12) return '超出房间边界';
    if (room.pressure && (candidate.height ?? 0) > 1.5) return `低顶内实体高度 ${candidate.height?.toFixed(2)}m`;
    const external = [...baseObstacles, ...floorSolids].find(obstacle => overlaps(candidate, obstacle, .3));
    if (external) return `与 ${external.id ?? '既有物件'} 净距不足`;
    const internal = extraFloor.find(obstacle => overlaps(candidate, obstacle, .07));
    if (internal) return `与组团 ${internal.id ?? '实体'} 间隙不足`;
    for (const [id, point] of [['spawn', world.spawn], ['bossSpawn', world.bossSpawn]] as const) {
      if (overlaps(candidate, { x: point.x, z: point.z, w: .75, d: .75 }, .3)) return `与 ${id} 净距不足`;
    }
    return undefined;
  }
  function safe(room: Room, candidate: Footprint, extraFloor: Footprint[] = []): boolean {
    return rejection(room, candidate, extraFloor) === undefined;
  }

  function fitSpec(object: THREE.Object3D, spec: FloorSpec): FloorSpec {
    if (spec.visualOnly) return spec;
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    let found = false;
    object.traverse(node => {
      let excluded = false;
      for (let current: THREE.Object3D | null = node; current; current = current.parent) {
        if (current.userData.measureExclude) excluded = true;
        if (current === object) break;
      }
      if (excluded || !(node instanceof THREE.Mesh)) return;
      node.geometry.computeBoundingBox();
      if (!node.geometry.boundingBox) return;
      const part = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
      if (found) bounds.union(part);
      else { bounds.copy(part); found = true; }
    });
    if (!found) return spec;
    const size = bounds.getSize(new THREE.Vector3());
    return { ...spec, w: Math.max(spec.w, size.x), d: Math.max(spec.d, size.z), h: Math.max(spec.h, bounds.max.y) };
  }

  function registerFloor(room: Room, id: string, object: THREE.Object3D, spec: FloorSpec, position: Vec2, yaw: number): THREE.Group {
    const group = new THREE.Group();
    group.name = id;
    group.position.set(position.x, 0, position.z);
    group.rotation.y = yaw;
    group.userData.visualOnly = spec.visualOnly ?? false;
    group.add(object);
    root.add(group);
    const size = dimensions({ ...spec, yaw });
    if (!spec.visualOnly) {
      floorSolids.push({ x: position.x, z: position.z, ...size, id });
      colliders.push({ id, roomId: room.id, x: position.x, z: position.z, ...size, height: spec.h, yaw, note: spec.note ?? '真实落地陈设候选；由 Codex 实测并统一登记碰撞。' });
      roomStats.get(room.id)!.colliders++;
    }
    if (spec.visualOnly && (id.includes('rug') || id.includes('zone'))) rugRooms.add(room.id);
    roomStats.get(room.id)!.placed++;
    return group;
  }

  function placeNearWall(room: Room, id: string, object: THREE.Object3D, spec: FloorSpec): THREE.Group | undefined {
    spec = fitSpec(object, spec);
    const sides = wallSides(room, true);
    for (const side of sides) {
      const width = Math.abs(Math.sin(side.yaw)) > .5 ? spec.d : spec.w;
      for (const interval of side.intervals) {
        if (interval.hi - interval.lo < width + .18) continue;
        const positions = [(interval.lo + interval.hi) / 2, interval.lo + width / 2 + .09, interval.hi - width / 2 - .09];
        for (const along of positions) {
          const size = dimensions({ ...spec, yaw: side.yaw });
          const position = wallPosition(side, along, 0, size.d / 2 + .09);
          const candidate = { x: position.x, z: position.z, w: size.w, d: size.d, height: spec.h };
          if (!safe(room, candidate)) continue;
          return registerFloor(room, id, object, spec, candidate, side.yaw);
        }
      }
    }
    skipped.push({ roomId: room.id, id, reason: '贴墙落点与桌位、门、出口、现有物件或巡逻安全区间冲突' });
    return undefined;
  }

  function placeOpen(room: Room, id: string, object: THREE.Object3D, spec: FloorSpec, preferred: Vec2 = { x: room.x, z: room.z }): THREE.Group | undefined {
    spec = fitSpec(object, spec);
    const yaws = [spec.yaw ?? 0, (spec.yaw ?? 0) + Math.PI / 2];
    const offsets: Vec2[] = [{ x: 0, z: 0 }, { x: 1.5, z: -2 }, { x: -1.5, z: -2 }, { x: 1.8, z: 2.2 }, { x: -1.8, z: 2.2 }, { x: 0, z: -3.4 }, { x: 0, z: 3.4 }];
    for (let x = -3; x <= 3; x++) for (let z = -6; z <= 6; z++) offsets.push({ x: x * 1.05, z: z * 1.05 });
    for (const yaw of yaws) {
      const size = dimensions({ ...spec, yaw });
      for (const offset of offsets) {
        const candidate = { x: preferred.x + offset.x, z: preferred.z + offset.z, ...size, height: spec.h };
        if (safe(room, candidate)) return registerFloor(room, id, object, spec, candidate, yaw);
      }
    }
    skipped.push({ roomId: room.id, id, reason: '开放区域没有满足占地与巡逻净距的落点' });
    return undefined;
  }

  function placeAssembly(room: Room, id: string, parts: PlacementPart[], preferred: Vec2 = { x: room.x, z: room.z }): THREE.Group[] {
    const prepared = parts.map(part => ({ ...part, spec: fitSpec(part.object, part.spec) }));
    const offsets: Vec2[] = [{ x: 0, z: 0 }, { x: 1.5, z: -2 }, { x: -1.5, z: -2 }, { x: 1.8, z: 2.2 }, { x: -1.8, z: 2.2 }, { x: 0, z: -3.4 }, { x: 0, z: 3.4 }];
    for (let x = -3; x <= 3; x++) for (let z = -6; z <= 6; z++) offsets.push({ x: x * 1.05, z: z * 1.05 });
    let lastFailure = '未记录冲突';
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const offset of offsets) {
        const anchor = { x: preferred.x + offset.x, z: preferred.z + offset.z };
        const placements: { part: PlacementPart; position: Vec2; yaw: number; size: { w: number; d: number } }[] = [];
        const accepted: Footprint[] = [];
        let valid = true;
        for (const part of prepared) {
          const local = rotatedOffset(part.offset, yaw);
          const position = { x: anchor.x + local.x, z: anchor.z + local.z };
          const partYaw = yaw + (part.spec.yaw ?? 0);
          const size = dimensions({ ...part.spec, yaw: partYaw });
          const candidate = { x: position.x, z: position.z, ...size, height: part.spec.h, id: `${id}:${part.id}` };
          const outside = Math.abs(candidate.x - room.x) + candidate.w / 2 > room.w / 2 - .12 || Math.abs(candidate.z - room.z) + candidate.d / 2 > room.d / 2 - .12;
          if (outside || (!part.spec.visualOnly && !safe(room, candidate, accepted))) {
            lastFailure = `${part.id}@${position.x.toFixed(2)},${position.z.toFixed(2)}：${outside ? '超出房间边界' : rejection(room, candidate, accepted)}`;
            valid = false; break;
          }
          if (!part.spec.visualOnly) accepted.push(candidate);
          placements.push({ part, position, yaw: partYaw, size });
        }
        if (valid) return placements.map(({ part, position, yaw: partYaw }) => registerFloor(room, `${id}:${part.id}`, part.object, part.spec, position, partYaw));
      }
    }
    skipped.push({ roomId: room.id, id, reason: `组团没有满足完整落点；最后冲突 ${lastFailure}` });
    return [];
  }

  function addModel(parent: THREE.Object3D, id: RoomDecorationModelId, position: readonly [number, number, number], yaw = 0): boolean {
    const source = options.models?.(id);
    if (!source) { missingModels.add(id); return false; }
    const model = source.clone(true);
    model.name = `room-decoration-model:${id}`;
    model.position.set(...position);
    model.rotation.y = yaw;
    model.userData.visualOnly = false;
    // Countertop foliage is a local visual detail; the cabinet already reserves
    // the whole footprint. Do not inflate it into a room-height blocking box.
    if (id === 'plant-v1' && position[1] > 0) model.userData.measureExclude = true;
    parent.add(model);
    return true;
  }

  function roomNameSign(room: Room): void {
    const subtitle = ROOM_LABEL[room.kind] ?? '办公区';
    const lines = room.name === subtitle ? [room.name] : [room.name, subtitle];
    mount(room, `room-sign:${room.id}`, kit.sign({ text: lines.join('\n'), width: 2.05, height: .43, lines, fontSize: 59, accent: '#2152e7', background: '#2152e7', foreground: '#fafaf8' }), 2.05, .43, 2.17, 'sign');
  }

  function front(room: Room): void {
    const company = new THREE.Group();
    const title = kit.sign({ text: '甩锅有限公司', width: 4.05, height: .72, fontSize: 102, frame: true, background: '#fafaf8', foreground: '#111212', accent: '#2152e7' });
    title.position.y = .21;
    company.add(title);
    const slogan = kit.sign({ text: '把规矩立住，才不烧心', width: 3.35, height: .3, fontSize: 58, frame: false, foreground: '#2152e7', background: '#fafaf8' });
    slogan.position.set(0, -.36, .026);
    company.add(slogan);
    mount(room, `company-sign:${room.id}`, company, 4.05, 1.15, 1.69, 'sign');
    const desk = kit.cabinet(2.55, .76, .91, 3);
    const visitor = kit.sign({ text: '访客登记\n姓名 / 来访事项', width: .58, height: .24, lines: ['访客登记', '姓名 / 来访事项'], fontSize: 47, frame: false, background: '#e8e1ce', foreground: '#38453d' });
    visitor.position.set(.68, .95, .08);
    visitor.rotation.x = -Math.PI / 2;
    desk.add(visitor);
    const tray = kit.formTray(.43); tray.position.set(-.67, .95, 0); desk.add(tray);
    const group = placeNearWall(room, `reception-desk:${room.id}`, desk, { w: 2.55, d: .76, h: 1.02, note: '前台接待柜；含台面登记架，前方保留操作区。' });
    if (group) {
      const rug = kit.rug(3.35, 1.85); rug.position.set(0, 0, .72); group.add(rug);
    }
    const clock = kit.wallClock(); mount(room, `front-clock:${room.id}`, clock, .54, .54, 1.77, 'material');
    const side = kit.cabinet(.58, .48, .48, 1);
    addModel(side, 'plant-v1', [0, .52, 0]);
    placeAssembly(room, `front-waiting:${room.id}`, [
      { id: 'bench', object: kit.bench(1.35), spec: { w: 1.35, d: .58, h: .86, note: '双座等候凳；入口侧保留绕行与起身空间。' }, offset: { x: 0, z: 0 } },
      { id: 'side', object: side, spec: { w: .58, d: .48, h: 1.35, note: '等候边桌与既有绿植。' }, offset: { x: 1.1, z: -.05 } },
      { id: 'rug', object: kit.rug(2.55, 1.65), spec: { w: 2.55, d: 1.65, h: .014, visualOnly: true, note: '等候区薄地毯，纯视觉。' }, offset: { x: .42, z: .08 } },
    ], { x: room.x + 1.4, z: room.z + 1.6 });
  }

  function meeting(room: Room): void {
    mount(room, `meeting-agenda:${room.id}`, kit.displayPanel({ text: '今日议程｜从复述到结论\n09:00  输入与确认\n09:30  复述与记录\n10:00  结论：仍需对齐', width: 3.1, height: 1.25, lines: ['今日议程｜从复述到结论', '09:00  输入与确认', '09:30  复述与记录', '10:00  结论：仍需对齐'], fontSize: 54, foreground: '#34483e', background: '#dde1d4', accent: '#c6a065' }), 3.1, 1.25, 1.5, 'material');
    const table = kit.collaborationTable(3.6, 1.35);
    for (const x of [-1.05, 1.05]) {
      addModel(table, 'mug-v1', [x, .695, .32]);
      addModel(table, 'paper-stack-v1', [x * .7, .695, -.24], x * .06);
    }
    let seatIndex = 0;
    const seat = (x: number, z: number, yaw: number): PlacementPart => {
      const object = kit.stool(); object.rotation.y = yaw;
      return { id: `seat-${seatIndex++}`, object, spec: { w: .46, d: .47, h: .88, note: '会议单椅；独立碰撞与接近间隙。' }, offset: { x, z } };
    };
    const parts: PlacementPart[] = [
      { id: 'table', object: table, spec: { w: 3.6, d: 1.35, h: .9, note: '3.6米会议桌与桌面材料。' }, offset: { x: 0, z: 0 } },
    ];
    for (const x of [-1.15, 0, 1.15]) {
      parts.push(seat(x, -1.05, 0), seat(x, 1.05, Math.PI));
    }
    parts.push(seat(-2.12, 0, Math.PI / 2), seat(2.12, 0, -Math.PI / 2));
    const media = kit.cabinet(1.65, .5, .68, 2);
    if (!room.pressure) addModel(media, 'plant-v1', [.48, .72, 0]);
    parts.push(
      { id: 'media', object: media, spec: { w: 1.65, d: .5, h: room.pressure ? .75 : 1.95, note: '低媒体柜与既有绿植；不作为中央隔断。' }, offset: { x: 0, z: -2.05 } },
      { id: 'rug', object: kit.rug(5.25, 3.35), spec: { w: 5.25, d: 3.35, h: .014, visualOnly: true, note: '会议组薄地毯，纯视觉。' }, offset: { x: 0, z: .05 } },
    );
    placeAssembly(room, `meeting-set:${room.id}`, parts, { x: room.x - .3, z: room.z + 1.2 });
  }

  function printing(room: Room): void {
    mount(room, `print-workflow:${room.id}`, kit.sign({ text: '打印中心｜取件核对\n待取：文件名 / 页数\n重印：注明卡纸位置\n回收：不要混入新纸', width: 2.45, height: 1.02, lines: ['打印中心｜取件核对', '待取：文件名 / 页数', '重印：注明卡纸位置', '回收：不要混入新纸'], fontSize: 52, foreground: '#394a40', background: '#e8e1ce' }), 2.45, 1.02, 1.42, 'sign');
    const cabinet = kit.cabinet(1.65, .7, .77, 2);
    addModel(cabinet, 'printer-v1', [0, .815, -.02]);
    const tray = kit.formTray(.38); tray.position.set(.54, .82, .03); cabinet.add(tray);
    const rack = kit.shelf(1.05, .42, 1.45, 4);
    for (let level = 0; level < 3; level++) for (const x of [-.25, .25]) addModel(rack, 'paper-stack-v1', [x, .16 + level * .423, 0]);
    const recycle = kit.cabinet(.65, .5, .52, 1);
    addModel(recycle, 'box-v1', [0, .565, 0]);
    placeAssembly(room, `print-workflow:${room.id}`, [
      { id: 'printer', object: cabinet, spec: { w: 1.65, d: .7, h: 1.14, note: '打印柜与取件操作面。' }, offset: { x: 0, z: 0 } },
      { id: 'paper', object: rack, spec: { w: 1.05, d: .42, h: 1.45, yaw: Math.PI / 2, note: '垂直纸张架；独立碰撞，不封住L形内部。' }, offset: { x: 1.25, z: .55 } },
      { id: 'recycle', object: recycle, spec: { w: .65, d: .5, h: 1.17, note: '回收低柜与纸箱。' }, offset: { x: -1.3, z: .55 } },
      { id: 'zone', object: kit.rug(3.5, 2.1), spec: { w: 3.5, d: 2.1, h: .014, visualOnly: true, note: '打印工作区薄地毯，纯视觉。' }, offset: { x: 0, z: .3 } },
    ], { x: room.x - 1.2, z: room.z + 1.1 });
  }

  function storage(room: Room): void {
    mount(room, `archive-index:${room.id}`, kit.sign({ text: '档案索引｜B 区\nB01—B12  旧愿景\nB13—B24  已撤回流程\n领用：登记编号与归还日', width: 2.25, height: 1.0, lines: ['档案索引｜B 区', 'B01—B12  旧愿景', 'B13—B24  已撤回流程', '领用：登记编号与归还日'], fontSize: 51, foreground: '#443f32', background: '#d5c8a8' }), 2.25, 1.0, 1.41, 'material');
    const shelf = new THREE.Group();
    if (!addModel(shelf, 'storage-shelf-v1', [0, 0, 0])) shelf.add(kit.shelf(2.1, .28, 1.82, 5));
    for (let index = 0; index < 4; index++) {
      const label = makeLabel(pool, `B${String(index * 3 + 1).padStart(2, '0')}—B${String(index * 3 + 3).padStart(2, '0')}`, { width: .38, height: .105, foreground: '#4b4131', background: '#dfd1ae', fontSize: 48 });
      label.position.set(-.75 + index * .5, 1.62, .153); shelf.add(label);
    }
    const cart = kit.cabinet(.95, .46, .67, 1);
    addModel(cart, 'box-v1', [0, .715, 0]);
    const low = kit.cabinet(.72, .48, .45, 1);
    addModel(low, 'box-v1', [0, .49, 0]);
    placeAssembly(room, `archive-group:${room.id}`, [
      { id: 'shelf', object: shelf, spec: { w: 2.1, d: .28, h: 1.82, note: '编号档案货架；保持落地，不增加可攀爬层板。' }, offset: { x: 0, z: 0 } },
      { id: 'return', object: cart, spec: { w: .95, d: .46, h: 1.27, note: '档案归还低柜与纸箱。' }, offset: { x: 1.45, z: .75 } },
      { id: 'low', object: low, spec: { w: .72, d: .48, h: 1.05, note: '旧档案低岛。' }, offset: { x: -1.25, z: .65 } },
      { id: 'zone', object: kit.rug(3.1, 1.65), spec: { w: 3.1, d: 1.65, h: .014, visualOnly: true, note: '归还区薄色带，纯视觉。' }, offset: { x: 0, z: .55 } },
    ], { x: room.x - .6, z: room.z + 1.0 });
  }

  function tea(room: Room): void {
    mount(room, `tea-duty:${room.id}`, kit.sign({ text: '茶水间值日\n周一  小周｜周二  老陈\n杯子离桌，责任到人', width: 1.95, height: .82, lines: ['茶水间值日', '周一  小周｜周二  老陈', '杯子离桌，责任到人'], fontSize: 53, foreground: '#3d493e', background: '#d9d2b8' }), 1.95, .82, 1.42, 'sign');
    const counter = kit.cabinet(2.15, .61, .86, 3);
    for (const x of [-.63, -.42, -.21]) addModel(counter, 'mug-v1', [x, .9, .08]);
    addModel(counter, 'stationery-v1', [.61, .9, .03]);
    if (!room.pressure) addModel(counter, 'plant-v1', [.82, .9, -.05]);
    const splash = kit.sign({ text: '杯架｜洗净后排回杯柄朝右', width: 1.62, height: .18, fontSize: 48, frame: false, background: '#c4c8b9', foreground: '#405046' });
    splash.position.set(0, 1.18, -.295); splash.rotation.y = Math.PI; counter.add(splash);
    placeNearWall(room, `tea-counter:${room.id}`, counter, { w: 2.15, d: .61, h: 1.22, note: '茶水低柜与杯架；柜前不作为通路。' });
    const water = new THREE.Group();
    if (addModel(water, 'water-station-v1', [0, 0, 0])) {
      placeNearWall(room, `tea-water:${room.id}`, water, { w: .58, d: .48, h: 1.04, note: '既有饮水器；前方留接水站位。' });
    } else {
      skipped.push({ roomId: room.id, id: `tea-water:${room.id}`, reason: '缺少既有饮水器模型，未放置空实体或空碰撞' });
    }
    const left = kit.stool(), right = kit.stool(); left.rotation.y = right.rotation.y = Math.PI;
    placeAssembly(room, `tea-pause:${room.id}`, [
      { id: 'left', object: left, spec: { w: .46, d: .47, h: .88, note: '茶水短暂停留席。' }, offset: { x: -.55, z: 0 } },
      { id: 'right', object: right, spec: { w: .46, d: .47, h: .88, note: '茶水短暂停留席。' }, offset: { x: .55, z: 0 } },
      { id: 'table', object: kit.lowTable(.85, .55, .62), spec: { w: .85, d: .55, h: .66, note: '茶水小边桌。' }, offset: { x: 0, z: .72 } },
      { id: 'rug', object: kit.rug(2.35, 1.75), spec: { w: 2.35, d: 1.75, h: .014, visualOnly: true, note: '茶水停留区薄地毯，纯视觉。' }, offset: { x: 0, z: .3 } },
    ], { x: room.x + 1.0, z: room.z + 1.2 });
  }

  function boss(room: Room): void {
    mount(room, `boss-award:${room.id}`, kit.sign({ text: '年度最具解释权领导\n获奖理由：定义始终稳定\n除非定义需要调整', width: 2.35, height: .92, lines: ['年度最具解释权领导', '获奖理由：定义始终稳定', '除非定义需要调整'], fontSize: 54, foreground: '#ead8ae', background: '#303b37' }), 2.35, .92, 1.53, 'material');
    const background = kit.shelf(1.8, .36, 1.55, 4);
    for (let index = 0; index < 3; index++) addModel(background, 'paper-stack-v1', [-.52 + index * .52, .59, 0], index * .06);
    addModel(background, 'box-v1', [.48, .17, 0]);
    placeNearWall(room, `boss-background:${room.id}`, background, { w: 1.8, d: .36, h: 1.55, note: '总经理室开放背景陈列；与普通低柜形成不同轮廓。' });
    const left = kit.stool(), right = kit.stool(); left.rotation.y = right.rotation.y = Math.PI;
    placeAssembly(room, `boss-talk:${room.id}`, [
      { id: 'visitor-left', object: left, spec: { w: .46, d: .47, h: .88, note: '访客席；保留上下座与绕行动线。' }, offset: { x: -1.0, z: 0 } },
      { id: 'visitor-right', object: right, spec: { w: .46, d: .47, h: .88, note: '访客席；保留上下座与绕行动线。' }, offset: { x: 1.0, z: 0 } },
      { id: 'table', object: kit.lowTable(1.35, .65, .69), spec: { w: 1.35, d: .65, h: .72, note: '低会谈桌。' }, offset: { x: 0, z: .55 } },
      { id: 'rug', object: kit.rug(3.4, 2.3), spec: { w: 3.4, d: 2.3, h: .014, visualOnly: true, note: '会谈组地毯，纯视觉。' }, offset: { x: 0, z: .25 } },
    ], { x: room.x - 1.2, z: room.z + 1.3 });
  }

  function admin(room: Room): void {
    mount(room, `admin-notice:${room.id}`, kit.sign({ text: '一次告知｜表单领取\nA01  领用｜A02  报销\nA03  退回原因说明\n请取对应编号，不必重排', width: 2.35, height: 1.04, lines: ['一次告知｜表单领取', 'A01  领用｜A02  报销', 'A03  退回原因说明', '请取对应编号，不必重排'], fontSize: 50, foreground: '#3b493f', background: '#e3ddc9' }), 2.35, 1.04, 1.4, 'sign');
    const cabinet = kit.cabinet(1.95, .52, .79, 3);
    for (const x of [-.57, 0, .57]) { const tray = kit.formTray(.4); tray.position.set(x, .835, 0); cabinet.add(tray); }
    placeNearWall(room, `admin-forms:${room.id}`, cabinet, { w: 1.95, d: .52, h: 1.04, note: '行政表单流转柜；三层表单架在台面内。' });
    const side = kit.cabinet(.55, .45, .55, 1);
    const tray = kit.formTray(.36); tray.position.set(0, .595, 0); side.add(tray);
    const tab = kit.sign({ text: '取号后等候', width: .46, height: .16, fontSize: 46, frame: false, background: '#e8e1ce', foreground: '#3e4b41' }); tab.position.set(0, .32, .241); side.add(tab);
    placeAssembly(room, `admin-waiting:${room.id}`, [
      { id: 'bench', object: kit.bench(1.35), spec: { w: 1.35, d: .58, h: .86, note: '行政等候软凳；保留起身空间。' }, offset: { x: 0, z: 0 } },
      { id: 'side', object: side, spec: { w: .55, d: .45, h: .82, note: '表单等候边柜与取号提示。' }, offset: { x: 1.1, z: -.05 } },
      { id: 'rug', object: kit.rug(2.4, 1.6), spec: { w: 2.4, d: 1.6, h: .014, visualOnly: true, note: '行政等候区薄地毯，纯视觉。' }, offset: { x: .35, z: .1 } },
    ], { x: room.x - 1.2, z: room.z + 1.2 });
  }

  function work(room: Room): void {
    const copy = WORK_COPY[room.name] ?? WORK_COPY['第二事业部'];
    const isGrowth = room.name === '增长一组', isProduct = room.name === '产品三组';
    mount(room, `work-board:${room.id}`, kit.displayPanel({ text: `${copy.title}\n${copy.lines.join('\n')}`, width: isGrowth ? 3.05 : 2.55, height: isGrowth ? 1.28 : 1.03, lines: [copy.title, ...copy.lines], fontSize: 54, foreground: '#3b493f', background: isProduct ? '#9f8059' : isGrowth ? '#d7cba8' : '#dde1d4', accent: '#c6a065' }), isGrowth ? 3.05 : 2.55, isGrowth ? 1.28 : 1.03, 1.52, 'material');
    const tableDepth = isGrowth ? .85 : isProduct ? .72 : .62;
    const tableY = isGrowth || isProduct ? .695 : .865;
    const table = isGrowth || isProduct ? kit.collaborationTable(isGrowth ? 2.4 : 1.55, tableDepth) : kit.cabinet(1.85, tableDepth, .82, 2);
    addModel(table, 'paper-stack-v1', [-.35, tableY, 0], -.08);
    if (isProduct) addModel(table, 'box-v1', [.35, tableY, 0]);
    else addModel(table, 'stationery-v1', [.42, tableY, .04]);
    const shelfHeight = room.pressure ? .96 : 1.35;
    const shelf = kit.shelf(isProduct ? .9 : 1.0, .34, shelfHeight, 3);
    addModel(shelf, 'paper-stack-v1', [0, .18, 0]);
    const shelfSpecHeight = shelfHeight + .22;
    const bench = kit.bench(1.35);
    placeNearWall(room, `work-shelf:${room.id}`, shelf, { w: isProduct ? .9 : 1.0, d: .34, h: shelfSpecHeight, note: `${copy.pin[0]}实体资料货架；作为独立背景组。` });
    const preferred = isGrowth ? { x: room.x + 1.4, z: room.z + 1.2 } : isProduct ? { x: room.x - 1.5, z: room.z - 1.2 } : { x: room.x - 1.6, z: room.z + 1.5 };
    placeAssembly(room, `work-island:${room.id}`, [
      { id: 'table', object: table, spec: { w: isGrowth ? 2.4 : isProduct ? 1.55 : 1.85, d: tableDepth, h: isGrowth || isProduct ? .96 : 1.12, note: `${copy.title}功能组。` }, offset: { x: 0, z: 0 } },
      { id: 'bench', object: bench, spec: { w: 1.35, d: .58, h: .86, note: '协作软凳；保留起身和绕行空间。' }, offset: { x: -.25, z: 1.1 } },
      { id: 'rug', object: kit.rug(isGrowth ? 3.4 : 3.0, 2.35), spec: { w: isGrowth ? 3.4 : 3.0, d: 2.35, h: .014, visualOnly: true, note: '部门组团薄地毯，纯视觉。' }, offset: { x: .25, z: .35 } },
    ], preferred);
    for (const desk of world.desks.filter(item => item.roomId === room.id && !item.home)) {
      const tag = new THREE.Group(); tag.name = `desk-department:${desk.id}`; tag.position.set(desk.x, .75, desk.z); tag.rotation.y = desk.yaw; tag.userData.visualOnly = true; tag.userData.dynamicDecoration = true;
      const label = makeLabel(pool, copy.short, { width: .66, height: .12, foreground: '#e8dfc7', background: '#3b5145', fontSize: 46 });
      label.position.set(0, -.13, -.435); label.rotation.y = Math.PI; tag.add(label); root.add(tag); deskTags.set(desk.id, tag);
    }
  }

  function partitionBoards(room: Room): void {
    const copy = WORK_COPY[room.name] ?? { title: ROOM_LABEL[room.kind] ?? room.name, lines: ['事项看板', '记录比口头更有效'], pin: ['公告', '阅读后留在原处'] };
    for (const wall of world.walls.filter(item => item.partition && Math.abs(item.x - room.x) < room.w / 2 && Math.abs(item.z - room.z) < room.d / 2)) {
      const direction = Math.sign(room.z - wall.z) || -1;
      for (const side of [-1, 1]) {
        const normalZ = side === 1 ? direction : -direction;
        const frame = new THREE.Group(); frame.name = `partition-board:${room.id}:${wall.id}:${side}`;
        frame.position.set(wall.x, room.pressure ? 1.02 : 1.42, wall.z + normalZ * (wall.d / 2 + .018));
        frame.rotation.y = normalZ > 0 ? 0 : Math.PI;
        frame.userData.visualOnly = true;
        frame.userData.dynamicDecoration = true;
        const front = side === 1;
        const lines = front ? [copy.title, ...copy.lines] : copy.pin;
        const sign = kit.sign({ text: lines.join('\n'), width: Math.min(2.55, wall.w - .2), height: .82, lines, fontSize: 48, foreground: front ? '#3b4a40' : '#40392c', background: front ? '#dde1d4' : '#9f8059', frame: true });
        frame.add(sign); root.add(frame); wallBindings.push({ object: frame, wallId: wall.id, roomId: room.id, baseY: frame.position.y, height: .82 });
        wallAttachments.push({ id: frame.name, roomId: room.id, wallId: wall.id, position: [frame.position.x, frame.position.y, frame.position.z], width: Math.min(2.55, wall.w - .2), height: .82 });
        roomStats.get(room.id)!.signs++;
      }
    }
  }

  for (const room of world.rooms) {
    roomStats.set(room.id, { placed: 0, signs: 0, colliders: 0 });
    roomNameSign(room);
    if (room.kind === 'front') front(room);
    else if (room.kind === 'meeting') meeting(room);
    else if (room.kind === 'print') printing(room);
    else if (room.kind === 'storage') storage(room);
    else if (room.kind === 'tea') tea(room);
    else if (room.kind === 'boss') boss(room);
    else if (room.kind === 'admin') admin(room);
    else work(room);
    partitionBoards(room);
    focusPoints.push({ roomId: room.id, kind: 'overview', position: [room.x + 3.7, 6.8, room.z + 6.8], target: [room.x, .65, room.z] });
  }

  function finishSurfaces(): void {
    const plane = pool.geometry('decor-finish-plane', () => new THREE.PlaneGeometry(1, 1));
    const dummy = new THREE.Object3D();
    const floors = new THREE.InstancedMesh(plane, kit.floorMaterial, world.rooms.length);
    floors.name = 'room-floor-finish'; floors.userData.visualOnly = true; floors.userData.measureExclude = true;
    floors.castShadow = false; floors.receiveShadow = true;
    for (let index = 0; index < world.rooms.length; index++) {
      const room = world.rooms[index];
      dummy.position.set(room.x, .001, room.z); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.set(room.w, room.d, 1); dummy.updateMatrix();
      floors.setMatrixAt(index, dummy.matrix);
    }
    floors.instanceMatrix.needsUpdate = true; root.add(floors);
    const contacts = new THREE.InstancedMesh(plane, kit.contactMaterial, colliders.length);
    contacts.name = 'room-contact-shadows'; contacts.userData.visualOnly = true; contacts.userData.measureExclude = true;
    contacts.castShadow = contacts.receiveShadow = false;
    for (let index = 0; index < colliders.length; index++) {
      const collider = colliders[index];
      dummy.position.set(collider.x, rugRooms.has(collider.roomId) ? .016 : .004, collider.z);
      dummy.rotation.set(-Math.PI / 2, 0, collider.yaw);
      dummy.scale.set(collider.w * 1.24, collider.d * 1.24, 1); dummy.updateMatrix();
      contacts.setMatrixAt(index, dummy.matrix);
    }
    contacts.instanceMatrix.needsUpdate = true; root.add(contacts);
    for (const room of world.rooms) {
      const candidates = wallSides(room, true).flatMap(side => side.intervals.map(interval => ({ side, interval })));
      if (!candidates.length) continue;
      const { side, interval } = candidates.reduce((best, item) => item.interval.hi - item.interval.lo > best.interval.hi - best.interval.lo ? item : best);
      const width = Math.min(4.8, interval.hi - interval.lo), along = (interval.lo + interval.hi) / 2;
      const frame = new THREE.Group(); frame.name = `wall-finish:${room.id}`;
      frame.position.copy(wallPosition(side, along, .31, .007)); frame.rotation.y = side.yaw;
      frame.userData.visualOnly = true; frame.userData.measureExclude = true;
      kit.box(frame, kit.wallMaterial, [width, .58, .012], [0, 0, 0]);
      kit.box(frame, kit.materials.dark, [width, .024, .016], [0, .302, 0]);
      frame.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = false; });
      root.add(frame);
      wallBindings.push({ object: frame, wallId: side.wall.id, roomId: room.id, baseY: .31, height: .62 });
      wallAttachments.push({ id: frame.name, roomId: room.id, wallId: side.wall.id, position: [frame.position.x, frame.position.y, frame.position.z], width, height: .62 });
    }
  }
  finishSurfaces();

  for (const attachment of wallAttachments) {
    const room = world.rooms.find(item => item.id === attachment.roomId)!;
    const [x, y, z] = attachment.position;
    if (Math.abs(x - room.x) > room.w / 2 + .04 || Math.abs(z - room.z) > room.d / 2 + .04) violations.push(`${attachment.id} 超出房间边界`);
    if (room.pressure && y + attachment.height / 2 > 1.505) violations.push(`${attachment.id} 超过低顶附着物上限`);
  }
  for (const collider of colliders) {
    const room = world.rooms.find(item => item.id === collider.roomId)!;
    if (Math.abs(collider.x - room.x) + collider.w / 2 > room.w / 2 + .001 || Math.abs(collider.z - room.z) + collider.d / 2 > room.d / 2 + .001) violations.push(`${collider.id} 落地家具超出房间边界`);
  }

  const staticBatches = batchStaticRoomDecorations(root, pool);
  return {
    root,
    decorationColliders: colliders,
    async prepare(renderer, camera, scene) {
      const textures = new Set<THREE.Texture>();
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      for (const texture of textures) renderer.initTexture(texture);
      await renderer.compileAsync(root, camera, scene);
    },
    update(state) {
      const transparent = new Set(state.transparentWalls);
      activePressureHeights.clear();
      for (const roomId of state.pressureRooms ?? []) activePressureHeights.set(roomId, state.pressureHeights?.[roomId] ?? 1.6);
      for (const binding of wallBindings) {
        binding.object.visible = !transparent.has(binding.wallId);
        const clearance = activePressureHeights.get(binding.roomId);
        binding.object.position.y = clearance === undefined ? binding.baseY : Math.min(binding.baseY, clearance - .1 - binding.height / 2);
        const attachment = wallAttachments.find(item => item.id === binding.object.name);
        if (attachment) attachment.position = [binding.object.position.x, binding.object.position.y, binding.object.position.z];
      }
      for (const [deskId, tag] of deskTags) tag.position.y = state.deskHeights[deskId] ?? .75;
    },
    getDiagnostics() {
      const currentViolations = [...violations];
      for (const attachment of wallAttachments) {
        const clearance = activePressureHeights.get(attachment.roomId);
        if (clearance !== undefined && attachment.position[1] + attachment.height / 2 > clearance - .1 + .005) {
          currentViolations.push(`${attachment.id} 超过当前低顶附着物上限`);
        }
      }
      return {
        rooms: world.rooms.map(room => ({ roomId: room.id, name: room.name, kind: room.kind, ...roomStats.get(room.id)! })),
        skipped: [...skipped], missingModels: [...missingModels], materials: Object.values(kit.materials).map(material => material.name), colliders,
        wallAttachments: wallAttachments.map(item => ({ ...item, position: [...item.position] })), focusPoints, violations: currentViolations, staticBatches,
      };
    },
    dispose() { root.removeFromParent(); pool.dispose(); },
  };
}
