import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RuntimeAssets } from '../src/gameplay/assets';
import { createCharacterUpdater } from '../src/gameplay/character-updates';
import { runtimeCatalog } from '../src/gameplay/runtime-catalog';
import { createCharacterLibrary, type CharacterLibrary, type CharacterPoseInput, type CharacterVisual } from '../src/presentation/characters';
import { createOfficePropVisuals, type OfficePropVisuals } from '../src/presentation/props';
import { generateWorld } from '../src/world/generate';
import { createGame } from '../src/rules/game';
import { OfficeScene } from '../src/presentation/scene';
import { makeWorldQuery } from '../src/world/query';
import { validateWorld } from '../src/world/validate';

const assetIds = runtimeCatalog.map(asset=>asset.id);
type AssetId = typeof assetIds[number];
const assetBytes = new Map<AssetId, Buffer>();
const sourcePaths = ['src/presentation/characters.ts', 'src/presentation/character-rig.ts', 'src/presentation/props.ts', 'src/presentation/environment.ts', 'src/presentation/effects.ts', 'src/presentation/scene.ts', 'src/presentation/visual-utils.ts', 'src/gameplay/assets.ts', 'src/gameplay/character-updates.ts', 'src/world/query.ts', 'src/world/generate.ts'];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = () => Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(resolve(path)))]));
let hashesBefore: Record<string, string>;
const startedAt = new Date().toISOString();
const measurements: { kind: string; pose: string; pot: string; height: number; bodyHeight: number; bodyMinY: number; ceilingLimit: number | null; dimensionPassed: boolean | null; anchors: Record<string, number[]>; potBounds: { minY: number; maxY: number } | null }[] = [];
const cleanups: (() => void)[] = [];

// Geometry, skins, poses and collision are real; rendering is deliberately outside this CPU suite.
vi.mock('three', async importOriginal => {
 const actual = await importOriginal<typeof import('three')>();
 return { ...actual, WebGLRenderer: class {
  domElement = { tabIndex: 0, setAttribute() {}, remove() {} };
  shadowMap = { enabled: false };
  capabilities = { getMaxAnisotropy: () => 4 };
  setPixelRatio() {} setSize() {} initTexture() {} render() {} dispose() {}
  async compileAsync() {}
 } };
});

/** Decode the shipped geometry/skins/clips, omitting only image/material texture references in memory. */
function cpuGlb(bytes: Buffer): ArrayBuffer {
 expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
 expect(bytes.readUInt32LE(4)).toBe(2);
 expect(bytes.readUInt32LE(8)).toBe(bytes.length);
 let document: Record<string, unknown> | undefined;
 let binary: Buffer | undefined;
 for (let offset = 12; offset < bytes.length;) {
  const length = bytes.readUInt32LE(offset), kind = bytes.readUInt32LE(offset + 4);
  if (kind === 0x4e4f534a) document = JSON.parse(bytes.toString('utf8', offset + 8, offset + 8 + length)) as Record<string, unknown>;
  if (kind === 0x004e4942) binary = bytes.subarray(offset + 8, offset + 8 + length);
  offset += 8 + length;
 }
 if (!document || !binary) throw new Error('Expected a GLB JSON and embedded binary chunk');
 // Preserve material slots/shared ownership, but no GPU/image work is part of this CPU test.
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

async function fixture() {
 const sources = new Map<string, GLTF>();
 const assets = new RuntimeAssets(async id => {
  const bytes = assetBytes.get(id as AssetId); if (!bytes) throw new Error(`Unexpected asset: ${id}`);
  const asset = await new GLTFLoader().parseAsync(cpuGlb(bytes), '');
  sources.set(id, asset); return asset;
 });
 await assets.preload(assetIds.map(id => ({ id, url: id })));
 const library = createCharacterLibrary({ assets }); await library.prepare();
 cleanups.push(() => { library.dispose(); assets.dispose(); });
 return { assets, library, sources };
}

function meshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
 const result: THREE.SkinnedMesh[] = [];
 root.traverse(object => { if (object instanceof THREE.SkinnedMesh) result.push(object); });
 return result;
}
function assertFinite(value: unknown): void {
 if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
 else if (Array.isArray(value)) value.forEach(assertFinite);
 else if (value && typeof value === 'object') Object.values(value).forEach(assertFinite);
}
const pose = (overrides: Partial<CharacterPoseInput> = {}): CharacterPoseInput => ({ pose: 'standing', moving: false, sprint: false, time: .4, holding: false, pot: 'none', ...overrides });

