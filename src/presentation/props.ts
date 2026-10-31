import * as THREE from 'three';
import type { Desk, Exit, GameState, Station, WorldDef } from '../contracts/game';
import { VisualResourcePool, addBox, addCylinder, makeDeterministicRandom, makeLabel } from './visual-utils';

export type CharacterAnchorKind = 'hand' | 'back' | 'crown';
export type CharacterAnchorProvider = (actorId: string, kind: CharacterAnchorKind) => THREE.Object3D | undefined;

export interface PropAssetAdapter {
  instantiate(id: 'chair-v1' | 'pot-v1'): THREE.Object3D;
  release?(id: 'chair-v1' | 'pot-v1', instance: THREE.Object3D): void;
}

export interface OfficePropVisuals {
  readonly root: THREE.Group;
  readonly props: ReadonlyMap<string, THREE.Object3D>;
  readonly pots: ReadonlyMap<string, THREE.Object3D>;
  readonly exits: ReadonlyMap<string, THREE.Group>;
  prepare(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene?: THREE.Scene): Promise<void>;
  update(state: GameState, anchors: CharacterAnchorProvider, playerOccluded?: boolean): void;
  dispose(): void;
}

interface PropMaterials {
  graphite: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  cardboard: THREE.MeshStandardMaterial;
  tape: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  cork: THREE.MeshStandardMaterial;
}

function materials(pool: VisualResourcePool): PropMaterials {
  return {
    graphite: pool.material({ color: 0x242b2b, roughness: .67, metalness: .16 }),
    metal: pool.material({ color: 0x7c8580, roughness: .42, metalness: .7 }),
    plastic: pool.material({ color: 0xb9bdb5, roughness: .78 }),
    paper: pool.material({ color: 0xe9e4d4, roughness: .96 }),
    cardboard: pool.material({ color: 0xa98556, roughness: .96 }),
    tape: pool.material({ color: 0xc8b58c, roughness: .7 }),
    ceramic: pool.material({ color: 0xd9d7c8, roughness: .34 }),
    green: pool.material({ color: 0x426b59, roughness: .82 }),
    red: pool.material({ color: 0x9c5345, roughness: .78 }),
    cork: pool.material({ color: 0xa9875e, roughness: 1 }),
  };
}

function monitorScreen(pool: VisualResourcePool, desk: Desk): THREE.Mesh {
  const home = desk.home;
  const label = makeLabel(pool, home ? '18:00  豆包' : 'Q4 闭环进度', {
    width: .67,
    height: .36,
    foreground: home ? '#d8e9c8' : '#ccd9d1',
    background: '#16221f',
    accent: home ? '#d5a45e' : '#597b6b',
    fontSize: 44,
    lines: home ? ['18:00  豆包', '规矩立住，不烧心。'] : ['Q4 闭环进度', '待对齐  ·  待抓手  ·  待赋能'],
  });
  label.position.set(0, .435, .119);
  label.rotation.y = Math.PI;
  return label;
}

