import * as THREE from 'three';
import type { Room, Wall, WorldDef } from '../contracts/game';
import { createOfficeEffects, type OfficeEffects } from './effects';
import { createDeskClutter } from './props';
import { VisualResourcePool, addBox, addCylinder, makeDeterministicRandom, makeLabel } from './visual-utils';

export interface VisualDecorationCollider {
  id: string;
  roomId: number;
  x: number;
  z: number;
  w: number;
  d: number;
  height: number;
  yaw: number;
  note: string;
}

export interface OfficeEnvironment {
  readonly root: THREE.Group;
  readonly desks: ReadonlyMap<string, THREE.Group>;
  readonly walls: ReadonlyMap<string, THREE.Mesh>;
  readonly decorationColliders: readonly VisualDecorationCollider[];
  readonly effects: OfficeEffects;
  prepare(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene?: THREE.Scene): Promise<void>;
  update(state: Parameters<OfficeEffects['update']>[0]): void;
  getDiagnostics(): ReturnType<OfficeEffects['getDiagnostics']> & { decorationColliders: readonly VisualDecorationCollider[] };
  dispose(): void;
}

interface EnvironmentMaterials {
  trim: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  cabinet: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  fabric: THREE.MeshStandardMaterial;
  plant: THREE.MeshStandardMaterial;
  pot: THREE.MeshStandardMaterial;
}

function palette(pool: VisualResourcePool): EnvironmentMaterials {
  return {
    trim: pool.material({ color: 0xc4c8b9, roughness: .82 }),
    dark: pool.material({ color: 0x303b37, roughness: .72, metalness: .12 }),
    metal: pool.material({ color: 0x747d77, roughness: .45, metalness: .62 }),
    wood: pool.material({ color: 0xa78962, roughness: .72, metalness: .02 }),
    cabinet: pool.material({ color: 0x879087, roughness: .83 }),
    paper: pool.material({ color: 0xe8e1ce, roughness: .97 }),
    fabric: pool.material({ color: 0x596c64, roughness: 1 }),
    plant: pool.material({ color: 0x42604a, roughness: .94 }),
    pot: pool.material({ color: 0x9a8b73, roughness: .91 }),
  };
}

