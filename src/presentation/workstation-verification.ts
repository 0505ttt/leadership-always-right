import * as THREE from 'three';
import { OfficeScene } from './scene';
import { createCharacterLibrary } from './characters';
import { RuntimeAssets } from '../gameplay/assets';
import { runtimeAssetSpecs } from '../gameplay/runtime-catalog';
import { generateWorld } from '../world/generate';
import { createGame, stepGame } from '../rules/game';
import { makeWorldQuery } from '../world/query';
import { deskWorkingPoint } from '../world/workstations';
import { runtimeFor } from '../rules/runtime';
import type { Desk, GameState, InputFrame, WorldDef } from '../contracts/game';

declare const __BUILD_COMMIT__: string;
type Stage = 'ready' | 'mount' | 'work' | 'dismount' | 'reseat';
type View = 'production' | 'front' | 'side' | 'perspective';

const host = document.querySelector<HTMLElement>('#scene')!;
const status = document.querySelector<HTMLElement>('#status')!;
const metrics = document.querySelector<HTMLElement>('#metrics')!;
const settings = { quality: 'medium', sensitivity: 1, invertY: false, reducedMotion: false, textScale: 1 } as const;
const scene = new OfficeScene(host, settings);
const assets = new RuntimeAssets();
const library = createCharacterLibrary({ assets });
const idle: InputFrame = { moveX: 0, moveZ: 0, yaw: 0, sprint: false, crouchPressed: false, jumpPressed: false, interact: false, interactPressed: false, potPressed: false, dropPressed: false, throwPressed: false, aim: false };
let world: WorldDef, state: GameState, query: ReturnType<typeof makeWorldQuery>, home: Desk;
let stage: Stage = 'ready', view: View = 'production', ready = false, disposed = false;

function deformedBounds(root: THREE.Object3D, partRoot: THREE.Object3D, accept?: (world: THREE.Vector3) => boolean) {
  const box = new THREE.Box3().makeEmpty() as THREE.Box3 & { samples: number };
  box.samples = 0;
  const bones: THREE.Bone[] = [];
  partRoot.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
  const vertex = new THREE.Vector3();
  root.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const indices = object.geometry.getAttribute('skinIndex');
    const weights = object.geometry.getAttribute('skinWeight');
    for (let index = 0; index < indices.count; index++) {
      let weight = 0;
      for (let influence = 0; influence < 4; influence++) {
        if (bones.includes(object.skeleton.bones[indices.getComponent(index, influence)])) weight += weights.getComponent(index, influence);
      }
      if (weight < .5) continue;
      object.getVertexPosition(index, vertex);
      vertex.applyMatrix4(object.matrixWorld);
      if (accept && !accept(vertex)) continue;
      box.expandByPoint(vertex); box.samples++;
    }
  });
  return box;
}

function actorRoot() {
  let result: THREE.Object3D | undefined;
  scene.scene.traverse(object => { if (object.userData.actorId === 'player') result = object; });
  if (!result) throw new Error('Production player root not found');
  return result;
}

function measure() {
  scene.scene.updateMatrixWorld(true);
  const actor = actorRoot(), point = deskWorkingPoint(home);
  const desktop = scene.scene.getObjectByName(`desktop:${home.id}`);
  if (!desktop) throw new Error(`Real desktop not found: ${home.id}`);
  const desktopBounds = new THREE.Box3().setFromObject(desktop), desktopY = desktopBounds.max.y;
  const frontZ = (home.x - state.player.x) * Math.sin(state.player.yaw) + (home.z - state.player.z) * Math.cos(state.player.yaw) - .425;
  const internalChair = actor.getObjectByName('character-chair:employee');
  const staticChair = scene.scene.getObjectByName(`desk-chair:${home.id}`);
  if (!internalChair || !staticChair) throw new Error('Production internal/static chair pair not found');
  const seatOrigin = internalChair.localToWorld(new THREE.Vector3(0, 1.25, .16));
  const seatDirection = new THREE.Vector3(0, -1, 0).transformDirection(internalChair.matrixWorld);
  const ray = new THREE.Raycaster(seatOrigin, seatDirection);
  const seatHit = ray.intersectObject(internalChair, true)[0];
  if (!seatHit) throw new Error('Real internal chair seat could not be measured');
  const hands = Object.fromEntries((['Left', 'Right'] as const).map(side => {
    const bone = actor.getObjectByName(`mixamorig${side}Hand`);
    if (!bone) throw new Error(`Real hand bone not found: ${side}`);
    const bounds = deformedBounds(actor, bone, worldPoint => {
      const local = actor.worldToLocal(worldPoint.clone());
      return local.z >= frontZ && local.z <= frontZ + .85 && Math.abs(local.x) <= .8;
    });
    return [side, { minY: bounds.min.y, maxY: bounds.max.y, desktopY, clearance: bounds.samples ? bounds.min.y - desktopY : null, samples: bounds.samples, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } }];
  }));
  const soles = Object.fromEntries((['Left', 'Right'] as const).map(side => {
    const bone = actor.getObjectByName(`mixamorig${side}Foot`);
    if (!bone) throw new Error(`Real foot bone not found: ${side}`);
    const bounds = deformedBounds(actor, bone);
    return [side, { minY: bounds.min.y, seatY: seatHit.point.y, error: bounds.min.y - seatHit.point.y }];
  }));
  const motion = scene.getCharacterDiagnostics(state).find(actor => actor.id === 'player')?.motion;
  return {
    stage, seed: world.seed, deskId: home.id, player: structuredClone(state.player), motion,
    rootPosition: actor.position.toArray(), rootHorizontalError: Math.hypot(actor.position.x - point.x, actor.position.z - point.z),
    rootStateHeightError: actor.position.y - state.player.y,
    desktopY, frontZ, hands, soles,
    chairs: {
      internalVisible: internalChair.visible, staticVisible: staticChair.visible,
      visibleCount: Number(internalChair.visible) + Number(staticChair.visible),
      internalWorldPosition: internalChair.getWorldPosition(new THREE.Vector3()).toArray(),
      staticWorldPosition: staticChair.getWorldPosition(new THREE.Vector3()).toArray(),
    },
  };
}

