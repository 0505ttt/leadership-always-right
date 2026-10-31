import { expect, it, vi } from 'vitest';
import { AnimationClip, AnimationMixer, Bone, BoxGeometry, DataTexture, Group, InstancedMesh, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, NumberKeyframeTrack, Points, PointsMaterial, Skeleton, SkinnedMesh } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RuntimeAssets } from '../src/gameplay/assets';

function fixture(skinned=false):GLTF {
 const scene=new Group(),material=new MeshStandardMaterial({map:new DataTexture(new Uint8Array(4),1,1)}),geometry=new BoxGeometry();
 const mesh=skinned?new SkinnedMesh(geometry,material):new Mesh(geometry,material);
 scene.add(mesh);scene.position.set(2,3,4);scene.rotation.y=.7;scene.scale.setScalar(.4);
 if(mesh instanceof SkinnedMesh){const bone=new Bone();scene.add(bone);mesh.bind(new Skeleton([bone]));}
 return {scene,scenes:[scene],animations:[],cameras:[],asset:{version:'2.0'},parser:{} as GLTF['parser'],userData:{}};
}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

it('carries GLTF animation clips into independent playable actor instances',async()=>{
 const model=fixture(),clip=new AnimationClip('walk',1,[new NumberKeyframeTrack('.position[x]',[0,1],[2,3])]);
 model.animations=[clip];const assets=new RuntimeAssets(async()=>model);await assets.load('person','/person.glb');
 const first=assets.instantiate('person'),second=assets.instantiate('person'),mixer=new AnimationMixer(first);
 mixer.clipAction(first.animations[0]).play();mixer.update(.5);
 expect(first.position.x).toBeCloseTo(2.5);expect(second.position.x).toBe(2);expect(model.scene.position.x).toBe(2);
 first.animations[0].tracks[0].values[1]=9;
 expect(second.animations[0].tracks[0].values[1]).toBe(3);expect(clip.tracks[0].values[1]).toBe(3);
 mixer.stopAllAction();mixer.uncacheRoot(first);assets.dispose();
});

it('deduplicates concurrent and completed loads while rejecting an ambiguous asset version',async()=>{
 const pending=deferred<GLTF>(),loader=vi.fn(()=>pending.promise),assets=new RuntimeAssets(loader);
 const a=assets.load('pot','/game/pot-v1.glb'),b=assets.load('pot','/game/pot-v1.glb');
 expect(a).toBe(b);await Promise.resolve();expect(loader).toHaveBeenCalledOnce();
 const model=fixture();pending.resolve(model);expect(await a).toBe(model);
 expect(await assets.load('pot','/game/pot-v1.glb')).toBe(model);expect(loader).toHaveBeenCalledOnce();
 await expect(assets.load('pot','/game/pot-v2.glb')).rejects.toThrow(/URL/);assets.dispose();
});

it('allows a failed download to be retried without reloading successful assets',async()=>{
 const model=fixture(),loader=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(model),assets=new RuntimeAssets(loader);
 await expect(assets.load('chair','/chair.glb')).rejects.toThrow('offline');
 expect(await assets.load('chair','/chair.glb')).toBe(model);expect(await assets.load('chair','/chair.glb')).toBe(model);
 expect(loader).toHaveBeenCalledTimes(2);assets.dispose();
});

it('reports actual unique completions for a preload batch',async()=>{
 const first=deferred<GLTF>(),second=deferred<GLTF>(),loader=vi.fn((url:string)=>url==='/a'?first.promise:second.promise),assets=new RuntimeAssets(loader),progress=vi.fn();
 const complete=assets.preload([{id:'a',url:'/a'},{id:'b',url:'/b'},{id:'a',url:'/a'}],progress);
 expect(progress).toHaveBeenCalledWith({completed:0,total:2});
 second.resolve(fixture());await assets.load('b','/b');await Promise.resolve();
 expect(progress).toHaveBeenLastCalledWith({completed:1,total:2,id:'b',failed:[]});
 first.resolve(fixture());await complete;expect(progress).toHaveBeenLastCalledWith({completed:2,total:2,id:'a',failed:[]});
 expect(loader).toHaveBeenCalledTimes(2);assets.dispose();
});

it('clones transforms and bones independently while sharing geometry, materials and textures',async()=>{
 const model=fixture(true),assets=new RuntimeAssets(async()=>model);await assets.load('person','/person.glb');
 const first=assets.instantiate('person'),second=assets.instantiate('person');
 const sourceMesh=model.scene.children[0] as SkinnedMesh,a=first.children[0] as SkinnedMesh,b=second.children[0] as SkinnedMesh;
 expect(first).not.toBe(model.scene);expect(first.position.toArray()).toEqual(model.scene.position.toArray());
 expect(first.scale.toArray()).toEqual(model.scene.scale.toArray());expect(first.rotation.y).toBe(model.scene.rotation.y);
 expect(a.geometry).toBe(sourceMesh.geometry);expect(a.material).toBe(sourceMesh.material);expect(b.material).toBe(a.material);
 expect(a.skeleton).not.toBe(b.skeleton);expect(a.skeleton.bones[0]).not.toBe(sourceMesh.skeleton.bones[0]);
 first.position.x=99;expect(second.position.x).toBe(2);first.traverse(node=>expect(node.userData.runtimeAssetOwned).toBe(true));
 assets.releaseInstance(first);assets.releaseInstance(second);assets.dispose();
});

