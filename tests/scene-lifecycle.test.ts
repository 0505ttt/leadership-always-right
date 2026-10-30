import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { OfficeScene } from '../src/presentation/scene';
import { generateWorld } from '../src/world/generate';
import { createGame } from '../src/rules/game';
import { RuntimeAssets } from '../src/gameplay/assets';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
 vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) });
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
 const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
 object.traverse(node => {
  if (node instanceof THREE.Mesh || node instanceof THREE.Sprite || node instanceof THREE.Line) {
   for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
    materials.add(material);
    const map = (material as THREE.MeshBasicMaterial).map;
    if (map) textures.add(map);
   }
  }
 });
 return [...materials, ...textures].map(resource => ({ resource, disposed: vi.spyOn(resource, 'dispose') }));
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
 const chairs=new Map(group.children.filter(child=>child.userData.deskId).map(child=>[child.userData.deskId,child]));
 const render=()=>scene.render(state,0,0,'playing',1/60);
 render();for(const colleague of state.colleagues)expect(chairs.get(colleague.deskId)!.visible).toBe(false);
 const home=world.desks.find(desk=>desk.home)!,other=world.desks.find(desk=>!desk.home&&!state.colleagues.some(colleague=>colleague.deskId===desk.id))!;
 expect(chairs.get(home.id)!.visible).toBe(false);
 Object.assign(state.player,other.seat,{pose:'working'});render();
 expect(chairs.get(home.id)!.visible).toBe(true);expect(chairs.get(other.id)!.visible).toBe(false);
 Object.assign(state.player,{pose:'standing'});render();expect(chairs.get(other.id)!.visible).toBe(true);
 Object.assign(state.player,{pose:'rolling',sticky:true});render();expect(chairs.get(home.id)!.visible).toBe(false);
});
