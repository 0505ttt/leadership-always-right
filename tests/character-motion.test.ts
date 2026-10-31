import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RuntimeAssets } from '../src/gameplay/assets';
import { createCharacterLibrary, type CharacterLibrary, type CharacterPoseInput } from '../src/presentation/characters';
import { createCharacterMotion, type CharacterMotionInput } from '../src/presentation/character-motion';

const assetIds = ['employee-base-v1', 'leader-v1', 'chair-v1'] as const;
type AssetId = typeof assetIds[number];
const assetBytes = new Map<AssetId, Buffer>();
const cleanups: (() => void)[] = [];

function cpuGlb(bytes: Buffer): ArrayBuffer {
  let document: Record<string, unknown> | undefined;
  let binary: Buffer | undefined;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset), kind = bytes.readUInt32LE(offset + 4);
    if (kind === 0x4e4f534a) document = JSON.parse(bytes.toString('utf8', offset + 8, offset + 8 + length)) as Record<string, unknown>;
    if (kind === 0x004e4942) binary = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length;
  }
  if (!document || !binary) throw new Error('Expected GLB JSON and BIN chunks');
  const materials = document.materials as { name?: string; doubleSided?: boolean }[] | undefined;
  document.materials = materials?.map(material => ({ name: material.name, doubleSided: material.doubleSided }));
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

async function fixture(): Promise<CharacterLibrary> {
  const sources = new Map<string, GLTF>();
  const assets = new RuntimeAssets(async id => {
    const bytes = assetBytes.get(id as AssetId);
    if (!bytes) throw new Error(`Unexpected asset ${id}`);
    const asset = await new GLTFLoader().parseAsync(cpuGlb(bytes), '');
    sources.set(id, asset);
    return asset;
  });
  await assets.preload(assetIds.map(id => ({ id, url: id })));
  const library = createCharacterLibrary({ assets });
  await library.prepare();
  cleanups.push(() => { library.dispose(); assets.dispose(); });
  return library;
}

const pose = (overrides: Partial<CharacterMotionInput> = {}): CharacterMotionInput => ({
  pose: 'standing', moving: false, sprint: false, time: 0, holding: false, pot: 'none', ...overrides,
});

function rigValues(actor: ReturnType<CharacterLibrary['createEmployee']>): number[] {
  actor.root.updateMatrixWorld(true);
  const values = Object.values(actor.bones).flatMap(bone => [
    ...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray(),
  ]);
  values.push(...actor.poseRoot.position.toArray());
  const bounds = actor.measure();
  values.push(...bounds.combined.min, ...bounds.combined.max);
  for (const anchor of Object.values(actor.anchors)) values.push(...actor.root.worldToLocal(anchor.getWorldPosition(new THREE.Vector3())).toArray());
  return values;
}

beforeEach(() => {
  for (const id of assetIds) assetBytes.set(id, readFileSync(resolve(`public/assets/tripo/${id}.glb`)));
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {}, strokeRect() {} }) }) });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
});