beforeAll(() => {
 hashesBefore = sourceHashes();
 for (const {id,path} of runtimeCatalog) assetBytes.set(id, readFileSync(resolve(`public/${path}`)));
});
beforeEach(() => {
 vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, stroke() {} }) }) });
 vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
 vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => {
 const output = process.env.FORMAL_CHARACTER_REPORT;
 if (!output) return;
 const path = resolve(output), localRoot = resolve('.local') + '/';
 if (!path.startsWith(localRoot)) throw new Error('Formal character reports must stay inside the ignored .local directory');
 const hashesAfter = sourceHashes();
 const sourceChangedDuringRun = JSON.stringify(hashesBefore) !== JSON.stringify(hashesAfter);
 mkdirSync(dirname(path), { recursive: true });
 writeFileSync(path, JSON.stringify({
  startedAt, finishedAt: new Date().toISOString(), evidence: 'real-shipped-GLB CPU integration and dimension measurement',
  limitations: ['Textures are omitted in memory; no GLB on disk is changed.', 'No GPU, rendered appearance, FPS, chair contact quality or complete gameplay acceptance is claimed.', 'Declared dimension envelopes are asserted with real production geometry; visual quality is reviewed separately.'],
  assets: assetIds.map(id => ({ id, bytes: assetBytes.get(id)!.length, sha256: hash(assetBytes.get(id)!) })),
  sourceHashesBefore: hashesBefore, sourceHashesAfter: hashesAfter, sourceChangedDuringRun,
  measurementsComplete: measurements.length === 8,
  dimensionsAccepted: !sourceChangedDuringRun && measurements.length === 8 && measurements.filter(row => row.ceilingLimit !== null).length === 4 && measurements.every(row => row.dimensionPassed !== false), measurements,
 }, null, 2) + '\n');
});

it.each([618, 42])('instantiates all sixteen shipped model IDs and keeps station operating points reachable in seed %s', async seed => {
 const { assets, library, sources } = await fixture();
 const scene = new OfficeScene({ appendChild() {} } as unknown as HTMLElement, { quality: 'low', sensitivity: 1, invertY: false, reducedMotion: false, textScale: 1 });
 cleanups.push(() => scene.dispose());
 scene.useRuntimeAssets(assets, assetIds); scene.useCharacterLibrary(library);
 const world = generateWorld(seed), state = createGame(world);
 scene.load(world); scene.render(state, 0, 0, 'playing', 1 / 60);
 const visuals = scene.getRuleVisuals();
 expect(new Set(visuals.modelInstances.map(row => row.assetId))).toEqual(new Set(assetIds));
 expect(visuals.characters.every(row => row.assetId !== 'technical-placeholder')).toBe(true);
 expect(visuals.modelInstances.find(row => row.assetId === 'computer-set-v1')?.count).toBe(world.desks.length);
 world.decorationColliders = scene.getDecorationColliders();
 const query = makeWorldQuery(world), validation = validateWorld(world, state, query);
 expect(validation.failures).toEqual([]);
 for (const station of world.stations) {
  const collider = world.decorationColliders.find(row => row.id === `station-body:${station.id}`)!;
  expect(collider).toBeDefined(); expect(collider.height).toBeCloseTo(1.23, 2);
  const moved = query.move(station, { x: collider.x - station.x, z: collider.z - station.z }, .3, 1.7, state);
  expect(Math.hypot(moved.x - collider.x, moved.z - collider.z)).toBeGreaterThan(.3);
 }
 const computer = sources.get('computer-set-v1')!.scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
 const disposed = vi.spyOn(computer.geometry, 'dispose');
 scene.clear();
 expect(disposed).not.toHaveBeenCalled();
 scene.load(world);
 expect(scene.getRuleVisuals().modelInstances.find(row => row.assetId === 'computer-set-v1')?.count).toBe(world.desks.length);
}, 20000);