function floorMaterial(pool: VisualResourcePool, room: Room): THREE.MeshStandardMaterial {
  const colors: Record<string, [string, string]> = {
    tea: ['#a8a28f', '#999481'], front: ['#89998b', '#7e9082'], meeting: ['#78867d', '#6e7d74'],
    boss: ['#827968', '#766e60'], storage: ['#88877a', '#7c7d70'], print: ['#839087', '#78867d'],
  };
  const [base, line] = colors[room.kind] ?? ['#718278', '#68796f'];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!;
  context.fillStyle = base;
  context.fillRect(0, 0, 256, 256);
  const random = makeDeterministicRandom(`floor:${room.id}`);
  for (let index = 0; index < 1500; index++) {
    const shade = Math.floor(105 + random() * 70);
    context.fillStyle = `rgba(${shade},${shade + 7},${shade},.055)`;
    context.fillRect(random() * 256, random() * 256, 1.5, 1.5);
  }
  context.strokeStyle = line;
  context.lineWidth = 2;
  context.strokeRect(1, 1, 254, 254);
  const texture = pool.own(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(Math.max(1, room.w / 1.2), Math.max(1, room.d / 1.2));
  texture.anisotropy = 4;
  return pool.material({ map: texture, roughness: .98, color: 0xffffff });
}

function wallFrame(wall: Wall, room: Room, along = 0, y = 0): THREE.Group {
  const vertical = wall.d > wall.w;
  const normal = vertical ? new THREE.Vector3(Math.sign(room.x - wall.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(room.z - wall.z));
  const tangent = vertical ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const group = new THREE.Group();
  group.position.set(wall.x, y, wall.z).addScaledVector(normal, (vertical ? wall.w : wall.d) / 2 + .009).addScaledVector(tangent, along);
  group.rotation.y = normal.x > 0 ? Math.PI / 2 : normal.x < 0 ? -Math.PI / 2 : normal.z > 0 ? 0 : Math.PI;
  return group;
}

function mountedLabel(
  parent: THREE.Object3D,
  pool: VisualResourcePool,
  wall: Wall,
  room: Room,
  text: string,
  options: { along?: number; y: number; width: number; height: number; foreground?: string; background?: string; accent?: string; lines?: string[] },
): void {
  const frame = wallFrame(wall, room, options.along, options.y);
  const label = makeLabel(pool, text, {
    width: options.width, height: options.height, foreground: options.foreground, background: options.background,
    accent: options.accent, lines: options.lines, fontSize: 54,
  });
  frame.add(label);
  parent.add(frame);
}

function addPlant(parent: THREE.Object3D, pool: VisualResourcePool, m: EnvironmentMaterials, x: number, z: number, id:string, model?:THREE.Object3D): void {
  const group = new THREE.Group();
  group.name=id;
  group.position.set(x, 0, z);
  if(model){group.add(model);parent.add(group);return;}
  addCylinder(group, pool, m.pot, [.16, .12], .28, [0, .14, 0], 16);
  addCylinder(group, pool, m.dark, [.018, .025], .68, [0, .58, 0], 8);
  for (let index = 0; index < 9; index++) {
    const angle = index / 9 * Math.PI * 2;
    const leaf = new THREE.Mesh(pool.geometry('office-leaf', () => new THREE.SphereGeometry(1, 8, 5)), m.plant);
    leaf.scale.set(.09, .27, .035);
    leaf.position.set(Math.sin(angle) * .15, .73 + (index % 3) * .12, Math.cos(angle) * .15);
    leaf.rotation.set(Math.cos(angle) * .65, angle, Math.sin(angle) * .65);
    group.add(leaf);
  }
  parent.add(group);
}

function roomFixture(
  parent: THREE.Object3D,
  pool: VisualResourcePool,
  m: EnvironmentMaterials,
  room: Room,
  wall: Wall,
  colliders: VisualDecorationCollider[],
): void {
  if (room.kind === 'work') return;
  const specs: Record<string, { width: number; depth: number; height: number }> = {
    tea: { width: 2.25, depth: .32, height: .9 }, print: { width: 1.35, depth: .32, height: 1.06 },
    storage: { width: 2.1, depth: .28, height: 1.82 }, front: { width: 1.8, depth: .32, height: .47 },
    boss: { width: 1.65, depth: .28, height: .74 }, admin: { width: 1.65, depth: .28, height: .74 },
    meeting: { width: 1.5, depth: .22, height: .46 },
  };
  const spec = specs[room.kind];
  if (!spec) return;
  const frame = wallFrame(wall, room);
  frame.position.add(new THREE.Vector3(Math.sin(frame.rotation.y), 0, Math.cos(frame.rotation.y)).multiplyScalar(spec.depth / 2));
  frame.name = `room-fixture:${room.kind}:${room.id}`;
  parent.add(frame);
  colliders.push({
    id: frame.name, roomId: room.id, x: frame.position.x, z: frame.position.z,
    w: spec.width, d: spec.depth, height: spec.height, yaw: frame.rotation.y,
    note: '贴墙装饰候选占地；未写入玩法碰撞，接入侧如进入路线需统一登记。',
  });

  if (room.kind === 'front') {
    addBox(frame, pool, m.fabric, [spec.width, .15, spec.depth], [0, .39, 0]);
    addBox(frame, pool, m.fabric, [spec.width, .45, .1], [0, .63, -spec.depth / 2 + .04]);
    for (const x of [-.72, .72]) addBox(frame, pool, m.metal, [.055, .36, .24], [x, .18, 0]);
    return;
  }
  if (room.kind === 'meeting') {
    for (const x of [-.48, 0, .48]) {
      addBox(frame, pool, m.fabric, [.4, .08, spec.depth], [x, .42, 0]);
      const back = addBox(frame, pool, m.fabric, [.4, .38, .055], [x, .61, -spec.depth / 2]);
      back.rotation.x = -.08;
    }
    return;
  }
  addBox(frame, pool, m.cabinet, [spec.width, spec.height, spec.depth], [0, spec.height / 2, 0]);
  addBox(frame, pool, m.wood, [spec.width + .035, .035, spec.depth + .025], [0, spec.height + .018, 0]);
  for (const x of [-spec.width * .25, spec.width * .25]) addBox(frame, pool, m.dark, [.18, .018, .025], [x, spec.height * .62, spec.depth / 2 + .014]);

  if (room.kind === 'tea') {
    addBox(frame, pool, m.trim, [.55, .42, .27], [-.58, 1.13, 0]);
    addBox(frame, pool, m.dark, [.42, .25, .015], [-.58, 1.15, .143]);
    addCylinder(frame, pool, m.trim, [.13, .13], .43, [.55, 1.14, 0], 20);
    addCylinder(frame, pool, pool.material({ color: 0x799fa4, roughness: .28, transparent: true, opacity: .72 }), [.12, .12], .25, [.55, 1.42, 0], 20);
    for (const x of [-.1, .12, .32]) addCylinder(frame, pool, m.paper, [.045, .04], .11, [x, .97, .04], 14);
    mountedLabel(parent, pool, wall, room, '饼  请自带\n水  请珍惜', { y: 1.85, width: 1.35, height: .58, foreground: '#42483d', background: '#d8d3b8', accent: '#a37549' });
  } else if (room.kind === 'print') {
    addBox(frame, pool, m.trim, [.88, .48, .3], [0, 1.3, 0]);
    addBox(frame, pool, m.dark, [.62, .045, .22], [0, 1.23, .08]);
    addBox(frame, pool, m.paper, [.55, .012, .2], [0, 1.26, .1]);
    const screen = makeLabel(pool, '卡纸  047', { width: .28, height: .12, foreground: '#b8dec5', background: '#1d3028', fontSize: 49 });
    screen.position.set(.23, 1.45, .157);
    frame.add(screen);
    mountedLabel(parent, pool, wall, room, '打印中心工作\n请对结果负责', { y: 1.92, width: 1.45, height: .52, foreground: '#40483e', background: '#d8d6c4' });
  } else if (room.kind === 'storage') {
    for (const y of [.48, .95, 1.42]) {
      addBox(frame, pool, m.metal, [spec.width + .04, .035, spec.depth + .03], [0, y, 0]);
      for (const x of [-.65, 0, .65]) addBox(frame, pool, pool.material({ color: x === 0 ? 0x8d7653 : 0xa3855c, roughness: .97 }), [.48, .32, spec.depth - .035], [x, y + .18, 0]);
    }
  } else {
    for (let index = 0; index < 4; index++) addBox(frame, pool, index % 2 ? m.paper : m.dark, [.34, .055, .24], [-.5 + index * .32, spec.height + .06 + index * .052, 0]);
    mountedLabel(parent, pool, wall, room, room.kind === 'boss' ? '结果导向\n过程也要留痕' : '行政服务\n本周只收完整表格', { y: 1.65, width: 1.25, height: .54, foreground: '#41463b', background: '#d7d2bd', accent: '#927148' });
  }
}

function dressRoom(parent: THREE.Object3D, pool: VisualResourcePool, m: EnvironmentMaterials, world: WorldDef, room: Room, colliders: VisualDecorationCollider[]): void {
  const candidates = world.walls.filter(wall => wall.roomId === room.id && !wall.partition && !wall.crawl && Math.max(wall.w, wall.d) > 1.6)
    .sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d));
  if (!candidates.length) return;
  mountedLabel(parent, pool, candidates[0], room, room.name, { y: 2.18, width: 2.25, height: .42, foreground: '#ece9d7', background: '#31483e', accent: '#c49a5d' });
  const slogans: Record<string, string[]> = {
    work: ['闭环不是圈', '是把椅子推回原位'], meeting: ['会议纪要已生成', '结论仍在对齐'], front: ['甩锅有限公司', '18:00  仍在奋斗'],
    tea: ['茶水间禁止谈下班', '除非已经打卡'], boss: ['我说的话', '就是物理事实'], storage: ['旧愿景封存处', '领用请登记'],
    admin: ['流程已经简化', '只剩最后七步'], print: ['纸张会卡', '责任不会'],
  };
  const lines = slogans[room.kind] ?? slogans.work;
  if (candidates[1]) mountedLabel(parent, pool, candidates[1], room, lines.join('\n'), { y: 1.55, width: 1.5, height: .7, foreground: '#494b40', background: '#d9d4bd', accent: '#a25f4d', lines });
  if (candidates[2]) mountedLabel(parent, pool, candidates[2], room, '本周之星\n空缺 · 等待自愿者', { y: 1.35, width: 1.15, height: .72, foreground: '#4c4b3f', background: '#cfbd8e', lines: ['本周之星', '空缺 · 等待自愿者'] });
  roomFixture(parent, pool, m, room, candidates[0], colliders);
  if (room.kind === 'front') {
    mountedLabel(parent, pool, candidates[0], room, '18:00', { y: 1.63, width: .85, height: .85, foreground: '#e7e1c9', background: '#2e3f37', accent: '#c59b5f' });
  }
}

