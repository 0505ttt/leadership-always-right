import { InstancedMesh, Line, Material, Mesh, Object3D, Points, SkinnedMesh, Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface RuntimeAssetSpec {readonly id:string;readonly url:string}
export interface RuntimeAssetProgress {completed:number;total:number;id?:string}
export type RuntimeAssetLoader=(url:string)=>Promise<GLTF>;
interface Entry {url:string;promise:Promise<GLTF>;asset?:GLTF}

/** Owns downloaded GPU resources across rounds. Instances own only their cloned skeletons. */
export class RuntimeAssets {
 private entries=new Map<string,Entry>();
 private instances=new Set<Object3D>();
 private disposedResources=new WeakSet<object>();
 private disposed=false;
 constructor(private readonly loader:RuntimeAssetLoader=(url)=>new GLTFLoader().loadAsync(url)){}

 load(id:string,url:string):Promise<GLTF>{
  if(this.disposed)return Promise.reject(new Error('Runtime assets are disposed'));
  const cached=this.entries.get(id);
  if(cached)return cached.url===url?cached.promise:Promise.reject(new Error(`Asset ${id} already uses a different URL`));
  let entry:Entry;
  const promise=Promise.resolve().then(()=>{if(this.disposed)throw new Error('Runtime assets are disposed');return this.loader(url);}).then(asset=>{
   if(this.disposed){this.disposeAsset(asset);throw new Error('Runtime assets are disposed');}
   entry.asset=asset;return asset;
  }).catch((error:unknown)=>{if(this.entries.get(id)===entry)this.entries.delete(id);throw error;});
  entry={url,promise};this.entries.set(id,entry);return promise;
 }

 async preload(specs:readonly RuntimeAssetSpec[],onProgress?:(progress:RuntimeAssetProgress)=>void):Promise<void>{
  const unique=new Map<string,RuntimeAssetSpec>();
  for(const spec of specs){const previous=unique.get(spec.id);if(previous&&previous.url!==spec.url)throw new Error(`Asset ${spec.id} has conflicting URLs`);unique.set(spec.id,spec);}
  let completed=0;const total=unique.size;onProgress?.({completed,total});
  await Promise.all([...unique.values()].map(async spec=>{await this.load(spec.id,spec.url);onProgress?.({completed:++completed,total,id:spec.id});}));
 }

 instantiate(id:string):Object3D{
  if(this.disposed)throw new Error('Runtime assets are disposed');
  const asset=this.entries.get(id)?.asset;if(!asset)throw new Error(`Asset ${id} is not loaded`);
  const root=clone(asset.scene);root.animations=asset.animations.map(clip=>clip.clone());
  root.traverse(node=>{node.userData.runtimeAssetOwned=true;});root.userData.runtimeAssetId=id;
  this.instances.add(root);return root;
 }

 /** Detach the root in the scene owner. Shared geometry/materials/textures must remain alive. */
 releaseInstance(root:Object3D):void{
  if(!this.instances.delete(root))return;
  root.traverse(node=>{if(node instanceof SkinnedMesh)this.disposeOnce(node.skeleton);if(node instanceof InstancedMesh)this.disposeOnce(node);});
 }

 dispose():void{
  if(this.disposed)return;this.disposed=true;
  for(const root of this.instances)this.releaseInstance(root);
  for(const entry of this.entries.values())if(entry.asset)this.disposeAsset(entry.asset);
  this.entries.clear();
 }

 private disposeOnce(resource:{dispose:()=>void}):void{
  if(this.disposedResources.has(resource))return;this.disposedResources.add(resource);resource.dispose();
 }
 private disposeTexture(value:unknown):void{
  if(Array.isArray(value)){for(const item of value)this.disposeTexture(item);return;}
  if(!(value instanceof Texture)||this.disposedResources.has(value))return;
  this.disposeOnce(value);
  const images=Array.isArray(value.source.data)?value.source.data:[value.source.data];
  for(const image of images)if(typeof ImageBitmap!=='undefined'&&image instanceof ImageBitmap&&!this.disposedResources.has(image)){this.disposedResources.add(image);image.close();}
 }
 private disposeMaterial(material:Material):void{
  for(const value of Object.values(material))this.disposeTexture(value);
  if('uniforms' in material)for(const uniform of Object.values(material.uniforms as Record<string,{value:unknown}>))this.disposeTexture(uniform.value);
  this.disposeOnce(material);
 }
 private disposeAsset(asset:GLTF):void{
  for(const scene of new Set([asset.scene,...asset.scenes]))scene.traverse(node=>{
   if(node instanceof Mesh||node instanceof Line||node instanceof Points){this.disposeOnce(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])this.disposeMaterial(material);}
   if(node instanceof SkinnedMesh)this.disposeOnce(node.skeleton);
   if(node instanceof InstancedMesh)this.disposeOnce(node);
  });
 }
}
