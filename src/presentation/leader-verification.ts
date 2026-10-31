import * as THREE from 'three';
import { OfficeScene } from './scene';
import { createCharacterLibrary } from './characters';
import { RuntimeAssets } from '../gameplay/assets';
import { runtimeAssetSpecs } from '../gameplay/runtime-catalog';
import { generateWorld } from '../world/generate';
import { createGame, stepGame } from '../rules/game';
import { makeWorldQuery } from '../world/query';
import { beginInspection } from '../rules/inspection';
import { leaveWorkstation, runtimeFor } from '../rules/runtime';
import type { ActiveRule, GameState, InputFrame, WorldDef } from '../contracts/game';

declare const __BUILD_COMMIT__: string;
type Stage = 'patrol' | 'approach' | 'inspect-blend' | 'inspect' | 'search-fast' | 'search-left' | 'search-right';
type View = 'context' | 'front' | 'side' | 'perspective';

const scene = new OfficeScene(document.querySelector<HTMLElement>('#scene')!, { quality: 'medium', sensitivity: 1, invertY: false, reducedMotion: false, textScale: 1 });
const assets = new RuntimeAssets();
const library = createCharacterLibrary({ assets });
const status = document.querySelector<HTMLElement>('#status')!;
const metrics = document.querySelector<HTMLElement>('#metrics')!;
const idle: InputFrame = { moveX: 0, moveZ: 0, yaw: 0, sprint: false, crouchPressed: false, jumpPressed: false, interact: false, interactPressed: false, potPressed: false, dropPressed: false, throwPressed: false, aim: false };
let world: WorldDef, state: GameState, query: ReturnType<typeof makeWorldQuery>;
let stage: Stage = 'patrol', view: View = 'perspective', ready = false, disposed = false;
let lastSpeed = 0;
const searchHistory: unknown[] = [];
interface ContactProbe { mesh: THREE.SkinnedMesh; index: number; kind: 'toe' | 'heel' }
let probeDefs: Record<'Left' | 'Right', ContactProbe[]> | null = null;
let previousContacts: Record<string, { position: THREE.Vector3Tuple; y: number }> | null = null;

