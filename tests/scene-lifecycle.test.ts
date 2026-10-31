import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { OfficeScene } from '../src/presentation/scene';
import { generateWorld } from '../src/world/generate';
import { createGame } from '../src/rules/game';
import { RuntimeAssets } from '../src/gameplay/assets';
import { makeWorldQuery } from '../src/world/query';
import { validateWorld } from '../src/world/validate';
import { physicalBounds } from '../src/gameplay/physical-bounds';
import { deskWorkingPoint } from '../src/world/workstations';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CharacterLibrary, CharacterVisual } from '../src/presentation/characters';

type Compilation = { object: THREE.Object3D; resolve: () => void; reject: (error: Error) => void };
const harness = vi.hoisted(() => ({ pending: [] as Compilation[], render: vi.fn(), dispose: vi.fn(), disconnect: vi.fn() }));
vi.mock('three', async importOriginal => {
 const actual = await importOriginal<typeof import('three')>();
 return { ...actual, WebGLRenderer: class {
  domElement = { tabIndex: 0, setAttribute: vi.fn(), remove: vi.fn() };
  shadowMap = { enabled: false };
  capabilities = { getMaxAnisotropy: () => 4 };
  setPixelRatio() {}
  setSize() {}
  initTexture() {}
  render = harness.render;
  dispose = harness.dispose;
  compileAsync(object: THREE.Object3D) {
   return new Promise<void>((resolve, reject) => harness.pending.push({ object, resolve, reject }));
  }
 } };
});

let scenes: OfficeScene[] = [];
beforeEach(() => {
 harness.pending = []; vi.clearAllMocks(); scenes = [];
 vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
 vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, stroke() {} }) }) });
 vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = harness.disconnect; });
});
afterEach(() => { for (const scene of scenes) scene.dispose(); vi.unstubAllGlobals(); });

