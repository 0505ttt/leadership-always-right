import * as THREE from 'three';
import type { GameState, Room, WorldDef } from '../contracts/game';
import { VisualResourcePool, addBox, makeLabel } from './visual-utils';

export interface OfficeEffectBindings {
  walls: ReadonlyMap<string, THREE.Mesh>;
  desks: ReadonlyMap<string, THREE.Group>;
  deskLegs: ReadonlyMap<string, THREE.Mesh[]>;
  roomLights: ReadonlyMap<number, THREE.PointLight>;
  roomMaterials: ReadonlyMap<number, THREE.MeshStandardMaterial[]>;
  switchIndicators: ReadonlyMap<number, THREE.MeshBasicMaterial>;
}

export interface OfficeEffects {
  readonly root: THREE.Group;
  readonly ceilings: ReadonlyMap<number, THREE.Group>;
  readonly flows: ReadonlyMap<number, THREE.Group>;
  update(state: GameState): void;
  getDiagnostics(): {
    ceilings: { roomId: number; clearance: number }[];
    desks: { id: string; height: number }[];
    partitions: { id: string; opacity: number }[];
    flows: number[];
  };
}

function pressureCeiling(pool: VisualResourcePool, room: Room): THREE.Group {
  const group = new THREE.Group();
  group.name = `pressure-ceiling:${room.id}`;
  group.position.set(room.x, 2.8, room.z);
  const panel = pool.material({ color: 0x9da99e, roughness: .92, metalness: .03 });
  const rail = pool.material({ color: 0x59665f, roughness: .58, metalness: .45 });
  const light = pool.material({ color: 0xe6e5ce, emissive: 0xdde4c9, emissiveIntensity: .7, roughness: .8 });
  addBox(group, pool, panel, [room.w - .18, .12, room.d - .18], [0, .06, 0]);
  // The whole assembly stays above the authoritative underside. Recessed rails,
  // fixtures and labels must not silently steal clearance below the slab.
  for (let x = -room.w / 2 + 1.2; x < room.w / 2; x += 1.2) addBox(group, pool, rail, [.016, .018, room.d - .28], [x, .009, 0]);
  for (let z = -room.d / 2 + 1.2; z < room.d / 2; z += 1.2) addBox(group, pool, rail, [room.w - .28, .018, .016], [0, .009, z]);
  for (const z of [-5, 4]) {
    addBox(group, pool, rail, [2.28, .055, .42], [0, .0275, z]);
    addBox(group, pool, light, [2.08, .018, .31], [0, .009, z]);
  }
  if (room.pressure) {
    const warning = makeLabel(pool, '活动顶板  ·  注意净高', { width: 2.35, height: .26, foreground: '#3c3b30', background: '#d7bb6c', fontSize: 49 });
    warning.position.set(0, 0, -room.d / 2 + .65);
    warning.rotation.x = Math.PI / 2;
    group.add(warning);
    for (const x of [-room.w / 2 + .32, room.w / 2 - .32]) addBox(group, pool, pool.material({ color: 0xc6a14e, roughness: .8 }), [.12, .025, room.d - .4], [x, .0125, 0]);
  }
  return group;
}

function flowVisual(pool: VisualResourcePool, room: Room): THREE.Group {
  const group = new THREE.Group();
  group.name = `reverse-flow:${room.id}`;
  group.position.set(room.x, .016, room.z);
  const material = pool.basic({ color: 0xe3bd68, transparent: true, opacity: .58, side: THREE.DoubleSide, depthWrite: false });
  for (let index = -3; index <= 3; index++) {
    const shape = new THREE.Shape();
    shape.moveTo(-.42, -.18);
    shape.lineTo(0, .34);
    shape.lineTo(.42, -.18);
    shape.lineTo(.2, -.18);
    shape.lineTo(0, .08);
    shape.lineTo(-.2, -.18);
    shape.closePath();
    const geometry = pool.geometry(`flow-chevron:${room.id}:${index}`, () => new THREE.ShapeGeometry(shape));
    const arrow = new THREE.Mesh(geometry, material);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0, index * 1.45);
    group.add(arrow);
  }
  const label = makeLabel(pool, '逆向通道  ·  顺流更难', { width: 2.2, height: .27, foreground: '#4d4634', background: '#d5bc7c', fontSize: 47 });
  label.position.set(0, .004, -5.75);
  label.rotation.x = -Math.PI / 2;
  group.add(label);
  group.visible = false;
  return group;
}

