import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RuntimeAssets } from '../src/gameplay/assets';
import { createOfficePropVisuals, type OfficePropModelId } from '../src/presentation/props';
import { createGame } from '../src/rules/game';
import { generateWorld } from '../src/world/generate';

const assetIds = ['cake-v2', 'exit-door-v1'] as const;
const cleanups: (() => void)[] = [];

/** Parse shipped geometry and transforms without browser-only image decoding. */
function cpuGlb(id: typeof assetIds[number]): ArrayBuffer {
  const bytes = readFileSync(`public/assets/office-props/${id}.glb`);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  let document: Record<string, unknown> | undefined;
  let binary: Buffer | undefined;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset), kind = bytes.readUInt32LE(offset + 4);
    if (kind === 0x4e4f534a) document = JSON.parse(bytes.toString('utf8', offset + 8, offset + 8 + length));
    if (kind === 0x004e4942) binary = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length;
  }
  if (!document || !binary) throw new Error('Expected GLB JSON and embedded binary');
  const materials = document.materials as { name?: string; doubleSided?: boolean }[];
  document.materials = materials.map(material => ({ name: material.name, doubleSided: material.doubleSided }));
  delete document.images; delete document.textures; delete document.samplers;
  const json = Buffer.from(JSON.stringify(document)), paddedLength = Math.ceil(json.length / 4) * 4;
  const result = Buffer.alloc(12 + 8 + paddedLength + 8 + binary.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(paddedLength, 12); result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(0x20, 20, 20 + paddedLength); json.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + paddedLength); result.writeUInt32LE(0x004e4942, 24 + paddedLength);
  binary.copy(result, 28 + paddedLength);
  return Uint8Array.from(result).buffer;
}

function propWorld() {
  const world = generateWorld(618);
  return { ...world, desks: [], stations: [], colleagues: [], props: world.props.filter(prop => prop.kind === 'cake').slice(0, 1) };
}

async function fixture() {
  const sources = new Map<string, GLTF>();
  const assets = new RuntimeAssets(async id => {
    const model = await new GLTFLoader().parseAsync(cpuGlb(id as typeof assetIds[number]), '');
    sources.set(id, model);
    return model;
  });
  cleanups.push(() => assets.dispose());
  await assets.preload(assetIds.map(id => ({ id, url: id })));
  const instances: THREE.Object3D[] = [];
  // OfficeScene owns models supplied through this callback and retires them itself.
  cleanups.push(() => { for (const instance of instances) assets.releaseInstance(instance); });
  const models = (id: OfficePropModelId) => {
    if (!assetIds.includes(id as typeof assetIds[number])) return undefined;
    const instance = assets.instantiate(id);
    instances.push(instance);
    return instance;
  };
  return { assets, sources, instances, models };
}

function bounds(object: THREE.Object3D) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object, true);
  return { box, size: box.getSize(new THREE.Vector3()) };
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('mounts cake-v2 at its authored bottom origin and scales its real geometry from rule state', async () => {
  const { models, instances } = await fixture(), world = propWorld(), state = createGame(world);
  const visuals = createOfficePropVisuals(world, { models });
  cleanups.push(() => visuals.dispose());
  const cake = state.props[0], visual = visuals.props.get(cake.id)!;
  const model = instances.find(instance => instance.userData.runtimeAssetId === 'cake-v2')!;
  expect(model.parent).toBe(visual);
  expect(visual.children).toEqual([model]);
  const authoredTransforms: number[][] = [];
  model.traverse(node => authoredTransforms.push([...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()]));

  for (const scale of [1, 2.5, 1]) {
    Object.assign(cake, { scale, x: 3, y: .75, z: 5 });
    const snapshot = JSON.stringify(state);
    visuals.update(state, () => undefined);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(visual.scale.toArray()).toEqual([scale, scale, scale]);
    const measured = bounds(visual);
    expect(measured.size.x).toBeCloseTo(.6 * scale, 5);
    expect(measured.size.y).toBeCloseTo(.4 * scale, 5);
    expect(measured.size.z).toBeCloseTo(.6 * scale, 5);
    expect(measured.box.min.y).toBeCloseTo(.75, 5);
    expect(measured.box.getCenter(new THREE.Vector3()).x).toBeCloseTo(3, 5);
    expect(measured.box.getCenter(new THREE.Vector3()).z).toBeCloseTo(5, 5);
  }
  const afterTransforms: number[][] = [];
  model.traverse(node => afterTransforms.push([...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()]));
  expect(afterTransforms).toEqual(authoredTransforms);

  const actor = new THREE.Group(), hand = new THREE.Object3D();
  actor.position.set(4, 1, 6); hand.position.set(.2, .5, -.3); actor.add(hand);
  cake.held = true;
  visuals.update(state, (id, kind) => id === 'player' && kind === 'hand' ? hand : undefined, true);
  expect(visual.visible).toBe(false);
  expect(visual.position.x).toBeCloseTo(4.2);
  expect(visual.position.y).toBeCloseTo(1.62);
  expect(visual.position.z).toBeCloseTo(5.7);
  visuals.update(state, () => hand, false);
  expect(visual.visible).toBe(true);
});