function loadedScene(seed = 618) {
 const scene = new OfficeScene({ appendChild() {} } as unknown as HTMLElement, {
  quality: 'low', sensitivity: 1, invertY: false, reducedMotion: false, textScale: 1,
 });
 scenes.push(scene); scene.load(generateWorld(seed)); return scene;
}
function observeResources(object: THREE.Object3D) {
 const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>();
 object.traverse(node => {
  if (node instanceof THREE.Mesh || node instanceof THREE.Sprite || node instanceof THREE.Line) {
   if (!(node instanceof THREE.Sprite)) geometries.add(node.geometry);
   for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
    materials.add(material);
    const map = (material as THREE.MeshBasicMaterial).map;
    if (map) textures.add(map);
   }
  }
 });
 return [...materials, ...textures, ...geometries].map(resource => ({ resource, disposed: vi.spyOn(resource, 'dispose') }));
}
const settle = async (index: number) => { harness.pending[index].resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

it('does not render new occupants against an old scene while a replacement is loading', () => {
 const scene=loadedScene(618),world=generateWorld(42),state=createGame(world);
 expect(generateWorld(618).colleagues).toHaveLength(4);expect(state.colleagues).toHaveLength(7);
 expect(()=>scene.render(state,0,0,'loading',1/60)).not.toThrow();
 expect(harness.render).not.toHaveBeenCalled();
 scene.clear();expect(()=>scene.render(state,0,0,'loading',1/60)).not.toThrow();
 expect(harness.render).not.toHaveBeenCalled();
 scene.load(world);scene.render(state,0,0,'ready',1/60);
 expect(harness.render).toHaveBeenCalledTimes(1);
});

it('detaches an old world immediately but keeps its materials and textures alive until compilation settles', async () => {
 const scene = loadedScene(), group = scene.scene.children.find(child => child instanceof THREE.Group)!;
 const resources = observeResources(group), preparation = scene.prepare();
 scene.clear();
 expect(scene.scene.children).not.toContain(group);
 for (const resource of resources) expect(resource.disposed).not.toHaveBeenCalled();
 await settle(0); await preparation;
 for (const resource of resources) expect(resource.disposed).toHaveBeenCalledTimes(1);
 expect(harness.pending).toHaveLength(1); expect(harness.render).not.toHaveBeenCalled();
});

it('an obsolete preparation cannot mark a replacement world as warmed', async () => {
 const scene = loadedScene(), oldPreparation = scene.prepare();
 scene.load(generateWorld(619));
 await settle(0); await oldPreparation;
 const replacementPreparation = scene.prepare();
 expect(harness.pending).toHaveLength(2);
 await settle(1);
 expect(harness.pending).toHaveLength(3);
 const probe = harness.pending[2].object as THREE.Mesh;
 expect((probe.material as THREE.Material).transparent).toBe(true);
 await settle(2); await replacementPreparation;
 expect(harness.render).toHaveBeenCalledTimes(1);
 await scene.prepare(); expect(harness.pending).toHaveLength(3);
});

it('keeps retired resources until every overlapping compilation has settled', async () => {
 const scene = loadedScene(), oldGroup = scene.scene.children.find(child => child instanceof THREE.Group)!;
 const resources = observeResources(oldGroup), oldPreparation = scene.prepare();
 scene.load(generateWorld(619)); const replacementPreparation = scene.prepare();
 await settle(0); await oldPreparation;
 for (const resource of resources) expect(resource.disposed).not.toHaveBeenCalled();
 await settle(1);
 for (const resource of resources) expect(resource.disposed).toHaveBeenCalledTimes(1);
 await settle(2); await replacementPreparation;
 expect(harness.render).toHaveBeenCalledTimes(1);
});

it('retains the detached transparent probe material until its own compilation settles', async () => {
 const scene = loadedScene(), preparation = scene.prepare();
 await settle(0);
 const material = (harness.pending[1].object as THREE.Mesh).material as THREE.Material;
 const disposed = vi.spyOn(material, 'dispose');
 scene.load(generateWorld(619));
 expect(disposed).not.toHaveBeenCalled();
 await settle(1); await preparation;
 expect(disposed).toHaveBeenCalledTimes(1); expect(harness.render).not.toHaveBeenCalled();
 const next = scene.prepare(); await settle(2); await settle(3); await next;
 expect(harness.render).toHaveBeenCalledTimes(1);
});

it.each(['resolve', 'reject'] as const)('defers renderer disposal through a pending compilation that will %s', async outcome => {
 const scene = loadedScene(), group = scene.scene.children.find(child => child instanceof THREE.Group)!;
 const resources = observeResources(group), preparation = scene.prepare();
 const result = preparation.then(() => null, error => error);
 const removed = vi.spyOn(scene.canvas, 'remove');
 scene.dispose(); scene.dispose();
 expect(removed).toHaveBeenCalledTimes(1); expect(harness.disconnect).toHaveBeenCalledTimes(1);
 expect(harness.dispose).not.toHaveBeenCalled();
 for (const resource of resources) expect(resource.disposed).not.toHaveBeenCalled();
 const failure = new Error('GPU compilation failed');
 if (outcome === 'reject') harness.pending[0].reject(failure); else harness.pending[0].resolve();
 expect(await result).toBe(outcome === 'reject' ? failure : null);
 for (const resource of resources) expect(resource.disposed).toHaveBeenCalledTimes(1);
 expect(harness.dispose).toHaveBeenCalledTimes(1); expect(harness.render).not.toHaveBeenCalled();
 await scene.prepare(); expect(harness.pending).toHaveLength(1);
});

it('retires runtime instances after compilation while keeping shared model resources for the next round', async () => {
 const geometry=new THREE.BoxGeometry(),texture=new THREE.Texture(),material=new THREE.MeshStandardMaterial({map:texture});
 const source=new THREE.Group();source.add(new THREE.Mesh(geometry,material));
 const asset={scene:source,scenes:[source],animations:[],asset:{version:'2.0'},userData:{}} as unknown as GLTF;
 const library=new RuntimeAssets(async()=>asset);
 await library.preload([{id:'chair-v1',url:'chair.glb'},{id:'pot-v1',url:'pot.glb'}]);
 const geometryDisposed=vi.spyOn(geometry,'dispose'),materialDisposed=vi.spyOn(material,'dispose'),textureDisposed=vi.spyOn(texture,'dispose');
 const release=vi.spyOn(library,'releaseInstance'),scene=loadedScene();scene.useRuntimeAssets(library);scene.load(generateWorld(618));
 let instanceCount=0;scene.scene.traverse(node=>{if(node.userData.runtimeAssetId)instanceCount++;});
 expect(instanceCount).toBeGreaterThan(2);
 const preparation=scene.prepare();scene.clear();
 expect(release).not.toHaveBeenCalled();
 await settle(0);await preparation;
 expect(release).toHaveBeenCalledTimes(instanceCount);
 for(const disposed of [geometryDisposed,materialDisposed,textureDisposed])expect(disposed).not.toHaveBeenCalled();
 expect(()=>library.instantiate('pot-v1')).not.toThrow();
 library.dispose();
 for(const disposed of [geometryDisposed,materialDisposed,textureDisposed])expect(disposed).toHaveBeenCalledTimes(1);
});

it('shows one chair per occupied seat and keeps the original home seat empty while its chair is sticky',()=>{
 const world=generateWorld(618),state=createGame(world),scene=loadedScene();
 const group=scene.scene.children.find(child=>child instanceof THREE.Group)!;
 const chairs=new Map<string,THREE.Object3D>();
 group.traverse(child=>{if(child.userData.deskId)chairs.set(child.userData.deskId,child);});
 const render=()=>scene.render(state,0,0,'playing',1/60);
 render();for(const colleague of state.colleagues)expect(chairs.get(colleague.deskId)!.visible).toBe(false);
 const home=world.desks.find(desk=>desk.home)!,other=world.desks.find(desk=>!desk.home&&!state.colleagues.some(colleague=>colleague.deskId===desk.id))!;
 expect(chairs.get(home.id)!.visible).toBe(false);
 Object.assign(state.player,deskWorkingPoint(other),{pose:'working',workstationId:other.id});render();
 expect(chairs.get(home.id)!.visible).toBe(true);expect(chairs.get(other.id)!.visible).toBe(false);
 Object.assign(state.player,{pose:'standing'});render();expect(chairs.get(other.id)!.visible).toBe(true);
 Object.assign(state.player,{pose:'rolling',sticky:true});render();expect(chairs.get(home.id)!.visible).toBe(false);
});

it('uses the Kimi environment and props once, with all rule visuals driven by the same state',()=>{
 const world=generateWorld(618),state=createGame(world),scene=loadedScene();
 const group=scene.scene.children.find(child=>child instanceof THREE.Group)!;
 expect(group.children).toHaveLength(world.colleagues.length+5);
 expect(group.children.filter(child=>child.name==='office-environment')).toHaveLength(1);
 expect(group.children.filter(child=>child.name==='office-props')).toHaveLength(1);
 expect(group.children.filter(child=>child.name==='room-decorations')).toHaveLength(1);
 const environment=group.getObjectByName('office-environment')!;
 expect(world.walls.every(wall=>environment.getObjectByName(`world-wall:${wall.id}`))).toBe(true);
 expect(world.desks.every(desk=>environment.getObjectByName(`desk-clutter:${desk.id}`))).toBe(true);
 const room=world.rooms.find(room=>room.pressure)!,desk=world.desks[0],partition=world.walls.find(wall=>wall.partition)!;
 state.pressureRooms=[room.id];state.pressureHeights[room.id]=1.6;
 state.deskHeights[desk.id]=1.2;state.transparentWalls=[partition.id];state.flowRooms=[room.id];
 state.openedExits=[world.exits[0].id];state.lights[room.id]=false;
 const before=JSON.stringify(state);
 scene.render(state,0,0,'playing',1/60);
 const diagnostics=scene.getRuleVisuals();
 expect(diagnostics.ceilings.find(item=>item.roomId===room.id)?.clearance).toBe(1.6);
 expect(diagnostics.desks.find(item=>item.id===desk.id)?.height).toBe(1.2);
 expect(diagnostics.partitions.find(item=>item.id===partition.id)?.opacity).toBe(.2);
 expect(diagnostics.flows).toEqual([room.id]);
 expect(diagnostics.decorationColliders.length).toBeGreaterThan(0);
 expect(scene.getDecorationColliders()).toEqual(diagnostics.decorationColliders);
 for(const collider of diagnostics.decorationColliders){
  const fixture=group.getObjectByName(collider.id);expect(fixture,collider.id).toBeDefined();
  const bounds=physicalBounds(fixture!);
  expect(collider.height).toBeCloseTo(bounds.max.y);
  expect(collider.w).toBeCloseTo(bounds.max.x-bounds.min.x);
  expect(collider.d).toBeCloseTo(bounds.max.z-bounds.min.z);
 }
 expect(JSON.stringify(state)).toBe(before);
 state.pressureRooms=[];state.transparentWalls=[];state.flowRooms=[];state.deskHeights={};
 scene.render(state,0,0,'playing',1/60);
 const restored=scene.getRuleVisuals();
 expect(restored.ceilings.find(item=>item.roomId===room.id)?.clearance).toBe(2.8);
 expect(restored.desks.find(item=>item.id===desk.id)?.height).toBe(.75);
 expect(restored.partitions.find(item=>item.id===partition.id)?.opacity).toBe(1);
 expect(restored.flows).toEqual([]);
});

it.each([618,42,1030,20261031])('keeps mandatory routes usable after registering actual furniture bounds for seed %i',seed=>{
 const world=generateWorld(seed),scene=loadedScene(seed);
 world.decorationColliders=scene.getDecorationColliders();
 expect(world.decorationColliders.length).toBeGreaterThan(0);
 const validation=validateWorld(world,createGame(world),makeWorldQuery(world));
 expect(validation.failures).toEqual([]);expect(validation.valid).toBe(true);
});

it('keeps an upward camera ray in front of the formal doorway header',()=>{
 const world=generateWorld(618);world.walls=[];world.spawn={x:5,z:5};
 world.doors=[{id:'camera-header',a:0,b:1,x:5,z:4,axis:'x',width:2.2}];
 const state=createGame(world),scene=loadedScene();scene.load(world);
 Object.assign(state.player,{x:5,z:5,y:0,pose:'standing'});
 for(let i=0;i<90;i++)scene.render(state,0,-.65,'playing',1/60);
 const camera=scene.getRuleVisuals().camera;
 expect(camera.position.z).toBeGreaterThan(3.875);
 expect(camera.position.y).toBeLessThan(2.26);
 expect(camera.position.y).toBeGreaterThan(.14);
});

it('returns detached character diagnostics without exposing mutable pose calibration',()=>{
 const contact={seatY:.5,seatProbeZ:0,backrestFrontZ:-.2,backrestProbeY:.8};
 const make=()=>{
  const root=new THREE.Group(),hand=new THREE.Object3D(),back=new THREE.Object3D(),crown=new THREE.Object3D();root.add(hand,back,crown);
  const bones={LeftFoot:new THREE.Bone(),RightFoot:new THREE.Bone(),LeftHand:new THREE.Bone(),RightHand:new THREE.Bone()};
  const chair=new THREE.Group();root.add(chair,...Object.values(bones));
  return {root,bones,chair,assetId:'employee-base-v1',anchors:{hand,back,crown},update(){},measure:()=>({}),getDiagnostics:()=>({chairContact:contact}),dispose:()=>root.removeFromParent()} as unknown as CharacterVisual;
 };
 const library:CharacterLibrary={prepare:async()=>{},createEmployee:make,createLeader:make,createColleague:make,dispose(){}};
 const scene=loadedScene(),world=generateWorld(618);scene.useCharacterLibrary(library);scene.load(world);
 const snapshot=scene.getCharacterDiagnostics(createGame(world));snapshot[0].chairContact!.seatY=99;
 expect(contact.seatY).toBe(.5);expect(scene.getCharacterDiagnostics(createGame(world))[0].chairContact?.seatY).toBe(.5);
});

it.each(['standing','crouching','rolling'] as const)('keeps the world readable near a wall while %s, restoring the actor and carried objects in the open',pose=>{
 const world=generateWorld(618),state=createGame(world),scene=loadedScene();
 world.walls=[{id:'camera-test-wall',roomId:0,x:5,z:4,w:8,d:.2,height:2.8}];
 scene.load(world);
 Object.assign(state.player,{x:5,z:5,pose,sticky:pose==='rolling',potId:state.pots[0].id});
 state.pots[0].owner='player';state.pots[0].phase='attached';
 const box=state.props.find(prop=>prop.kind==='box')!;box.held=true;state.player.holding=box.id;
 const visual=(key:string,id:string)=>{let found:THREE.Object3D|undefined;scene.scene.traverse(node=>{if(node.userData[key]===id)found=node;});return found!;};
 const before=JSON.stringify(state);
 scene.render(state,0,0,'playing',1);
 expect(scene.getRuleVisuals().camera.playerVisible).toBe(false);
 expect(scene.getRuleVisuals().camera.position.z).toBeGreaterThan(4.24);
 expect(visual('actorId','player').visible).toBe(false);
 expect(visual('actorId','boss').visible).toBe(true);
 expect(visual('potId',state.pots[0].id).visible).toBe(false);
 expect(visual('propId',box.id).visible).toBe(false);
 expect(JSON.stringify(state)).toBe(before);
 // A thrown pot must remain visible even when its owner is hidden by the close camera.
 state.pots[0].phase='flying';scene.render(state,0,0,'playing',1);
 expect(visual('potId',state.pots[0].id).visible).toBe(true);
 state.pots[0].phase='returning';scene.render(state,0,0,'playing',1);
 expect(visual('potId',state.pots[0].id).visible).toBe(true);
 state.pots[0].phase='held';scene.render(state,0,0,'playing',1);
 expect(visual('potId',state.pots[0].id).visible).toBe(false);
 state.pots[0].phase='attached';
 state.player.z=9;scene.render(state,0,0,'playing',1);
 expect(scene.getRuleVisuals().camera.playerVisible).toBe(true);
 expect(visual('potId',state.pots[0].id).visible).toBe(true);
 expect(visual('propId',box.id).visible).toBe(true);
 state.player.z=5;scene.render(state,0,0,'playing',1);
 expect(scene.getRuleVisuals().camera.playerVisible).toBe(false);
 scene.render(state,0,0,'home',1);
 expect(scene.getRuleVisuals().camera.playerVisible).toBe(true);
});