/** Applies authoritative rule state to meshes. No timers, collision, targets or rule transitions live here. */
export function createOfficeEffects(world: WorldDef, bindings: OfficeEffectBindings, pool: VisualResourcePool): OfficeEffects {
  const root = new THREE.Group();
  root.name = 'office-rule-effects';
  const ceilings = new Map<number, THREE.Group>();
  const flows = new Map<number, THREE.Group>();
  const lightValues = new Map<number, boolean>();
  for (const room of world.rooms) {
    const ceiling = pressureCeiling(pool, room);
    root.add(ceiling);
    ceilings.set(room.id, ceiling);
    const flow = flowVisual(pool, room);
    root.add(flow);
    flows.set(room.id, flow);
    for (const material of bindings.roomMaterials.get(room.id) ?? []) material.userData.baseColor ??= material.color.clone();
  }

  return {
    root,
    ceilings,
    flows,
    update(state) {
      for (const room of world.rooms) {
        const lit = room.permanentLight || !!state.lights[room.id];
        const light = bindings.roomLights.get(room.id);
        if (light) light.intensity = lit ? 19 : .35;
        const indicator = bindings.switchIndicators.get(room.id);
        if (indicator) indicator.color.set(lit ? 0xa8edb6 : 0xc27b4d);
        if (lightValues.get(room.id) !== lit) {
          lightValues.set(room.id, lit);
          for (const material of bindings.roomMaterials.get(room.id) ?? []) {
            const base = material.userData.baseColor as THREE.Color;
            material.color.copy(base).multiplyScalar(lit ? 1 : .56);
          }
        }
        const clearance = state.pressureRooms.includes(room.id) ? state.pressureHeights[room.id] ?? 1.6 : 2.8;
        ceilings.get(room.id)!.position.y = clearance;
        const flow = flows.get(room.id)!;
        flow.visible = state.flowRooms.includes(room.id);
        if (flow.visible) {
          const material = (flow.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
          material.opacity = .48 + Math.sin(state.elapsed * 3.2) * .12;
        }
      }
      for (const wall of world.walls) {
        const mesh = bindings.walls.get(wall.id);
        if (!mesh) continue;
        const material = mesh.material as THREE.MeshStandardMaterial;
        const transparent = state.transparentWalls.includes(wall.id);
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
        material.opacity = transparent ? .2 : 1;
        material.depthWrite = !transparent;
      }
      for (const desk of world.desks) {
        const height = state.deskHeights[desk.id] ?? .75;
        const visual = bindings.desks.get(desk.id);
        if (visual) visual.position.y = height;
        const footTop = .035;
        const underside = height - .1155; // The real lower frame, below both the wood and its inset.
        const outerLength = Math.max(.05, (underside - footTop) * .58);
        for (const leg of bindings.deskLegs.get(desk.id) ?? []) {
          if (leg.userData.deskLegRole === 'outer') {
            leg.scale.y = outerLength;
            leg.position.y = footTop + outerLength / 2;
          } else if (leg.userData.deskLegRole === 'inner') {
            const bottom = footTop + Math.max(.02, outerLength - .1);
            leg.scale.y = Math.max(.02, underside - bottom);
            leg.position.y = bottom + leg.scale.y / 2;
          }
        }
      }
    },
    getDiagnostics() {
      return {
        ceilings: [...ceilings].map(([roomId, mesh]) => ({ roomId, clearance: mesh.position.y })),
        desks: [...bindings.desks].map(([id, mesh]) => ({ id, height: mesh.position.y })),
        partitions: [...bindings.walls].filter(([id]) => id.startsWith('partition-')).map(([id, mesh]) => ({ id, opacity: (mesh.material as THREE.MeshStandardMaterial).opacity })),
        flows: [...flows].filter(([, mesh]) => mesh.visible).map(([roomId]) => roomId),
      };
    },
  };
}