it('binds chair work to the real desk and leaves exactly one stationary chair after dismount',async()=>{
 const {assets,library}=await fixture();
 const scene=new OfficeScene({appendChild(){}} as unknown as HTMLElement,{quality:'low',sensitivity:1,invertY:false,reducedMotion:false,textScale:1});
 cleanups.push(()=>scene.dispose());scene.useRuntimeAssets(assets,assetIds);scene.useCharacterLibrary(library);
 const world=generateWorld(42),state=createGame(world),home=world.desks.find(desk=>desk.home)!;
 scene.load(world);scene.render(state,0,0,'ready',1/60);
 state.deskHeights[home.id]=1.9;state.player.workStance='chair-standing';state.player.y=.55;
 for(let frame=0;frame<55;frame++){state.elapsed=100+frame/60;scene.render(state,0,0,'playing',1/60);}
 const diagnostic=scene.getCharacterDiagnostics(state).find(actor=>actor.id==='player')!;
 expect(diagnostic.motion?.activity).toBe('chair-work');
 for(const hand of Object.values(diagnostic.motion!.hands)){
  expect(hand.error).toBeLessThan(.025);
  expect(hand.position[1]).toBeCloseTo(1.985,1);
  const localForward=(hand.position[0]-state.player.x)*Math.sin(home.yaw)+(hand.position[2]-state.player.z)*Math.cos(home.yaw);
  expect(localForward).toBeGreaterThan(.365);expect(localForward).toBeLessThan(1.215);
 }
 const chair=scene.scene.getObjectByName(`desk-chair:${home.id}`)!;
 expect(chair.visible).toBe(false);
 state.player.pose='standing';state.player.workStance='seated';state.player.workstationId=null;state.player.y=0;
 state.elapsed+=1/60;scene.render(state,0,0,'playing',1/60);
 expect(chair.visible).toBe(true);
 expect(scene.getCharacterDiagnostics(state).find(actor=>actor.id==='player')!.motion?.chairVisible).toBe(false);
 expect({x:chair.position.x,z:chair.position.z}).toEqual(home.workPoint);
 // A rapid real re-seat reverses the running transition; it must not restart
 // from ground support and visibly drop the body by half a metre.
 state.player.pose='working';state.player.workStance='chair-standing';state.player.workstationId=home.id;state.player.y=.55;
 state.elapsed+=1/60;scene.render(state,0,0,'playing',1/60);
 const reseated=scene.getCharacterDiagnostics(state).find(actor=>actor.id==='player')!.motion!;
 expect(reseated.support).toBeGreaterThan(.95);expect(reseated.chairVisible).toBe(true);expect(chair.visible).toBe(false);
},20000);

it('constructs actual employee, colleague and leader skinned actors with shipped animations and semantic anchors', async () => {
 const { library } = await fixture();
 const actors = [library.createEmployee(), library.createColleague('甲'), library.createLeader()];
 expect(actors.map(actor => actor.assetId)).toEqual(['employee-base-v1', 'employee-base-v1', 'leader-v1']);
 for (const actor of actors) {
  expect(meshes(actor.root).length).toBeGreaterThan(0);
  expect(meshes(actor.root)[0].geometry.attributes.position.count).toBeGreaterThan(100);
  expect(actor.animations).toEqual(expect.arrayContaining(['idle', 'walk', 'run']));
  actor.update(pose()); assertFinite(actor.getDiagnostics());
  for (const name of ['hand', 'back', 'crown', 'grip', 'pelvis', 'leftFoot', 'rightFoot'] as const) expect(actor.anchors[name]).toBeInstanceOf(THREE.Object3D);
 }
});

it('plays real walk clips while preserving another actor and the cache source skeleton', async () => {
 const { library, sources } = await fixture(), first = library.createEmployee(), second = library.createEmployee();
 const source = meshes(sources.get('employee-base-v1')!.scene)[0];
 const a = meshes(first.root)[0], b = meshes(second.root)[0];
 expect(a.skeleton).not.toBe(b.skeleton); expect(first.bones.Hips).not.toBe(second.bones.Hips);
 expect(a.geometry).toBe(source.geometry); expect(b.material).toBe(a.material);
 const otherHip = second.bones.Hips.position.toArray(), sourceBones = source.skeleton.bones.map(bone => bone.quaternion.toArray());
 first.update(pose({ moving: true, time: .05 })); const before = first.bones.LeftUpLeg.quaternion.clone();
 first.update(pose({ moving: true, time: .55 }));
 expect(before.angleTo(first.bones.LeftUpLeg.quaternion)).toBeGreaterThan(.0001);
 first.update(pose({ pose: 'crouching' }));
 expect(second.bones.Hips.position.toArray()).toEqual(otherHip);
 expect(source.skeleton.bones.map(bone => bone.quaternion.toArray())).toEqual(sourceBones);
 assertFinite(first.getDiagnostics()); assertFinite(second.getDiagnostics());
});