/** Decorative desk content is attached to the moving desktop, never to the floor. */
export function createDeskClutter(pool: VisualResourcePool, desk: Desk, computer?: THREE.Object3D): THREE.Group {
  const m = materials(pool);
  const random = makeDeterministicRandom(`desk:${desk.id}`);
  const group = new THREE.Group();
  group.name = `desk-clutter:${desk.id}`;

  if(computer){computer.rotation.y+=Math.PI;group.add(computer);}else{
  addBox(group, pool, m.graphite, [.09, .23, .08], [0, .15, .13]);
  addBox(group, pool, m.graphite, [.38, .025, .25], [0, .023, .12]);
  addBox(group, pool, m.graphite, [.735, .465, .055], [0, .435, .15]);
  group.add(monitorScreen(pool, desk));
  addBox(group, pool, m.graphite, [.48, .024, .17], [0, .022, -.19]);
  for (let index = 0; index < 7; index++) addBox(group, pool, m.plastic, [.052, .006, .018], [-.19 + index * .063, .038, -.19]);
  addBox(group, pool, m.graphite, [.075, .027, .115], [.37, .025, -.19]);
  }

  const mug = addCylinder(group, pool, random() > .5 ? m.ceramic : m.green, [.055, .048], .135, [-.59, .075, -.16], 20);
  const handle = new THREE.Mesh(pool.geometry('mug-handle', () => new THREE.TorusGeometry(.043, .011, 6, 14, Math.PI * 1.65)), m.ceramic);
  handle.position.set(-.645, .085, -.16);
  handle.rotation.y = Math.PI / 2;
  group.add(handle);
  mug.userData.visualOnly = true;

  addBox(group, pool, random() > .5 ? m.red : m.green, [.24, .025, .31], [.57, .018, .03], -.08);
  addBox(group, pool, m.paper, [.22, .006, .29], [.57, .034, .03], -.08);
  const pencil = addCylinder(group, pool, m.tape, [.008, .008], .25, [.48, .04, -.24], 8);
  pencil.rotation.z = Math.PI / 2;
  pencil.rotation.y = -.3;

  const variant = Math.floor(random() * 4);
  if (variant === 0 || desk.home) {
    for (let index = 0; index < 3; index++) addBox(group, pool, m.paper, [.29, .004, .21], [-.37, .009 + index * .005, .13], -.1 + index * .035);
    if(!computer){
    const memo = makeLabel(pool, '今天也要\n自动自发', { width: .16, height: .15, foreground: '#4c4635', background: '#e4c86e', fontSize: 37 });
    memo.position.set(-.29, .51, .112);
    memo.rotation.y = Math.PI;
    memo.rotation.z = -.06;
    group.add(memo);
    }
  } else if (variant === 1) {
    addCylinder(group, pool, m.red, [.055, .055], .045, [-.42, .035, .17], 18);
    const photo = makeLabel(pool, '团建 2025', { width: .2, height: .15, foreground: '#e8e0ca', background: '#55685f', fontSize: 39 });
    photo.position.set(.47, .16, .21);
    photo.rotation.x = -.12;
    photo.rotation.y = Math.PI;
    group.add(photo);
  } else if (variant === 2) {
    addBox(group, pool, m.cardboard, [.26, .12, .2], [-.4, .065, .15]);
    const label = makeLabel(pool, '待办  47', { width: .19, height: .07, foreground: '#544c3d', background: '#e8dfc8', fontSize: 48 });
    label.position.set(-.4, .08, .048);
    label.rotation.y = Math.PI;
    group.add(label);
  } else {
    const cup = addCylinder(group, pool, m.metal, [.045, .04], .13, [-.42, .07, .15], 16);
    for (let index = 0; index < 4; index++) {
      const pen = addCylinder(cup, pool, index % 2 ? m.red : m.graphite, [.006, .006], .19, [(index - 1.5) * .014, .08, 0], 6);
      pen.rotation.z = (index - 1.5) * .08;
    }
  }
  return group;
}

export function createStationVisual(pool: VisualResourcePool, station: Station, model?: THREE.Object3D): THREE.Group {
  const m = materials(pool);
  const group = new THREE.Group();
  group.name = `clock-station:${station.id}`;
  group.position.set(station.x, 0, station.z);
  group.rotation.y = station.yaw;
  // Station coordinates are the walkable operating point; keep the body behind it.
  if(model){model.rotation.y+=Math.PI;model.position.z+=.55;group.add(model);}else{
  addBox(group, pool, m.graphite, [.46, 1.18, .32], [0, .59, 0]);
  addBox(group, pool, m.metal, [.5, .045, .36], [0, 1.205, 0]);
  const title = makeLabel(pool, '下班打卡', { width: .38, height: .14, foreground: '#dce9d6', background: '#2d4d40', fontSize: 52 });
  title.position.set(0, .99, -.165);
  title.rotation.y = Math.PI;
  group.add(title);
  const time = makeLabel(pool, '18:00', { width: .33, height: .18, foreground: '#b9f4c5', background: '#101c18', fontSize: 74, emissive: true });
  time.position.set(0, .76, -.166);
  time.rotation.y = Math.PI;
  group.add(time);
  addBox(group, pool, m.green, [.16, .08, .035], [0, .48, -.18]);
  }
  const note = makeLabel(pool, '先打卡  再离场', { width: 1.55, height: .26, foreground: '#e0d9b9', background: '#48584b', fontSize: 48 });
  note.position.set(0, .018, -1.05);
  note.rotation.x = -Math.PI / 2;
  group.add(note);
  return group;
}