describe('independent character motion layer', () => {
  it('inherits the frozen low-clearance working pose exactly when no new semantics are supplied', async () => {
    const library = await fixture();
    const reference = library.createEmployee(), actor = library.createEmployee();
    const motion = createCharacterMotion(actor);
    const input = pose({ pose: 'working', pot: 'crown', clearance: 1.6, time: 4 });
    reference.update(input as CharacterPoseInput);
    motion.update(input);
    const expected = rigValues(reference), actual = rigValues(actor);
    expect(Math.max(...expected.map((value, index) => Math.abs(value - actual[index])))).toBeLessThan(1e-7);
    expect(actor.measure().combined.max[1]).toBeCloseTo(reference.measure().combined.max[1], 9);
    expect(motion.getDiagnostics().activity).toBe('inherited');
  });

  it('supports both feet on the real chair and both hands on the raised desktop', async () => {
    const library = await fixture();
    const actor = library.createEmployee();
    actor.root.position.y = .55;
    const motion = createCharacterMotion(actor);
    motion.update(pose({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, time: 0 }));
    motion.update(pose({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, time: 1 }));
    const diagnostics = motion.getDiagnostics();
    expect(diagnostics.activity).toBe('chair-work');
    expect(actor.chair.visible).toBe(true);
    expect(diagnostics.feet.left.verticalError).toBeLessThan(.006);
    expect(diagnostics.feet.right.verticalError).toBeLessThan(.006);
    expect(diagnostics.hands.left.error).toBeLessThan(.006);
    expect(diagnostics.hands.right.error).toBeLessThan(.006);
    expect(diagnostics.hands.left.target[1]).toBeCloseTo(1.985, 6);
    expect(diagnostics.hands.right.target[1]).toBeCloseTo(1.985, 6);
    for (const side of ['Left', 'Right'] as const) {
      const hand = deformedDesktopHandRange(actor, side);
      expect(hand.samples).toBeGreaterThan(0);
      expect(hand.min).toBeGreaterThanOrEqual(1.9 - .006);
      expect(hand.min).toBeLessThanOrEqual(1.9 + .012);
    }
  });

  it('steps one foot at a time during mounting and recovers to the inherited seated pose', async () => {
    const library = await fixture();
    const actor = library.createEmployee(), reference = library.createEmployee();
    const motion = createCharacterMotion(actor);
    motion.update(pose({ pose: 'working', time: 0 }));
    actor.root.position.y = .55;
    motion.update(pose({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, time: .01 }));
    motion.update(pose({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, time: .32 }));
    const middle = motion.getDiagnostics();
    expect(middle.activity).toBe('chair-mount');
    expect(Math.abs(middle.feet.left.position[1] - middle.feet.right.position[1])).toBeGreaterThan(.08);
    expect(Math.min(middle.feet.left.position[1], middle.feet.right.position[1])).toBeLessThan(.2);
    motion.update(pose({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, time: 1 }));
    actor.root.position.y = 0;
    motion.update(pose({ pose: 'working', workStance: 'seated', deskHeight: .75, time: 1.01 }));
    motion.update(pose({ pose: 'working', workStance: 'seated', deskHeight: .75, time: 1.4 }));
    expect(motion.getDiagnostics().activity).toBe('chair-recover');
    motion.update(pose({ pose: 'working', workStance: 'seated', deskHeight: .75, time: 2 }));
    const finalInput = pose({ pose: 'working', time: 2 });
    reference.update(finalInput as CharacterPoseInput);
    const expected = rigValues(reference), actual = rigValues(actor);
    expect(Math.max(...expected.map((value, index) => Math.abs(value - actual[index])))).toBeLessThan(1e-7);
    expect(motion.getDiagnostics().activity).toBe('inherited');
  });

  it('matches the leader search cadence to 7.2 m/s and distributes a clamped 180 degree scan', async () => {
    const library = await fixture();
    const actor = library.createLeader(), reference = library.createLeader();
    const motion = createCharacterMotion(actor);
    const input = pose({ moving: true, leaderMode: 'search', speed: 7.2, lookYawOffset: Math.PI / 2, time: .2 });
    motion.update(input);
    reference.update(pose({ moving: true, sprint: true, time: .2 }) as CharacterPoseInput);
    const diagnostics = motion.getDiagnostics();
    expect(diagnostics.activity).toBe('leader-search');
    expect(diagnostics.cadence).toBeCloseTo(1.5, 8);
    expect(diagnostics.appliedLookYaw).toBeCloseTo(Math.PI / 2, 8);
    expect(actor.bones.Head.quaternion.angleTo(reference.bones.Head.quaternion)).toBeGreaterThan(.2);
    expect(actor.bones.Head.quaternion.angleTo(reference.bones.Head.quaternion)).toBeLessThan(.65);
    motion.update({ ...input, lookYawOffset: Math.PI * .75, time: .3 });
    expect(motion.getDiagnostics().requestedLookYaw).toBeCloseTo(Math.PI * .75, 8);
    expect(motion.getDiagnostics().appliedLookYaw).toBeCloseTo(Math.PI / 2, 8);
    motion.update({ ...input, lookYawOffset: -Math.PI / 2, time: .4 });
    expect(motion.getDiagnostics().appliedLookYaw).toBeCloseTo(-Math.PI / 2, 8);
    for (const bone of Object.values(actor.bones)) {
      expect(Number.isFinite(bone.quaternion.x + bone.quaternion.y + bone.quaternion.z + bone.quaternion.w)).toBe(true);
    }
  });

  it('blends patrol, stopped inspection and fast search instead of switching poses in one frame', async () => {
    const library = await fixture();
    const actor = library.createLeader();
    const motion = createCharacterMotion(actor);
    motion.update(pose({ leaderMode: 'patrol', moving: true, speed: 2, time: 0 }));
    expect(motion.getDiagnostics().transitionProgress).toBe(1);
    motion.update(pose({ leaderMode: 'inspect', moving: false, speed: 0, time: .01 }));
    expect(motion.getDiagnostics().activity).toBe('leader-inspect');
    expect(motion.getDiagnostics().transitionProgress).toBeLessThan(1);
    motion.update(pose({ leaderMode: 'inspect', moving: false, speed: 0, time: .2 }));
    expect(motion.getDiagnostics().transitionProgress).toBe(1);
    motion.update(pose({ leaderMode: 'search', moving: true, speed: 7.2, time: .21 }));
    expect(motion.getDiagnostics().activity).toBe('leader-search');
    expect(motion.getDiagnostics().transitionProgress).toBeLessThan(1);
    motion.update(pose({ leaderMode: 'search', moving: true, speed: 7.2, time: .4 }));
    expect(motion.getDiagnostics().transitionProgress).toBe(1);
    expect(motion.getDiagnostics().cadence).toBeCloseTo(1.5, 8);
  });

  it('keeps repeated transitions, a clock reset and explicit reset finite and restores the exact inherited pose', async () => {
    const library = await fixture();
    const actor = library.createEmployee(), reference = library.createEmployee();
    const motion = createCharacterMotion(actor);
    for (let cycle = 0; cycle < 3; cycle++) {
      const start = cycle * 4;
      actor.root.position.y = 0;
      motion.update(pose({ pose: 'working', time: start }));
      actor.root.position.y = actor.chairContact.seatY;
      for (const offset of [.01, .32, .8]) motion.update(pose({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, time: start + offset }));
      actor.root.position.y = 0;
      for (const offset of [.81, 1.4]) motion.update(pose({ pose: 'working', workStance: 'seated', deskHeight: .75, time: start + offset }));
    }
    const finalInput = pose({ pose: 'working', pot: 'crown', clearance: 1.6, time: .1 });
    motion.update(finalInput);
    reference.update(finalInput as CharacterPoseInput);
    expect(Math.max(...rigValues(reference).map((value, index) => Math.abs(value - rigValues(actor)[index])))).toBeLessThan(1e-7);
    actor.root.position.y = actor.chairContact.seatY;
    motion.update(pose({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, time: 8 }));
    motion.update(pose({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, time: .1 }));
    expect(motion.getDiagnostics().support).toBe(1);
    motion.reset();
    actor.root.position.y = 0;
    motion.update(finalInput);
    expect(motion.getDiagnostics().support).toBe(0);
    expect(motion.getDiagnostics().activity).toBe('inherited');
    expect(Math.max(...rigValues(reference).map((value, index) => Math.abs(value - rigValues(actor)[index])))).toBeLessThan(1e-7);
    actor.root.traverse(object => {
      for (const value of object.matrixWorld.elements) expect(Number.isFinite(value)).toBe(true);
    });
  });

  it('keeps crown, back and pelvis attachments in their bone-local positions through a 180 degree scan', async () => {
    const library = await fixture();
    const actor = library.createLeader();
    const motion = createCharacterMotion(actor);
    const input = pose({ moving: true, leaderMode: 'search', speed: 7.2, time: .2, lookYawOffset: 0 });
    motion.update(input);
    const before = {
      crown: actor.bones.Head.worldToLocal(actor.anchors.crown.getWorldPosition(new THREE.Vector3())),
      back: actor.bones.Spine2.worldToLocal(actor.anchors.back.getWorldPosition(new THREE.Vector3())),
      pelvis: actor.bones.Hips.worldToLocal(actor.anchors.pelvis.getWorldPosition(new THREE.Vector3())),
    };
    motion.update({ ...input, lookYawOffset: Math.PI / 2 });
    const after = {
      crown: actor.bones.Head.worldToLocal(actor.anchors.crown.getWorldPosition(new THREE.Vector3())),
      back: actor.bones.Spine2.worldToLocal(actor.anchors.back.getWorldPosition(new THREE.Vector3())),
      pelvis: actor.bones.Hips.worldToLocal(actor.anchors.pelvis.getWorldPosition(new THREE.Vector3())),
    };
    for (const key of ['crown', 'back', 'pelvis'] as const) expect(after[key].distanceTo(before[key])).toBeLessThan(1e-7);
  });

  it('grounds the deformed feet on the real seat and measures the production pot below a 2.35 m elevated-work clearance', async () => {
    const library = await fixture();
    const actor = library.createEmployee();
    const motion = createCharacterMotion(actor);
    actor.root.position.y = actor.chairContact.seatY;
    for (const time of [0, 1]) motion.update(pose({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, time }));
    actor.root.updateMatrixWorld(true);
    const seatWorldY = actor.chair.localToWorld(new THREE.Vector3(0, actor.chairContact.seatY, actor.chairContact.seatProbeZ)).y;
    for (const side of ['Left', 'Right'] as const) {
      const soles = deformedSoleRange(actor, side);
      expect(soles.min).toBeGreaterThanOrEqual(seatWorldY - .025);
      expect(soles.min).toBeLessThanOrEqual(seatWorldY + .025);
    }

    const { createOfficePropVisuals } = await import('../src/presentation/props');
    const { generateWorld } = await import('../src/world/generate');
    const { createGame } = await import('../src/rules/game');
    const world = generateWorld(618), state = createGame(world);
    const potGLTF = await new GLTFLoader().parseAsync(cpuGlb(readFileSync(resolve('public/assets/tripo/pot-v1.glb'))), '');
    const props = createOfficePropVisuals({ ...world, desks: [], props: [], stations: [], exits: [], colleagues: [] }, {
      assets: { instantiate: () => potGLTF.scene.clone(true) },
    });
    cleanups.push(() => props.dispose());
    state.props = []; state.colleagues = [];
    state.pots = [{ ...state.pots[0], owner: 'player', phase: 'attached' }];
    Object.assign(state.player, { x: 0, y: actor.root.position.y, z: 0, pose: 'working', workStance: 'chair-standing' });
    const scene = new THREE.Group(); scene.add(actor.root, props.root);
    props.update(state, id => id === 'player' ? actor.anchors.back : undefined);
    scene.updateMatrixWorld(true);
    const pot = props.pots.get(state.pots[0].id)!;
    expect(pot.visible).toBe(true);
    expect(pot.rotation.x).toBeCloseTo(Math.PI / 2, 8);
    const measured = actor.measure(pot);
    expect(measured.height).toBeLessThanOrEqual(2.35);
    const skin = deformedSoleRange(actor);
    const potBounds = new THREE.Box3().setFromObject(pot);
    expect(Math.max(skin.max, potBounds.max.y)).toBeLessThanOrEqual(2.35);
    expect(measured.chair).not.toBeNull();
    expect(measured.anchors.crown[1]).toBeGreaterThan(1.2);
  });
});