it('reuses only the static working rig while preserving real poses, anchors and moving animation', async () => {
 const { library } = await fixture(), reference = library.createEmployee(), cached = library.createEmployee();
 const originalUpdate = vi.spyOn(cached, 'update'), update = createCharacterUpdater(cached);
 const localRig = (actor: CharacterVisual) => {
  actor.root.updateMatrixWorld(true);
  const values = Object.values(actor.bones).flatMap(bone => bone.matrix.toArray());
  values.push(...actor.poseRoot.matrix.toArray());
  for (const anchor of Object.values(actor.anchors)) values.push(...actor.root.worldToLocal(anchor.getWorldPosition(new THREE.Vector3())).toArray());
  const body = actor.measure().body;
  values.push(...body.min, ...body.max);
  return values;
 };
 const sequence = [
  pose({ pose: 'working', time: .1 }), pose({ pose: 'working', time: 1.8 }), pose({ pose: 'working', time: 9 }),
  pose({ pose: 'working', pot: 'crown', time: 12 }), pose({ pose: 'working', pot: 'crown', time: 13 }),
  pose({ pose: 'working', pot: 'crown', holding: true, time: 14 }),
  pose({ pose: 'working', gesturing: true, time: 15 }), pose({ pose: 'working', gesturing: true, time: 16 }),
  pose({ pose: 'working', moving: true, time: 17 }), pose({ pose: 'working', sprint: true, time: 18 }),
  pose({ pose: 'rolling', pot: 'crown', time: 19 }), pose({ pose: 'rolling', pot: 'crown', time: 20 }),
  pose({ pose: 'crouching', time: 21 }), pose({ pose: 'crouching', time: 22 }),
  pose({ pose: 'dragged', time: 23 }), pose({ pose: 'dragged', time: 24 }),
  pose({ moving: true, time: .05 }), pose({ moving: true, time: .55 }),
  pose({ pose: 'working', time: 25 }), pose({ pose: 'working', time: 26 }), pose({ pose: 'working', time: 27 }),
  pose({ pose: 'working', pot: 'crown', clearance: 1.6, time: 28 }), pose({ pose: 'working', pot: 'crown', clearance: 1.6, time: 29 }),
  pose({ pose: 'working', pot: 'crown', clearance: 2.8, time: 30 }), pose({ pose: 'working', pot: 'crown', clearance: 2.8, time: 31 }),
  pose({ pose: 'working', pot: 'crown', clearance: 1.6, time: 32 }), pose({ pose: 'working', pot: 'crown', clearance: 1.6, time: 33 }),
 ];
 const skipped = new Set([1, 2, 4, 19, 22, 24, 26]);
 let expectedCalls = 0;
 for (const [index, input] of sequence.entries()) {
  for (const actor of [reference, cached]) {
   actor.root.position.set(index * .8, Math.sin(index) * .2, 3 - index * .3);
   actor.root.rotation.y = index * .41;
   actor.root.scale.setScalar(index === 20 ? 1.15 : 1);
  }
  reference.update(input); update(input);
  if (!skipped.has(index)) expectedCalls++;
  expect(originalUpdate).toHaveBeenCalledTimes(expectedCalls);
  const expected = localRig(reference), actual = localRig(cached);
  // Skinned vertex evaluation uses Float32 data. One micrometre is below its
  // practical geometric precision here, without relaxing any gameplay height.
  expect(Math.max(...expected.map((value, slot) => Math.abs(value - actual[slot])))).toBeLessThan(1e-6);
 }
});

it('retries a failed working pose instead of caching the failure', async () => {
 const { library } = await fixture(), actor = library.createEmployee(), original = actor.update.bind(actor);
 const spy = vi.spyOn(actor, 'update').mockImplementationOnce(() => { throw new Error('pose failed'); }).mockImplementation(original);
 const update = createCharacterUpdater(actor), input = pose({ pose: 'working' });
 expect(() => update(input)).toThrow('pose failed');
 expect(() => update(input)).not.toThrow();
 expect(spy).toHaveBeenCalledTimes(2);
 update({ ...input, time: 9 }); expect(spy).toHaveBeenCalledTimes(2);
 spy.mockImplementationOnce(() => { actor.bones.Hips.position.y += .3; throw new Error('partial pose failed'); });
 expect(() => update({ ...input, holding: true })).toThrow('partial pose failed');
 update(input); expect(spy).toHaveBeenCalledTimes(4);
 assertFinite(actor.getDiagnostics());
});