export function createExitVisual(pool: VisualResourcePool, exit: Exit): THREE.Group {
  const m = materials(pool);
  const group = new THREE.Group();
  group.name = `exit-door:${exit.id}`;
  group.position.set(exit.x + exit.outward.x * .65, 0, exit.z + exit.outward.z * .65);
  group.rotation.y = Math.atan2(-exit.outward.x, -exit.outward.z);
  addBox(group, pool, m.graphite, [2.18, 2.28, .12], [0, 1.14, 0]);
  addBox(group, pool, m.metal, [1.65, .035, .065], [0, 1.02, .095]);
  addBox(group, pool, m.green, [1.82, .38, .07], [0, 1.94, .085]);
  const sign = makeLabel(pool, '安全出口  →', { width: 1.68, height: .29, foreground: '#eff3dc', background: '#3f6c52', fontSize: 66, emissive: true });
  sign.position.set(0, 1.94, .125);
  group.add(sign);
  const instruction = makeLabel(pool, '打卡后按住 E 开门', { width: 1.5, height: .2, foreground: '#ded8bd', background: '#293c34', fontSize: 47 });
  instruction.position.set(0, 1.52, .068);
  group.add(instruction);
  return group;
}

function fallbackChair(pool: VisualResourcePool): THREE.Group {
  const m = materials(pool);
  const group = new THREE.Group();
  addBox(group, pool, m.graphite, [.56, .12, .52], [0, .5, 0]);
  const back = addBox(group, pool, m.graphite, [.54, .59, .085], [0, .83, -.25]);
  back.rotation.x = -.08;
  addCylinder(group, pool, m.metal, [.035, .035], .38, [0, .27, 0], 12);
  for (let index = 0; index < 5; index++) {
    const angle = index / 5 * Math.PI * 2;
    const leg = addBox(group, pool, m.metal, [.035, .035, .34], [Math.sin(angle) * .15, .1, Math.cos(angle) * .15], angle);
    addCylinder(leg, pool, m.graphite, [.045, .045], .04, [0, -.03, .18], 10).rotation.z = Math.PI / 2;
  }
  return group;
}

function cakeVisual(pool: VisualResourcePool): THREE.Group {
  const m = materials(pool);
  const group = new THREE.Group();
  addCylinder(group, pool, pool.material({ color: 0xc99b5b, roughness: .92 }), [.29, .3], .33, [0, .175, 0], 32);
  addCylinder(group, pool, pool.material({ color: 0xead3a0, roughness: .88 }), [.292, .292], .035, [0, .355, 0], 32);
  const label = makeLabel(pool, '愿 景', { width: .36, height: .19, foreground: '#8b513c', background: 'transparent', transparent: true, fontSize: 68 });
  label.position.y = .376;
  label.rotation.x = -Math.PI / 2;
  group.add(label);
  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * Math.PI * 2;
    addCylinder(group, pool, m.paper, [.018, .018], .025, [Math.sin(angle) * .22, .385, Math.cos(angle) * .22], 8);
  }
  return group;
}

function boxVisual(pool: VisualResourcePool): THREE.Group {
  const m = materials(pool);
  const group = new THREE.Group();
  addBox(group, pool, m.cardboard, [.55, .55, .55], [0, .275, 0]);
  addBox(group, pool, m.tape, [.12, .008, .555], [0, .554, 0]);
  addBox(group, pool, m.tape, [.12, .55, .008], [0, .275, .279]);
  const label = makeLabel(pool, '重要物资\n勿动', { width: .28, height: .19, foreground: '#4e4639', background: '#ded5bd', fontSize: 49 });
  label.position.set(.12, .3, .281);
  group.add(label);
  return group;
}

function fallbackPot(pool: VisualResourcePool): THREE.Group {
  const group = new THREE.Group();
  const metal = pool.material({ color: 0x222a29, roughness: .36, metalness: .72 });
  addCylinder(group, pool, metal, [.225, .18], .13, [0, .065, 0], 28);
  addBox(group, pool, metal, [.075, .04, .24], [0, .06, .32]);
  return group;
}

