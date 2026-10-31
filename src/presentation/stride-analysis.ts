import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createCharacterLibrary, type CharacterVisual } from './characters';
import { createCharacterMotion, type CharacterMotion } from './character-motion';

type ContactProbe = { mesh: THREE.SkinnedMesh; index: number; kind: 'toe' | 'heel'; side: 'Left' | 'Right' };
type ContactPoint = { key: string; position: THREE.Vector3Tuple; y: number };
type Sample = { time: number; clipTime: number; phasePercent: number; speed: number | null; key: string; point: ContactPoint };

const host = document.querySelector<HTMLElement>('#scene')!;
const status = document.querySelector<HTMLElement>('#status')!;
const metrics = document.querySelector<HTMLElement>('#metrics')!;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#202720');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(host.clientWidth, host.clientHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
host.append(renderer.domElement);
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(), environment = pmrem.fromScene(room, .04);
scene.environment = environment.texture; room.dispose();
scene.add(new THREE.HemisphereLight('#e8ecd8', '#454237', 1.6));
const key = new THREE.DirectionalLight('#ffedcd', 3); key.position.set(3, 5, 4); key.castShadow = true; scene.add(key);
const fill = new THREE.DirectionalLight('#c4d5cf', 1.2); fill.position.set(-3, 3, -2); scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ color: '#3e493b', roughness: .96 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(16, 32, '#82917b', '#4b5847'); grid.position.y = .002; scene.add(grid);
const camera = new THREE.PerspectiveCamera(36, host.clientWidth / host.clientHeight, .01, 80);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
const library = createCharacterLibrary();
let actor: CharacterVisual, motion: CharacterMotion, probes: ContactProbe[], runDuration = 1.2666666507720947;
let activeScale = 1, previous: Record<string, ContactPoint> = {};
let ready = false, disposed = false;
const actualSpeed = 7.2, frameRate = 60;