function leaderRoot() {
  let result: THREE.Object3D | undefined;
  scene.scene.traverse(object => { if (object.userData.actorId === 'boss') result = object; });
  if (!result) throw new Error('Production leader root not found');
  return result;
}
function buildProbeDefs(root: THREE.Object3D, side: 'Left' | 'Right'): ContactProbe[] {
  const part = root.getObjectByName(`mixamorig${side}Foot`);
  if (!part) throw new Error(`Leader foot not found: ${side}`);
  const bones: THREE.Bone[] = [];
  part.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
  const candidates: { mesh: THREE.SkinnedMesh; index: number; local: THREE.Vector3 }[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const indices = object.geometry.getAttribute('skinIndex'), weights = object.geometry.getAttribute('skinWeight');
    const vertex = new THREE.Vector3();
    for (let index = 0; index < indices.count; index++) {
      let weight = 0;
      for (let influence = 0; influence < 4; influence++) if (bones.includes(object.skeleton.bones[indices.getComponent(index, influence)])) weight += weights.getComponent(index, influence);
      if (weight < .5) continue;
      object.getVertexPosition(index, vertex); vertex.applyMatrix4(object.matrixWorld);
      candidates.push({ mesh: object, index, local: root.worldToLocal(vertex.clone()) });
    }
  });
  const minimum = Math.min(...candidates.map(candidate => candidate.local.y));
  const sole = candidates.filter(candidate => candidate.local.y <= minimum + .025);
  const toe = sole.reduce((best, candidate) => candidate.local.z > best.local.z ? candidate : best);
  const heel = sole.reduce((best, candidate) => candidate.local.z < best.local.z ? candidate : best);
  return [{ mesh: toe.mesh, index: toe.index, kind: 'toe' }, { mesh: heel.mesh, index: heel.index, kind: 'heel' }];
}
function contactPoints(root: THREE.Object3D, side: 'Left' | 'Right') {
  if (!probeDefs) probeDefs = { Left: buildProbeDefs(root, 'Left'), Right: buildProbeDefs(root, 'Right') };
  return probeDefs[side].map(probe => {
    const point = new THREE.Vector3();
    probe.mesh.getVertexPosition(probe.index, point); point.applyMatrix4(probe.mesh.matrixWorld);
    return { kind: probe.kind, position: point.toArray(), y: point.y };
  });
}
function sample() {
  scene.scene.updateMatrixWorld(true);
  const root = leaderRoot(), motion = scene.getCharacterDiagnostics(state).find(actor => actor.id === 'boss')?.motion;
  const contacts = Object.fromEntries((['Left', 'Right'] as const).map(side => [side, contactPoints(root, side)]));
  const supportSpeeds: Record<string, number | null> = {};
  for (const side of ['Left', 'Right'] as const) {
    for (const point of contacts[side]) {
      const key = `${side}${point.kind === 'toe' ? 'Toe' : 'Heel'}`, before = previousContacts?.[key];
      supportSpeeds[key] = before && before.y <= .015 && point.y <= .015
        ? Math.hypot(point.position[0] - before.position[0], point.position[2] - before.position[2]) * 60 : null;
      previousContacts = { ...previousContacts, [key]: point };
    }
  }
  const feet = Object.fromEntries((['Left', 'Right'] as const).map(side => [side, { minY: Math.min(...contacts[side].map(point => point.y)) }]));
  const bodyMinY = Math.min(feet.Left.minY, feet.Right.minY);
  return {
    stage, elapsed: state.elapsed, bossMode: state.boss.mode, inspectionPhase: state.inspection?.phase ?? null,
    bossPosition: [state.boss.x, 0, state.boss.z], bossYaw: state.boss.yaw, lookYaw: state.boss.lookYaw ?? state.boss.yaw,
    actualSpeed: lastSpeed, motion, feet, contacts, supportSpeeds, bodyMinY,
    matrixFinite: root.matrixWorld.elements.every(Number.isFinite),
  };
}
function applyCamera() {
  const target = leaderRoot().getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.05, 0));
  if (view === 'context') {
    const home = world.desks.find(desk => desk.home)!;
    scene.camera.position.set(home.seat.x + 3.6, 2.35, home.seat.z - 4.2);
    scene.camera.lookAt(home.seat.x, 1.1, home.seat.z + .6);
    return;
  }
  const local = view === 'front' ? new THREE.Vector3(0, .28, 3.2) : view === 'side' ? new THREE.Vector3(3.2, .25, 0) : new THREE.Vector3(2.5, .5, 3.2);
  local.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.boss.yaw);
  scene.camera.position.copy(target).add(local); scene.camera.lookAt(target);
}
function show() {
  applyCamera(); scene.renderer.render(scene.scene, scene.camera);
  const data = sample();
  status.textContent = `${stage} · ${data.motion?.activity ?? '无'} · blend ${(data.motion?.transitionProgress ?? 0).toFixed(2)} · yaw ${((data.motion?.appliedLookYaw ?? 0) * 180 / Math.PI).toFixed(1)}°`;
  metrics.textContent = `实际速度 ${data.actualSpeed.toFixed(3)} m/s · 步频 ${(data.motion?.cadence ?? 0).toFixed(3)}× · 最低脚点 ${data.bodyMinY.toFixed(4)} m`;
}
function advance(frames = 1) {
  for (let index = 0; index < frames; index++) {
    const before = { x: state.boss.x, z: state.boss.z };
    stepGame(state, { ...idle, yaw: state.player.yaw }, 1 / 60, world, query);
    lastSpeed = Math.hypot(state.boss.x - before.x, state.boss.z - before.z) * 60;
    scene.render(state, state.player.yaw, -.08, 'playing', 1 / 60);
    const data = sample();
    if (state.boss.mode === 'search') searchHistory.push(data);
  }
}
function until(predicate: () => boolean, limit: number, label: string) {
  for (let index = 0; index < limit; index++) { if (predicate()) return; advance(); }
  if (!predicate()) throw new Error(`Timed out waiting for ${label}`);
}
function patrol() { stage = 'patrol'; advance(30); show(); }
function inspectBlend() {
  if (stage === 'patrol') {
    leaveWorkstation(state);
    const home = world.desks.find(desk => desk.home)!;
    const away = world.rooms.map(room => ({ x: room.x, z: room.z })).filter(point => Math.hypot(point.x - home.seat.x, point.z - home.seat.z) > 8 && query.validPlacement(point, .3, state)).sort((a, b) => Math.hypot(b.x - home.seat.x, b.z - home.seat.z) - Math.hypot(a.x - home.seat.x, a.z - home.seat.z))[0];
    if (!away) throw new Error('No valid away-from-home fixture point');
    Object.assign(state.player, { ...away, y: 0, pose: 'standing' });
    const rule: ActiveRule = { id: runtimeFor(state).nextRuleId++, kind: 'desk', quote: '受控检查', effect: '真实 inspection，非自然调度', targetId: 'home', roomId: home.roomId, phase: 'active', remaining: 20, duration: 20, age: 0 };
    if (!beginInspection(state, rule, world, query)) throw new Error('Real beginInspection was rejected');
    state.rules = [];
    stage = 'approach';
  }
  until(() => state.inspection?.phase === 'checking', 1200, 'leader checking');
  state.inspection!.returnBy = state.elapsed + 1.2;
  stage = 'inspect-blend'; advance(5); show();
}
function inspect() {
  if (stage !== 'inspect-blend') inspectBlend();
  stage = 'inspect'; advance(7); show();
}
function searchFast() {
  if (stage !== 'inspect') inspect();
  until(() => state.inspection?.phase === 'search', 180, 'empty search');
  let consecutive = 0;
  for (let index = 0; index < 1200 && consecutive < 3; index++) {
    advance(); consecutive = lastSpeed >= 6.5 ? consecutive + 1 : 0;
  }
  if (consecutive < 3) throw new Error(`No three-frame fast-search segment; last speed ${lastSpeed}`);
  stage = 'search-fast'; show();
}
function sweep(direction: 1 | -1) {
  if (!['search-fast', 'search-left', 'search-right'].includes(stage)) searchFast();
  const target = direction * .68;
  for (let index = 0; index < 600; index++) {
    const applied = scene.getCharacterDiagnostics(state).find(actor => actor.id === 'boss')?.motion?.appliedLookYaw ?? 0;
    if (direction > 0 ? applied >= target : applied <= target) break;
    advance();
  }
  stage = direction > 0 ? 'search-left' : 'search-right'; show();
}
function searchLeft() { sweep(1); }
function searchRight() { sweep(-1); }
function setView(next: View) { view = next; show(); }