it('releases instance bone textures separately and shared GPU resources exactly once',async()=>{
 const model=fixture(true),mesh=model.scene.children[0] as SkinnedMesh,material=mesh.material as MeshStandardMaterial;
 const geometryDispose=vi.spyOn(mesh.geometry,'dispose'),materialDispose=vi.spyOn(material,'dispose'),textureDispose=vi.spyOn(material.map!,'dispose');
 const assets=new RuntimeAssets(async()=>model);await assets.load('person','/person.glb');await assets.load('alias','/person-alias.glb');
 const first=assets.instantiate('person'),second=assets.instantiate('person');
 const a=first.children[0] as SkinnedMesh,b=second.children[0] as SkinnedMesh;a.skeleton.computeBoneTexture();b.skeleton.computeBoneTexture();
 const firstBoneDispose=vi.spyOn(a.skeleton.boneTexture!,'dispose'),secondBoneDispose=vi.spyOn(b.skeleton.boneTexture!,'dispose');
 assets.releaseInstance(first);assets.releaseInstance(first);expect(firstBoneDispose).toHaveBeenCalledOnce();expect(geometryDispose).not.toHaveBeenCalled();expect(textureDispose).not.toHaveBeenCalled();
 assets.dispose();assets.dispose();expect(secondBoneDispose).toHaveBeenCalledOnce();expect(geometryDispose).toHaveBeenCalledOnce();expect(materialDispose).toHaveBeenCalledOnce();expect(textureDispose).toHaveBeenCalledOnce();
 expect(()=>assets.instantiate('person')).toThrow(/disposed/);
});

it('disposes a late loaded model after shutdown and does not resurrect the cache',async()=>{
 const pending=deferred<GLTF>(),assets=new RuntimeAssets(()=>pending.promise),model=fixture(),mesh=model.scene.children[0] as Mesh;
 const geometryDispose=vi.spyOn(mesh.geometry,'dispose'),request=assets.load('late','/late.glb');
 const rejected=expect(request).rejects.toThrow(/disposed/);await Promise.resolve();assets.dispose();pending.resolve(model);await rejected;
 expect(geometryDispose).toHaveBeenCalledOnce();await expect(assets.load('late','/late.glb')).rejects.toThrow(/disposed/);
 expect(()=>assets.instantiate('late')).toThrow(/disposed/);
});

it('rejects unavailable instances and conflicting preload descriptors before starting downloads',async()=>{
 const loader=vi.fn(async()=>fixture()),assets=new RuntimeAssets(loader);
 expect(()=>assets.instantiate('missing')).toThrow(/not loaded/);
 await expect(assets.preload([{id:'a',url:'/v1'},{id:'a',url:'/v2'}])).rejects.toThrow(/URL/);
 expect(loader).not.toHaveBeenCalled();assets.dispose();
});

it('does not start a scheduled download if the library was already disposed',async()=>{
 const loader=vi.fn(async()=>fixture()),assets=new RuntimeAssets(loader),request=assets.load('early','/early.glb');
 const rejected=expect(request).rejects.toThrow(/disposed/);assets.dispose();await rejected;expect(loader).not.toHaveBeenCalled();
});

it('releases line/point primitives and cloned instancing buffers without dropping shared geometry early',async()=>{
 const model=fixture(),geometry=new BoxGeometry(),lineMaterial=new LineBasicMaterial(),pointsMaterial=new PointsMaterial(),instanceMaterial=new MeshStandardMaterial();
 const instanced=new InstancedMesh(geometry,instanceMaterial,2);model.scene.add(new LineSegments(geometry,lineMaterial),new Points(geometry,pointsMaterial),instanced);
 const geometryDispose=vi.spyOn(geometry,'dispose'),lineDispose=vi.spyOn(lineMaterial,'dispose'),pointsDispose=vi.spyOn(pointsMaterial,'dispose'),sourceInstanceDispose=vi.spyOn(instanced,'dispose');
 const assets=new RuntimeAssets(async()=>model);await assets.load('mixed','/mixed.glb');const root=assets.instantiate('mixed'),copy=root.children.find(node=>node instanceof InstancedMesh) as InstancedMesh;
 const instanceDispose=vi.spyOn(copy,'dispose');assets.releaseInstance(root);expect(instanceDispose).toHaveBeenCalledOnce();expect(geometryDispose).not.toHaveBeenCalled();
 assets.dispose();expect(geometryDispose).toHaveBeenCalledOnce();expect(lineDispose).toHaveBeenCalledOnce();expect(pointsDispose).toHaveBeenCalledOnce();expect(sourceInstanceDispose).toHaveBeenCalledOnce();
});