it('releases per-actor skeletons once without destroying shared geometry or material before cache disposal', async () => {
 const { assets, library, sources } = await fixture(), first = library.createEmployee(), second = library.createEmployee();
 const mesh = meshes(first.root)[0], shared = meshes(sources.get('employee-base-v1')!.scene)[0];
 const material = Array.isArray(shared.material) ? shared.material[0] : shared.material;
 const geometryDisposed = vi.spyOn(shared.geometry, 'dispose'), materialDisposed = vi.spyOn(material, 'dispose');
 const skeletonDisposed = vi.spyOn(mesh.skeleton, 'dispose');
 first.dispose(); first.dispose();
 expect(skeletonDisposed).toHaveBeenCalledOnce(); expect(geometryDisposed).not.toHaveBeenCalled(); expect(materialDisposed).not.toHaveBeenCalled();
 second.update(pose({ moving: true, time: .8 })); assertFinite(second.getDiagnostics());
 library.dispose(); expect(geometryDisposed).not.toHaveBeenCalled(); expect(materialDisposed).not.toHaveBeenCalled();
 assets.dispose(); expect(geometryDisposed).toHaveBeenCalledOnce(); expect(materialDisposed).toHaveBeenCalledOnce();
});

it('measures finite real poses and production pot composition without treating failed dimensions as visual acceptance', async () => {
 const { assets, library } = await fixture();
 const world = generateWorld(618), state = createGame(world);
 const propWorld = { ...world, desks: [], props: [], stations: [], exits: [], colleagues: [] };
 const props = createOfficePropVisuals(propWorld, { assets: { instantiate: id => assets.instantiate(id), release: (_id, instance) => assets.releaseInstance(instance) } });
 cleanups.push(() => props.dispose());
 state.props = []; state.colleagues = []; state.pots = [{ ...state.pots[0], owner: 'player', phase: 'attached' }];
 const scene = new THREE.Group(); scene.add(props.root);
 const cases: { kind: string; create: (library: CharacterLibrary) => CharacterVisual; input: CharacterPoseInput; limit: number | null }[] = [
  { kind: 'employee', create: lib => lib.createEmployee(), input: pose(), limit: null },
  { kind: 'employee', create: lib => lib.createEmployee(), input: pose({ moving: true, sprint: true }), limit: null },
  { kind: 'employee', create: lib => lib.createEmployee(), input: pose({ pose: 'working', pot: 'crown' }), limit: null },
  { kind: 'employee', create: lib => lib.createEmployee(), input: pose({ pose: 'working', pot: 'crown', clearance: 1.6 } as Partial<CharacterPoseInput>), limit: 1.6 },
  { kind: 'employee', create: lib => lib.createEmployee(), input: pose({ pose: 'crouching' }), limit: .9 },
  { kind: 'employee', create: lib => lib.createEmployee(), input: pose({ pose: 'rolling', pot: 'crown' }), limit: 1.42 },
  { kind: 'employee', create: lib => lib.createEmployee(), input: pose({ pose: 'dragged' }), limit: null },
  { kind: 'leader', create: lib => lib.createLeader(), input: pose({ pose: 'crouching' }), limit: 1.6 },
 ];
 for (const item of cases) {
  const actor = item.create(library); scene.add(actor.root); actor.update(item.input);
  Object.assign(state.player, { x: 0, z: 0, y: 0, pose: item.input.pose, sticky: item.input.pose === 'rolling' });
  props.update(state, (id, anchor) => id === 'player' ? actor.anchors[anchor] : undefined);
  const pot = item.input.pot === 'crown' ? props.pots.get(state.pots[0].id) : undefined;
  // WebGLRenderer performs this propagation in the game. The pot is a sibling, not an actor child.
  scene.updateMatrixWorld(true);
  const measured = actor.measure(pot); assertFinite(measured);
  const potBox = pot ? new THREE.Box3().setFromObject(pot) : null;
  if (potBox) { expect(pot!.visible).toBe(true); expect(measured.combined.max[1]).toBeGreaterThanOrEqual(potBox.max.y - 1e-8); }
  if (item.limit !== null) expect(measured.height).toBeLessThanOrEqual(item.limit);
  const row = { kind: item.kind, pose: item.input.pose, pot: item.input.pot, height: measured.height, bodyHeight: measured.body.size[1], bodyMinY: measured.body.min[1], ceilingLimit: item.limit, dimensionPassed: item.limit === null ? null : measured.height <= item.limit, anchors: measured.anchors, potBounds: potBox ? { minY: potBox.min.y, maxY: potBox.max.y } : null };
  measurements.push(row);
  actor.dispose();
 }
 expect(measurements).toHaveLength(cases.length);
 expect(measurements.filter(row => row.ceilingLimit !== null)).toHaveLength(4);
});