async function prepare() {
  const specs = runtimeAssetSpecs(import.meta.env.BASE_URL, __BUILD_COMMIT__);
  await assets.preload(specs); await library.prepare();
  scene.useRuntimeAssets(assets, specs.map(spec => spec.id)); scene.useCharacterLibrary(library);
  world = generateWorld(618); state = createGame(world); query = makeWorldQuery(world);
  runtimeFor(state).nextEnvironment = Infinity;
  scene.load(world); world.decorationColliders = scene.getDecorationColliders(); query = makeWorldQuery(world);
  scene.render(state, state.player.yaw, -.08, 'ready', 1 / 60); await scene.prepare();
  ready = true; patrol();
  Object.assign(window, { __LEADER_QA__: { get ready() { return ready; }, patrol, inspectBlend, inspect, searchFast, searchLeft, searchRight, setView, state: sample, history: () => searchHistory } });
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', () => {
    try {
      if (button.dataset.stage) ({ patrol, inspectBlend, inspect, searchFast, searchLeft, searchRight } as Record<string, () => void>)[button.dataset.stage]();
      if (button.dataset.view) setView(button.dataset.view as View);
    } catch (error) { status.textContent = String(error); status.classList.add('error'); throw error; }
  }));
}
prepare().catch(error => { status.textContent = `领导验收加载失败：${String(error)}`; status.classList.add('error'); throw error; });
window.addEventListener('pagehide', () => { if (disposed) return; disposed = true; scene.dispose(); library.dispose(); assets.dispose(); }, { once: true });