it('mounts the real exit in every cardinal orientation with separate sign text and authoritative open state', async () => {
  const { models, instances } = await fixture(), world = propWorld();
  world.exits = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }].map((outward, index) => ({
    ...world.exits[0], id: `exit-${index}`, x: 10 + index * 3, z: 7, outward,
  }));
  const state = createGame(world), visuals = createOfficePropVisuals(world, { models });
  cleanups.push(() => visuals.dispose());
  const doorInstances = instances.filter(instance => instance.userData.runtimeAssetId === 'exit-door-v1');
  expect(doorInstances).toHaveLength(4);
  world.exits.forEach((exit, index) => {
    const visual = visuals.exits.get(exit.id)!, model = doorInstances[index];
    expect(model.parent).toBe(visual);
    expect(visual.children).toHaveLength(3);
    expect(model.scale.toArray()).toEqual([1, 1, 1]);
    expect(model.position.toArray()).toEqual([0, 0, 0]);
    for (const rotation of [model.rotation.x, model.rotation.y, model.rotation.z]) expect(rotation).toBeCloseTo(0);
    expect(visual.position.toArray()).toEqual([exit.x + exit.outward.x * .65, 0, exit.z + exit.outward.z * .65]);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(visual.quaternion);
    expect(forward.x).toBeCloseTo(-exit.outward.x);
    expect(forward.z).toBeCloseTo(-exit.outward.z);
    const measured = bounds(model);
    expect(measured.size.x).toBeCloseTo(exit.outward.x ? .12 : 2.18, 5);
    expect(measured.size.y).toBeCloseTo(2.28, 5);
    expect(measured.size.z).toBeCloseTo(exit.outward.x ? 2.18 : .12, 5);
    expect(measured.box.min.y).toBeCloseTo(0, 5);
    const sign = visual.getObjectByName(`exit-sign:${exit.id}`) as THREE.Mesh<THREE.PlaneGeometry>;
    expect(sign.parent).toBe(visual);
    expect(sign.geometry.parameters.width).toBeLessThan(1.055);
    expect(sign.geometry.parameters.height).toBeLessThan(.215);
    expect(sign.position.toArray()).toEqual([0, 2.1525, .052]);
    expect(visual.getObjectByName(`exit-instruction:${exit.id}`)?.parent).toBe(visual);
  });
  state.openedExits = [world.exits[0].id];
  const snapshot = JSON.stringify(state);
  visuals.update(state, () => undefined);
  expect(JSON.stringify(state)).toBe(snapshot);
  expect(visuals.exits.get(world.exits[0].id)!.visible).toBe(false);
  for (const exit of world.exits.slice(1)) expect(visuals.exits.get(exit.id)!.visible).toBe(true);
  state.openedExits = [];
  visuals.update(state, () => undefined);
  expect([...visuals.exits.values()].every(exit => exit.visible)).toBe(true);
});

it('releases only local labels while the scene and runtime library retain shared model resources', async () => {
  const { assets, sources, models, instances } = await fixture(), world = propWorld();
  const shared = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  for (const source of sources.values()) source.scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    shared.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) shared.add(material);
  });
  const material = [...shared].find(resource => resource instanceof THREE.MeshStandardMaterial) as THREE.MeshStandardMaterial;
  material.map = new THREE.Texture(); shared.add(material.map);
  const disposed = [...shared].map(resource => vi.spyOn(resource, 'dispose'));
  const release = vi.spyOn(assets, 'releaseInstance'), visuals = createOfficePropVisuals(world, { models });
  cleanups.push(() => visuals.dispose());
  const scene = new THREE.Scene(); scene.add(visuals.root);
  const label = visuals.root.getObjectByName(`exit-sign:${world.exits[0].id}`) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const labelResources = [label.geometry, label.material, label.material.map!].map(resource => vi.spyOn(resource, 'dispose'));
  visuals.dispose(); visuals.dispose();
  expect(visuals.root.parent).toBeNull();
  for (const spy of labelResources) expect(spy).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();
  for (const spy of disposed) expect(spy).not.toHaveBeenCalled();
  for (const instance of instances) assets.releaseInstance(instance);
  for (const spy of disposed) expect(spy).not.toHaveBeenCalled();
  const nextRound = assets.instantiate('cake-v2');
  expect(bounds(nextRound).size.y).toBeCloseTo(.4, 5);
  assets.releaseInstance(nextRound);
  assets.dispose(); assets.dispose();
  for (const spy of disposed) expect(spy).toHaveBeenCalledOnce();
});

it.each([undefined, () => undefined])('preserves standalone preview fallback and rule updates without loaded models (%s)', models => {
  const world = propWorld(), state = createGame(world), visuals = createOfficePropVisuals(world, { models });
  cleanups.push(() => visuals.dispose());
  const cake = state.props[0], visual = visuals.props.get(cake.id)!;
  expect(bounds(visual).size.y).toBeGreaterThan(.3);
  cake.scale = 2;
  state.openedExits = [world.exits[0].id];
  visuals.update(state, () => undefined);
  expect(visual.scale.toArray()).toEqual([2, 2, 2]);
  expect(visuals.exits.get(world.exits[0].id)!.visible).toBe(false);
  expect(visuals.root.getObjectByName(`exit-sign:${world.exits[0].id}`)).toBeDefined();
});