/** Complete static office shell and seeded dressing. Topology and solid positions come only from WorldDef. */
export function createOfficeEnvironment(world: WorldDef, options: { lighting?: boolean; models?:(id:'computer-set-v1'|'plant-v1')=>THREE.Object3D|undefined } = {}): OfficeEnvironment {
  const pool = new VisualResourcePool();
  const m = palette(pool);
  const root = new THREE.Group();
  root.name = 'office-environment';
  const desks = new Map<string, THREE.Group>();
  const deskLegs = new Map<string, THREE.Mesh[]>();
  const walls = new Map<string, THREE.Mesh>();
  const roomLights = new Map<number, THREE.PointLight>();
  const roomMaterials = new Map<number, THREE.MeshStandardMaterial[]>();
  const switchIndicators = new Map<number, THREE.MeshBasicMaterial>();
  const decorationColliders: VisualDecorationCollider[] = [];
  const track = (roomId: number, material: THREE.MeshStandardMaterial) => {
    const list = roomMaterials.get(roomId) ?? [];
    list.push(material);
    roomMaterials.set(roomId, list);
    material.userData.baseColor = material.color.clone();
    return material;
  };

  if (options.lighting !== false) {
    root.add(new THREE.HemisphereLight(0xc8d7cf, 0x494c40, .72));
    const daylight = new THREE.DirectionalLight(0xffe3b8, 1.05);
    daylight.position.set(-14, 24, 9);
    root.add(daylight);
  }

  for (const room of world.rooms) {
    addBox(root, pool, track(room.id, floorMaterial(pool, room)), [room.w, .1, room.d], [room.x, -.055, room.z]);
    const wallBase = track(room.id, pool.material({ color: room.kind === 'boss' ? 0xb9b09b : 0xc4c9b8, roughness: .94 }));
    for (const wall of world.walls.filter(item => item.roomId === room.id)) {
      const material = track(room.id, wallBase.clone());
      pool.own(material);
      const height = wall.crawl ? wall.height - .95 : wall.height;
      const mesh = addBox(root, pool, material, [wall.w, height, wall.d], [wall.x, wall.crawl ? (wall.height + .95) / 2 : height / 2, wall.z]);
      mesh.name = `world-wall:${wall.id}`;
      walls.set(wall.id, mesh);
      if (!wall.crawl) {
        addBox(root, pool, m.dark, [wall.w + .012, .12, wall.d + .012], [wall.x, .06, wall.z]);
        // A short partition gets its cap at its real top, never a full-height wall trim.
        addBox(root, pool, m.trim, [wall.w + .014, .035, wall.d + .014], [wall.x, wall.partition ? height - .0175 : 2.62, wall.z]);
      }
    }
    const light = new THREE.PointLight(0xffe9c4, 19, 15, 2);
    light.position.set(room.x, 2.48, room.z);
    root.add(light);
    roomLights.set(room.id, light);

    const switchGroup = new THREE.Group();
    switchGroup.name = `light-switch:${room.id}`;
    switchGroup.position.set(room.switch.x, 1.12, room.switch.z);
    switchGroup.rotation.y = room.switch.yaw ?? 0;
    addBox(switchGroup, pool, m.dark, [.21, .34, .16], [0, 0, 0]);
    addBox(switchGroup, pool, m.trim, [.155, .25, .022], [0, 0, .091]);
    const indicator = pool.basic({ color: 0xa8edb6, toneMapped: false });
    addBox(switchGroup, pool, indicator, [.072, .024, .012], [0, .086, .108]);
    switchIndicators.set(room.id, indicator);
    const switchLabel = makeLabel(pool, '灯', { width: .08, height: .07, foreground: '#39433b', background: 'transparent', transparent: true, fontSize: 64 });
    switchLabel.position.set(0, -.055, .105);
    switchGroup.add(switchLabel);
    root.add(switchGroup);
    dressRoom(root, pool, m, world, room, decorationColliders);
  }

  for (const door of world.doors) {
    const horizontal = door.axis === 'x';
    if (door.crawl) {
      const label = makeLabel(pool, '检修通道  ·  低姿通过', { width: 1.35, height: .22, foreground: '#44473c', background: '#d1bb76', fontSize: 47 });
      label.position.set(door.x, 1.16, door.z);
      root.add(label);
      continue;
    }
    addBox(root, pool, m.dark, [horizontal ? door.width + .18 : .25, .18, horizontal ? .25 : door.width + .18], [door.x, 2.35, door.z]);
    for (const side of [-1, 1]) addBox(root, pool, m.trim, [.1, 2.3, .1], [door.x + (horizontal ? side * (door.width / 2 + .05) : 0), 1.15, door.z + (horizontal ? 0 : side * (door.width / 2 + .05))]);
  }

  for (const desk of world.desks) {
    const top = new THREE.Group();
    top.name = `rising-desk:${desk.id}`;
    top.position.set(desk.x, .75, desk.z);
    top.rotation.y = desk.yaw;
    addBox(top, pool, m.wood, [1.6, .085, .85], [0, -.043, 0]).name = `desktop:${desk.id}`;
    addBox(top, pool, m.dark, [1.48, .035, .73], [0, -.098, 0]).name = `desk-underframe:${desk.id}`;
    const frame = new THREE.Group();
    frame.name = `desk-frame:${desk.id}`;
    frame.position.set(desk.x, 0, desk.z);
    frame.rotation.y = desk.yaw;
    const legs: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const outer = addBox(frame, pool, m.metal, [.09, 1, .67], [side * .69, .2, 0]);
      outer.name = `desk-leg-outer:${desk.id}:${side}`;
      outer.userData.deskLegRole = 'outer';
      const inner = addBox(frame, pool, m.dark, [.064, 1, .58], [side * .69, .5, 0]);
      inner.name = `desk-leg-inner:${desk.id}:${side}`;
      inner.userData.deskLegRole = 'inner';
      legs.push(outer, inner);
      addBox(frame, pool, m.dark, [.13, .035, .72], [side * .69, .0175, 0]).name = `desk-foot:${desk.id}:${side}`;
    }
    root.add(frame);
    top.add(createDeskClutter(pool, desk,options.models?.('computer-set-v1')));
    if (desk.home) {
      const label = makeLabel(pool, '我的工位  ·  18:00', { width: .72, height: .13, foreground: '#e5ddc5', background: '#3b5145', fontSize: 47 });
      label.position.set(0, -.12, -.433);
      label.rotation.y = Math.PI;
      top.add(label);
    }
    root.add(top);
    desks.set(desk.id, top);
    deskLegs.set(desk.id, legs);
  }

  // Plants stay inside perimeter corners and are reported rather than silently becoming collision.
  for (const room of world.rooms.filter(item => item.kind === 'front' || item.kind === 'boss' || item.kind === 'meeting')) {
    const x = room.x - room.w / 2 + .38;
    const z = room.z - room.d / 2 + .38;
    addPlant(root, pool, m, x, z,`plant:${room.id}`,options.models?.('plant-v1'));
    decorationColliders.push({ id: `plant:${room.id}`, roomId: room.id, x, z, w: .34, d: .34, height: 1.15, yaw: 0, note: '墙角植物装饰；未写入玩法碰撞。' });
  }

  const effects = createOfficeEffects(world, { walls, desks, deskLegs, roomLights, roomMaterials, switchIndicators }, pool);
  root.add(effects.root);

  return {
    root,
    desks,
    walls,
    decorationColliders,
    effects,
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
    update(state) { effects.update(state); },
    getDiagnostics() { return { ...effects.getDiagnostics(), decorationColliders }; },
    dispose() {
      root.removeFromParent();
      pool.dispose();
    },
  };
}