function buildProbes(root: THREE.Object3D): ContactProbe[] {
  const result: ContactProbe[] = [];
  for (const side of ['Left', 'Right'] as const) {
    const part = root.getObjectByName(`mixamorig${side}Foot`);
    if (!part) throw new Error(`Missing ${side} foot`);
    const bones: THREE.Bone[] = []; part.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
    const candidates: { mesh: THREE.SkinnedMesh; index: number; local: THREE.Vector3 }[] = [];
    root.traverse(object => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const indices = object.geometry.getAttribute('skinIndex'), weights = object.geometry.getAttribute('skinWeight');
      const point = new THREE.Vector3();
      for (let index = 0; index < indices.count; index++) {
        let weight = 0;
        for (let influence = 0; influence < 4; influence++) if (bones.includes(object.skeleton.bones[indices.getComponent(index, influence)])) weight += weights.getComponent(index, influence);
        if (weight < .5) continue;
        object.getVertexPosition(index, point); point.applyMatrix4(object.matrixWorld);
        candidates.push({ mesh: object, index, local: root.worldToLocal(point.clone()) });
      }
    });
    const minimum = Math.min(...candidates.map(candidate => candidate.local.y));
    const sole = candidates.filter(candidate => candidate.local.y <= minimum + .025);
    const toe = sole.reduce((best, candidate) => candidate.local.z > best.local.z ? candidate : best);
    const heel = sole.reduce((best, candidate) => candidate.local.z < best.local.z ? candidate : best);
    result.push({ mesh: toe.mesh, index: toe.index, kind: 'toe', side }, { mesh: heel.mesh, index: heel.index, kind: 'heel', side });
  }
  return result;
}
function contacts(): ContactPoint[] {
  actor.root.updateMatrixWorld(true);
  return probes.map(probe => {
    const point = new THREE.Vector3(); probe.mesh.getVertexPosition(probe.index, point); point.applyMatrix4(probe.mesh.matrixWorld);
    return { key: `${probe.side}${probe.kind === 'toe' ? 'Toe' : 'Heel'}`, position: point.toArray(), y: point.y };
  });
}
function clipTime(time: number, scale: number) {
  const phase = .35 + time * 1.5 * scale * 1.1;
  return ((phase % runDuration) + runDuration) % runDuration;
}
function advance(time: number, scale: number, record: Sample[]) {
  actor.root.position.set(0, 0, time * actualSpeed);
  motion.update({ pose: 'standing', leaderMode: 'search', moving: true, sprint: true, speed: actualSpeed * scale, lookYawOffset: 0, holding: false, pot: 'none', time });
  actor.root.updateMatrixWorld(true);
  const current = contacts();
  for (const point of current) {
    const before = previous[point.key];
    const speed = before && before.y <= .015 && point.y <= .015
      ? Math.hypot(point.position[0] - before.position[0], point.position[2] - before.position[2]) * frameRate : null;
    if (time >= .5) {
      const phase = clipTime(time, scale);
      record.push({ time, clipTime: phase, phasePercent: phase / runDuration * 100, speed, key: point.key, point });
    }
    previous[point.key] = point;
  }
}
function resetMotion() {
  motion.reset(); actor.root.position.set(0, 0, 0); previous = {};
  advance(0, activeScale, []);
}
function distribution(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b), at = (p: number) => ordered.length ? ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))] : null;
  return { count: ordered.length, median: at(.5), p90: at(.9), p95: at(.95), max: at(1) };
}
function run(scale: number) {
  activeScale = scale; resetMotion();
  const samples: Sample[] = [];
  for (let frame = 1; frame <= 240; frame++) advance(frame / frameRate, scale, samples);
  const speeds = samples.filter(sample => sample.speed !== null).map(sample => sample.speed!);
  const peaks = samples.filter(sample => sample.speed !== null).sort((a, b) => b.speed! - a.speed!).slice(0, 8);
  return { scale, cadence: 1.5 * scale, actualSpeed, runDuration, samples: samples.length, distribution: distribution(speeds), peaks, allSamples: samples };
}
function seek(scale: number, time: number) {
  activeScale = scale; resetMotion();
  for (let frame = 1; frame <= Math.round(time * frameRate); frame++) advance(frame / frameRate, scale, []);
  const target = actor.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.05, 0));
  floor.position.z = grid.position.z = actor.root.position.z;
  camera.position.copy(target).add(new THREE.Vector3(2.8, .35, 3.4)); controls.target.copy(target); controls.update();
  metrics.textContent = `播放倍率 ${scale.toFixed(2)} · 片段相位 ${(clipTime(time, scale) / runDuration * 100).toFixed(1)}% · 根速度 ${actualSpeed.toFixed(1)} m/s`;
  renderer.render(scene, camera);
  return { scale, time, clipTime: clipTime(time, scale), cadence: 1.5 * scale };
}
async function prepare() {
  await library.prepare(renderer, camera, scene);
  actor = library.createLeader(); motion = createCharacterMotion(actor); scene.add(actor.root);
  actor.poseRoot.traverse(object => { for (const clip of object.animations ?? []) if (clip.name === 'run') runDuration = clip.duration; });
  probes = buildProbes(actor.root); resetMotion();
  ready = true; status.textContent = '正式跑步片段已就绪；独立对照不修改生产参数。';
  Object.assign(window, { __STRIDE_QA__: { get ready() { return ready; }, run, seek } });
}
prepare().catch(error => { status.textContent = `步态分析加载失败：${String(error)}`; throw error; });
window.addEventListener('resize', () => {
  camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(host.clientWidth, host.clientHeight);
});
window.addEventListener('pagehide', () => {
  if (disposed) return; disposed = true; controls.dispose(); library.dispose(); environment.dispose(); pmrem.dispose();
  floor.geometry.dispose(); (floor.material as THREE.Material).dispose(); grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); renderer.dispose();
}, { once: true });