export function createOfficePropVisuals(world: WorldDef, options: { assets?: PropAssetAdapter; models?: (id:'box-v1'|'clock-station-v1')=>THREE.Object3D|undefined } = {}): OfficePropVisuals {
  const pool = new VisualResourcePool();
  const root = new THREE.Group();
  root.name = 'office-props';
  const chairs = new Map<string, THREE.Object3D>();
  const props = new Map<string, THREE.Object3D>();
  const pots = new Map<string, THREE.Object3D>();
  const exits = new Map<string, THREE.Group>();
  const assetInstances: { id: 'chair-v1' | 'pot-v1'; object: THREE.Object3D }[] = [];
  const asset = (id: 'chair-v1' | 'pot-v1', fallback: () => THREE.Group) => {
    if (!options.assets) return fallback();
    const object = options.assets.instantiate(id);
    assetInstances.push({ id, object });
    return object;
  };

  for (const desk of world.desks) {
    const chair = asset('chair-v1', () => fallbackChair(pool));
    chair.position.set(desk.seat.x, 0, desk.seat.z);
    chair.rotation.y = desk.yaw;
    chair.name = `desk-chair:${desk.id}`;
    root.add(chair);
    chairs.set(desk.id, chair);
  }
  for (const prop of world.props) {
    const object = prop.kind === 'cake' ? cakeVisual(pool) : options.models?.('box-v1')??boxVisual(pool);
    object.name = `world-prop:${prop.id}`;
    object.position.set(prop.x, 0, prop.z);
    root.add(object);
    props.set(prop.id, object);
  }
  for (const station of world.stations) root.add(createStationVisual(pool, station,options.models?.('clock-station-v1')));
  for (const exit of world.exits) {
    const visual = createExitVisual(pool, exit);
    root.add(visual);
    exits.set(exit.id, visual);
  }
  for (const id of ['pot-0', 'pot-1']) {
    const pot = asset('pot-v1', () => fallbackPot(pool));
    pot.name = `world-pot:${id}`;
    pot.visible = false;
    root.add(pot);
    pots.set(id, pot);
  }

  return {
    root,
    props,
    pots,
    exits,
    async prepare(renderer, camera, scene) {
      const textures = new Set<THREE.Texture>();
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      for (const texture of textures) renderer.initTexture(texture);
      await renderer.compileAsync(root, camera, scene);
    },
    update(state, anchors, playerOccluded = false) {
      const occupied = new Set(state.colleagues.map(colleague => colleague.deskId));
      if (state.player.sticky) for (const desk of world.desks) if (desk.home) occupied.add(desk.id);
      if (state.player.pose === 'working') {
        for (const desk of world.desks) if (Math.hypot(state.player.x - desk.seat.x, state.player.z - desk.seat.z) < .4) occupied.add(desk.id);
      }
      for (const [deskId, chair] of chairs) chair.visible = !occupied.has(deskId);
      for (const exit of world.exits) exits.get(exit.id)!.visible = !state.openedExits.includes(exit.id);

      for (const prop of state.props) {
        const visual = props.get(prop.id);
        if (!visual) continue;
        visual.scale.setScalar(prop.scale);
        if (prop.held) {
          const hand = anchors('player', 'hand');
          if (hand) {
            hand.updateWorldMatrix(true, false);
            hand.getWorldPosition(visual.position);
            visual.position.y += .12;
          }
        } else visual.position.set(prop.x, prop.y ?? 0, prop.z);
        visual.visible = !prop.held || !playerOccluded;
      }

      for (const pot of state.pots) {
        let visual = pots.get(pot.id);
        if (!visual) {
          visual = asset('pot-v1', () => fallbackPot(pool));
          visual.name = `world-pot:${pot.id}`;
          root.add(visual);
          pots.set(pot.id, visual);
        }
        const owner = pot.owner;
        const seated = owner === 'player' ? state.player.pose === 'working' || state.player.sticky : true;
        const held = pot.phase === 'held' || pot.phase === 'drawing';
        const anchor = anchors(owner, held ? 'hand' : seated ? 'crown' : 'back');
        if (!anchor) {
          visual.visible = false;
          continue;
        }
        anchor.updateWorldMatrix(true, false);
        anchor.getWorldPosition(visual.position);
        visual.rotation.set(seated || held ? 0 : Math.PI / 2, 0, 0);
        if (pot.phase === 'flying' || pot.phase === 'returning') {
          const t = THREE.MathUtils.clamp(pot.progress, 0, 1);
          visual.position.set(THREE.MathUtils.lerp(pot.from.x, pot.to.x, t), 1.15 + Math.sin(t * Math.PI) * .65, THREE.MathUtils.lerp(pot.from.z, pot.to.z, t));
          visual.rotation.y = state.elapsed * 10;
        }
        const attachedToHiddenPlayer = owner === 'player' && pot.phase !== 'flying' && pot.phase !== 'returning' && playerOccluded;
        visual.visible = !attachedToHiddenPlayer;
      }
    },
    dispose() {
      for (const instance of assetInstances) options.assets?.release?.(instance.id, instance.object);
      assetInstances.length = 0;
      root.removeFromParent();
      pool.dispose();
    },
  };
}