function deformedSoleRange(actor: ReturnType<CharacterLibrary['createEmployee']>, side?: 'Left' | 'Right'): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  const vertex = new THREE.Vector3();
  actor.root.updateMatrixWorld(true);
  actor.poseRoot.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const indices = object.geometry.getAttribute('skinIndex');
    const weights = object.geometry.getAttribute('skinWeight');
    const footBones = side ? [actor.bones[`${side}Foot`], actor.bones[`${side}ToeBase`]] : [];
    for (let index = 0; index < indices.count; index++) {
      let footWeight = 0;
      for (let influence = 0; influence < 4; influence++) {
        if (footBones.includes(object.skeleton.bones[indices.getComponent(index, influence)])) footWeight += weights.getComponent(index, influence);
      }
      if (side && footWeight < .5) continue;
      object.getVertexPosition(index, vertex);
      object.localToWorld(vertex);
      min = Math.min(min, vertex.y); max = Math.max(max, vertex.y);
    }
  });
  return { min, max };
}

function deformedDesktopHandRange(actor: ReturnType<CharacterLibrary['createEmployee']>, side: 'Left' | 'Right'): { min: number; max: number; samples: number } {
  let min = Infinity, max = -Infinity, samples = 0;
  const vertex = new THREE.Vector3();
  const handBones: THREE.Bone[] = [];
  actor.bones[`${side}Hand`].traverse(object => { if (object instanceof THREE.Bone) handBones.push(object); });
  actor.root.updateMatrixWorld(true);
  actor.poseRoot.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const indices = object.geometry.getAttribute('skinIndex');
    const weights = object.geometry.getAttribute('skinWeight');
    for (let index = 0; index < indices.count; index++) {
      let handWeight = 0;
      for (let influence = 0; influence < 4; influence++) {
        if (handBones.includes(object.skeleton.bones[indices.getComponent(index, influence)])) handWeight += weights.getComponent(index, influence);
      }
      if (handWeight < .5) continue;
      object.getVertexPosition(index, vertex);
      object.localToWorld(vertex);
      const local = actor.root.worldToLocal(vertex.clone());
      if (local.z < .365 || local.z > 1.015 || Math.abs(local.x) > .58) continue;
      min = Math.min(min, vertex.y); max = Math.max(max, vertex.y); samples++;
    }
  });
  return { min, max, samples };
}