function applyCamera() {
  if (view === 'production') return;
  const targetOffset = view === 'front' ? new THREE.Vector3(0, 1.92, .42) : new THREE.Vector3(0, 1.25, 0);
  targetOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.player.yaw);
  const target = actorRoot().getWorldPosition(new THREE.Vector3()).add(targetOffset);
  const local = view === 'front' ? new THREE.Vector3(1.1, .18, .15) : view === 'side' ? new THREE.Vector3(3.8, .18, 0) : new THREE.Vector3(3, .55, -2.4);
  local.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.player.yaw);
  scene.camera.position.copy(target).add(local); scene.camera.lookAt(target);
}
function show() {
  scene.render(state, state.player.yaw, -.08, 'playing', 1 / 60);
  applyCamera(); scene.renderer.render(scene.scene, scene.camera);
  const data = measure();
  status.textContent = `${stage} · ${data.motion?.activity ?? '无'} · support=${(data.motion?.support ?? 0).toFixed(3)} · 椅子=${data.chairs.visibleCount}`;
  const hands = Object.values(data.hands).map(hand => hand.clearance === null ? '—' : `${(hand.clearance * 1000).toFixed(1)} mm`).join(' / ');
  metrics.textContent = `桌高 ${data.desktopY.toFixed(3)} m · 真实掌面 ${hands} · 内部椅 ${data.chairs.internalVisible} · 固定椅 ${data.chairs.staticVisible}`;
}
function advance(frames: number, input: Partial<InputFrame> = {}) {
  for (let index = 0; index < frames; index++) {
    stepGame(state, { ...idle, yaw: home.yaw, ...input }, 1 / 60, world, query);
    scene.render(state, state.player.yaw, -.08, 'playing', 1 / 60);
  }
}

function mount() {
  if (stage !== 'ready') return show();
  state.deskHeights[home.id] = 1.9;
  stage = 'mount'; advance(24); show();
}
function work() {
  if (stage === 'ready') mount();
  if (stage !== 'mount') return show();
  stage = 'work'; advance(36); show();
}
function dismount() {
  if (stage === 'ready' || stage === 'mount') work();
  if (stage !== 'work') return show();
  advance(1, { interact: true, interactPressed: true });
  advance(20, { moveZ: -1 }); advance(20);
  stage = 'dismount'; show();
}
function reseat() {
  if (stage === 'ready' || stage === 'mount' || stage === 'work') dismount();
  if (stage !== 'dismount') return show();
  const target = home.seat;
  for (let index = 0; index < 240 && Math.hypot(state.player.x - target.x, state.player.z - target.z) > .30; index++) {
    const direction = (target.x - state.player.x) * Math.sin(home.yaw) + (target.z - state.player.z) * Math.cos(home.yaw);
    const distance = Math.hypot(target.x - state.player.x, target.z - state.player.z);
    // The return walk is real rule input; only its final docking and mounting need rendered frames.
    stepGame(state, { ...idle, yaw: home.yaw, moveZ: Math.sign(direction) * Math.min(1, distance / .48) }, 1 / 60, world, query);
  }
  if (Math.hypot(state.player.x - target.x, state.player.z - target.z) > .65) throw new Error('Real movement did not return to the docking approach');
  advance(1, { interact: true, interactPressed: true });
  if (state.player.pose !== 'working' || state.player.workStance !== 'chair-standing') throw new Error('Real E input did not re-seat at the raised desk');
  stage = 'reseat'; advance(60); show();
}
function setView(next: View) { view = next; show(); }

async function prepare() {
  const specs = runtimeAssetSpecs(import.meta.env.BASE_URL, __BUILD_COMMIT__);
  await assets.preload(specs);
  await library.prepare();
  scene.useRuntimeAssets(assets, specs.map(spec => spec.id)); scene.useCharacterLibrary(library);
  world = generateWorld(618); state = createGame(world); query = makeWorldQuery(world);
  home = world.desks.find(desk => desk.home)!;
  runtimeFor(state).nextEnvironment = Infinity;
  scene.load(world); world.decorationColliders = scene.getDecorationColliders(); query = makeWorldQuery(world);
  scene.render(state, state.player.yaw, -.08, 'ready', 1 / 60); await scene.prepare();
  ready = true; show();
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', () => {
    try {
      if (button.dataset.stage) ({ mount, work, dismount, reseat } as Record<string, () => void>)[button.dataset.stage]();
      if (button.dataset.view) setView(button.dataset.view as View);
    } catch (error) { status.textContent = String(error); status.classList.add('error'); throw error; }
  }));
  Object.assign(window, { __WORKSTATION_QA__: { get ready() { return ready; }, mount, work, dismount, reseat, setView, state: measure } });
}
prepare().catch(error => { status.textContent = `联合验收加载失败：${String(error)}`; status.classList.add('error'); throw error; });
window.addEventListener('pagehide', () => {
  if (disposed) return; disposed = true;
  scene.dispose(); library.dispose(); assets.dispose();
}, { once: true });
