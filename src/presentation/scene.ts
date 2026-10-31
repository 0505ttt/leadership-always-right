import * as THREE from 'three';
import type { GameState, Page, Settings, StaticDecorationCollider, WorldDef } from '../contracts/game';
import { makeTechnicalCharacter, makeTechnicalChair } from './technical-character';
import type { CharacterLibrary, CharacterPoseInput, CharacterVisual as FormalCharacterVisual, PotPose } from './characters';
import { inside,makeWorldQuery } from '../world/query';
import { localPlayerOccluded, resolveCamera } from '../gameplay/camera';
import type { RuntimeAssets } from '../gameplay/assets';
import { createCharacterUpdater } from '../gameplay/character-updates';
import { hasAncestorFlag, physicalBounds } from '../gameplay/physical-bounds';
import { createOfficeEnvironment, type OfficeEnvironment } from './environment';
import { createOfficePropVisuals, type OfficePropVisuals } from './props';
import { createRoomDecorations, type RoomDecorations } from './room-decorations';
import { createCharacterMotion, type CharacterMotion, type CharacterMotionInput, type LeaderMotionMode } from './character-motion';

interface SceneCharacter {
 root:THREE.Group;hand:THREE.Object3D;back:THREE.Object3D;crown:THREE.Object3D;
 assetId:string;formal?:FormalCharacterVisual;motion?:CharacterMotion;
 update(input:CharacterMotionInput):void;dispose?():void;
}

export class OfficeScene {
 readonly renderer:THREE.WebGLRenderer;
 readonly scene=new THREE.Scene();
 readonly camera=new THREE.PerspectiveCamera(65,1,.06,110);
 readonly canvas:HTMLCanvasElement;
 private world:WorldDef|null=null;
 private query:ReturnType<typeof makeWorldQuery>|null=null;
 private group=new THREE.Group();
 private characters=new Map<string,SceneCharacter>();
 private characterLibrary:CharacterLibrary|null=null;
 private environment:OfficeEnvironment|null=null;
 private propVisuals:OfficePropVisuals|null=null;
 private roomDecorations:RoomDecorations|null=null;
 private runtimeAssets:RuntimeAssets|null=null;
 private runtimeAssetIds=new Set<string>();
 private runtimeInstances=new Set<THREE.Object3D>();
 private boxGeometry=new THREE.BoxGeometry(1,1,1);
 private resources=new Set<THREE.Texture|THREE.Material|THREE.BufferGeometry>();
 private settings:Settings;
 private target=new THREE.Vector3();
 private look=new THREE.Vector3();
 private currentTarget=new THREE.Vector3();
 private playerOccluded=false;
 private cameraRay=new THREE.Raycaster();
 private cameraSolids:THREE.Mesh[]=[];
 private warmed=false;
 private compiling=0;
 private retiredResources:(()=>void)[]=[];
 private disposed=false;
 private resizeObserver:ResizeObserver;
 private pointerRing:THREE.Mesh;
 private aimLine:THREE.Line;
 constructor(host:HTMLElement,settings:Settings){
  this.settings=settings;
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;
  this.renderer.shadowMap.enabled=false;
  this.canvas=this.renderer.domElement;this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','办公室3D游戏画面');host.appendChild(this.canvas);
  this.scene.background=new THREE.Color(0x637b78);this.scene.fog=new THREE.Fog(0x6e817a,28,70);
  this.scene.add(this.group);
  this.pointerRing=new THREE.Mesh(new THREE.RingGeometry(.38,.42,32),new THREE.MeshBasicMaterial({color:0xe4b35c,transparent:true,opacity:.8,side:THREE.DoubleSide}));this.pointerRing.rotation.x=-Math.PI/2;this.pointerRing.position.y=.015;this.scene.add(this.pointerRing);
  const ag=new THREE.BufferGeometry().setFromPoints(Array.from({length:25},()=>new THREE.Vector3()));this.aimLine=new THREE.Line(ag,new THREE.LineBasicMaterial({color:0xffdd8c,transparent:true,opacity:.85}));this.scene.add(this.aimLine);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
 }
 useRuntimeAssets(assets:RuntimeAssets,ids:readonly string[]=[]){this.runtimeAssets=assets;this.runtimeAssetIds=new Set(ids);}
 useCharacterLibrary(library:CharacterLibrary){this.characterLibrary=library;}
 private runtimeAsset(id:string,fallback:()=>THREE.Object3D){
  if(!this.runtimeAssets)return fallback();
  const instance=this.runtimeAssets.instantiate(id);this.runtimeInstances.add(instance);return instance;
 }
 private character(boss=false,tint?:number,badge?:string):SceneCharacter{
  if(this.characterLibrary){
   const visual=boss?this.characterLibrary.createLeader():badge?this.characterLibrary.createColleague(badge):this.characterLibrary.createEmployee();
   const motion=createCharacterMotion(visual);
   let elevated=false,transitionUntil=-Infinity;
   const update=createCharacterUpdater<CharacterMotionInput>({root:visual.root,update:input=>{
    const next=input.pose==='working'&&input.workStance==='chair-standing';
    // A cached normal pose has no ticking motion clock. Begin a fresh mounting
    // transition instead of advancing the skipped seconds in one step.
    if(next&&!elevated&&input.time>=transitionUntil)motion.reset();
    if(!next&&elevated)transitionUntil=input.time+.6;
    motion.update(input);elevated=next;
    // Once movement is released, the chair belongs to the fixed workstation.
    // The dismounting body can blend freely without carrying a second chair.
    if(input.pose!=='working'&&input.pose!=='rolling')visual.chair.visible=false;
   }},input=>input.workStance==='chair-standing'||input.time<transitionUntil);
   return {root:visual.root,hand:visual.anchors.hand,back:visual.anchors.back,crown:visual.anchors.crown,assetId:visual.assetId,formal:visual,motion,update,dispose:()=>visual.dispose()};
  }
  const visual=makeTechnicalCharacter(boss,tint);
  if(this.runtimeAssets){
   // These placeholder chair meshes have never been uploaded; keep the control/visibility root.
   visual.chair.clear();visual.chair.add(this.runtimeAsset('chair-v1',makeTechnicalChair));
  }
  return {root:visual.root,hand:visual.hand,back:visual.back,crown:visual.crown,assetId:'technical-placeholder',update:input=>visual.update(input.pose,input.moving,input.sprint,input.time,input.holding)};
 }
 load(world:WorldDef){
  if(this.disposed)return;
  this.clear();this.world=world;this.query=makeWorldQuery(world);
  const models=(id:string)=>{
   if(!this.runtimeAssets||!this.runtimeAssetIds.has(id))return undefined;
   const instance=this.runtimeAssets.instantiate(id);this.runtimeInstances.add(instance);return instance;
  };
  this.environment=createOfficeEnvironment(world,{models,dressing:false});
  this.group.add(this.environment.root);
  this.environment.root.traverse(object=>{if(object instanceof THREE.Mesh){const materials=Array.isArray(object.material)?object.material:[object.material];if(materials.some(material=>material instanceof THREE.MeshStandardMaterial))this.cameraSolids.push(object);}});
  const assets=this.runtimeAssets;
  this.propVisuals=createOfficePropVisuals(world,assets?{models,assets:{
   instantiate:id=>assets.instantiate(id),
   release:(_id,instance)=>assets.releaseInstance(instance),
  }}:{});
  this.group.add(this.propVisuals.root);
  // Room dressing owns its layouts and clones static model templates. Reuse one
  // cache instance per ID and keep its shared resources owned by RuntimeAssets.
  const decorationModels=new Map<string,THREE.Object3D>();
  this.roomDecorations=createRoomDecorations(world,{reservedColliders:this.getDecorationColliders(),models:id=>{
   if(!decorationModels.has(id)){const template=models(id);if(template)decorationModels.set(id,template);}
   return decorationModels.get(id);
  }});
  this.group.add(this.roomDecorations.root);
  this.roomDecorations.root.traverse(object=>{if(object instanceof THREE.Mesh&&!hasAncestorFlag(object,'visualOnly',this.roomDecorations!.root))this.cameraSolids.push(object);});
  for(const [id,prop] of this.propVisuals.props)prop.userData.propId=id;
  for(const desk of world.desks){
   const chair=this.propVisuals.root.getObjectByName(`desk-chair:${desk.id}`);
   if(chair)chair.userData.deskId=desk.id;
  }
  const player=this.character(false);player.root.userData.actorId='player';this.group.add(player.root);this.characters.set('player',player);
  const boss=this.character(true);boss.root.userData.actorId='boss';if(!boss.formal)boss.root.scale.setScalar(1.04);this.group.add(boss.root);this.characters.set('boss',boss);
  for(const [i,c] of world.colleagues.entries()){const v=this.character(false,[0xc8d3be,0xa8bdad,0xc8b6a2,0xb7c7c8][i],c.name);v.root.userData.actorId=c.id;v.root.position.set(c.x,0,c.z);v.root.rotation.y=c.yaw;this.group.add(v.root);this.characters.set(c.id,v);}
  this.currentTarget.set(world.spawn.x,1.25,world.spawn.z);this.warmed=false;
 }
 updateSettings(settings:Settings){this.settings=settings;this.resize();}
 resize(){const w=window.innerWidth,h=window.innerHeight;const maxPixels=this.settings.quality==='low'?1280*720:this.settings.quality==='medium'?1920*1080:2560*1440;const ratio=Math.min(window.devicePixelRatio,Math.sqrt(maxPixels/(w*h)));this.renderer.setPixelRatio(ratio);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 async prepare(onStage?:(stage:'textures'|'shaders')=>void){
  if(this.disposed)return;
  const group=this.group;
  if(!this.warmed){
   onStage?.('textures');const textures=new Set<THREE.Texture>();
   group.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Line||object instanceof THREE.Sprite){for(const material of Array.isArray(object.material)?object.material:[object.material])for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);}});
   for(const texture of textures)this.renderer.initTexture(texture);
   onStage?.('shaders');await this.compile(this.scene);if(this.disposed||group!==this.group)return;
   // Compile the alternate shader without changing live walls while the frame loop is running.
   const wall=this.environment?.walls.values().next().value;
   if(wall){
    const material=(wall.material as THREE.MeshStandardMaterial).clone();material.transparent=true;material.opacity=.2;material.depthWrite=false;this.resources.add(material);
    const probe=new THREE.Mesh(this.boxGeometry,material);
    await this.compile(probe,this.scene);if(this.disposed||group!==this.group)return;
   }
   this.warmed=true;
  }
  this.renderer.render(this.scene,this.camera);
 }
 private async compile(object:THREE.Object3D,targetScene?:THREE.Scene){
  this.compiling++;
  try{await this.renderer.compileAsync(object,this.camera,targetScene);}
  finally{
   this.compiling--;
   if(this.compiling===0)for(const release of this.retiredResources.splice(0))release();
  }
 }
 private releaseWhenIdle(release:()=>void){if(this.compiling>0)this.retiredResources.push(release);else release();}
 render(state:GameState,yaw:number,pitch:number,page:Page,dt:number){
  if(!this.world||this.world.seed!==state.seed)return;const world=this.world,time=state.elapsed;
  this.environment?.update(state);
  this.roomDecorations?.update(state);
  const potPose=(id:string,pose:CharacterPoseInput['pose']):PotPose=>{
   const pot=state.pots.find(item=>item.owner===id);if(!pot||pot.phase==='flying'||pot.phase==='returning')return 'none';
   if(pot.phase==='held'||pot.phase==='drawing')return 'hand';
   return pose==='working'||pose==='rolling'?'crown':'back';
  };
  const player=this.characters.get('player')!;player.root.position.set(state.player.x,state.player.y,state.player.z);player.root.rotation.y=state.player.yaw;
  const deskInput=(id:string|undefined|null,actor:{x:number;z:number;yaw:number})=>{
   const desk=world.desks.find(item=>item.id===id);if(!desk)return {};
   return {deskHeight:state.deskHeights[desk.id]??.75,deskFrontZ:(desk.x-actor.x)*Math.sin(actor.yaw)+(desk.z-actor.z)*Math.cos(actor.yaw)-.425};
  };
  const playerPose=state.player.pose;
  player.update({pose:playerPose,workStance:state.player.workStance,...deskInput(state.player.workstationId,state.player),clearance:this.query?.clearance(state.player,state),moving:state.player.moving,sprint:state.player.sprinting,time,holding:state.player.potInHand||!!state.player.holding,pot:potPose('player',state.player.workStance==='chair-standing'?'standing':playerPose)});
  const boss=this.characters.get('boss')!,bossMoving=Math.hypot(boss.root.position.x-state.boss.x,boss.root.position.z-state.boss.z)>.0001;
  boss.root.position.set(state.boss.x,0,state.boss.z);boss.root.rotation.y=state.boss.yaw;const bossRoom=world.rooms.find(r=>inside(state.boss,r))?.id??-1;const bossCeiling=state.pressureRooms.includes(bossRoom)?(state.pressureHeights[bossRoom]??1.6):2.8,bossPose=Math.min(bossCeiling,this.query?.clearance(state.boss,state)??Infinity)<1.85?'crouching':'standing';
  const bossSpeed=dt>0?Math.hypot(state.boss.x-(boss.root.userData.previousX??state.boss.x),state.boss.z-(boss.root.userData.previousZ??state.boss.z))/dt:0;
  boss.root.userData.previousX=state.boss.x;boss.root.userData.previousZ=state.boss.z;
  const leaderMode:LeaderMotionMode=state.boss.mode==='search'?'search':state.boss.mode==='chase'?'chase':state.boss.mode==='alert'?'alert':!bossMoving&&(state.boss.mode==='inspection'||state.boss.mode==='warning')?'inspect':'patrol';
  boss.update({pose:bossPose,leaderMode,speed:bossSpeed,lookYawOffset:Math.atan2(Math.sin((state.boss.lookYaw??state.boss.yaw)-state.boss.yaw),Math.cos((state.boss.lookYaw??state.boss.yaw)-state.boss.yaw)),moving:bossMoving,sprint:state.boss.mode==='chase',time,holding:false,pot:potPose('boss',bossPose),gesturing:state.boss.mode==='warning'&&!bossMoving});
  for(const c of state.colleagues){const v=this.characters.get(c.id)!;v.root.position.set(c.x,c.y??0,c.z);v.update({pose:'working',workStance:c.workStance,...deskInput(c.deskId,c),clearance:this.query?.clearance(c,state),moving:false,sprint:false,time:time+c.x,holding:false,pot:potPose(c.id,c.workStance==='chair-standing'?'standing':'working'),gesturing:c.reportAt!==null});}
  this.pointerRing.visible=state.interaction!==null&&page==='playing';if(state.interaction){const id=state.interaction.id;const obj=[...world.stations,...world.exits,...world.desks,...state.props].find(p=>p.id===id);if(obj)this.pointerRing.position.set(obj.x,.018,obj.z);else this.pointerRing.visible=false;}
  this.aimLine.visible=state.aiming&&!!state.player.holding||state.aiming&&state.player.potInHand;
  if(this.aimLine.visible){const a=this.aimLine.geometry.attributes.position;for(let i=0;i<a.count;i++){const t=i/(a.count-1);a.setXYZ(i,state.player.x+Math.sin(yaw)*6*t,state.player.y+1.1+Math.sin(t*Math.PI)*.65,state.player.z+Math.cos(yaw)*6*t);}a.needsUpdate=true;}
  const home=world.desks[0];
  if(page==='home'||page==='tutorial'||(page==='settings'&&state.elapsed===0)){
   this.playerOccluded=false;
   this.camera.position.set(world.spawn.x+3.8,2.05,world.spawn.z-3.9);this.camera.lookAt(home.x,1.1,home.z);this.pointerRing.visible=false;this.aimLine.visible=false;
  }else{
   const seated=(state.player.pose==='working'&&state.player.workStance!=='chair-standing')||state.player.sticky,head=state.player.pose==='crouching'?.72:seated?1:1.38;
   this.target.set(state.player.x,state.player.y+head,state.player.z);this.currentTarget.lerp(this.target,1-Math.exp(-dt*30));
   const dist=state.player.pose==='dragged'?4.1:state.aiming?2.35:3.5;const forward=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
   this.look.copy(this.currentTarget).addScaledVector(forward,3);const desired=this.currentTarget.clone().addScaledVector(forward,-dist).add(new THREE.Vector3(Math.cos(yaw)*.35,.35,-Math.sin(yaw)*.35));
   const position=resolveCamera(world,state,this.currentTarget,desired);
   // Formal door headers and furniture trim also occupy the camera's line, even above walkable space.
   this.environment?.root.updateWorldMatrix(true,true);
   const cameraDelta=new THREE.Vector3(position.x,position.y,position.z).sub(this.currentTarget),cameraDistance=cameraDelta.length();
   if(cameraDistance>0){
    this.cameraRay.set(this.currentTarget,cameraDelta.normalize());this.cameraRay.far=cameraDistance;
    const hit=this.cameraRay.intersectObjects(this.cameraSolids,false).find(item=>{
     for(let object:THREE.Object3D|null=item.object;object;object=object.parent)if(!object.visible)return false;
     const material=Array.isArray((item.object as THREE.Mesh).material)?((item.object as THREE.Mesh).material as THREE.Material[])[item.face?.materialIndex??0]:(item.object as THREE.Mesh).material as THREE.Material;
     return !material.transparent&&material.opacity>=.95;
    });
    if(hit){const safe=this.currentTarget.clone().addScaledVector(cameraDelta,Math.max(0,hit.distance-.14));Object.assign(position,resolveCamera(world,state,this.currentTarget,safe));}
   }
   this.camera.position.set(position.x,position.y,position.z);this.camera.lookAt(this.look);
   this.playerOccluded=localPlayerOccluded(position,this.currentTarget,this.playerOccluded);
  }
  // Camera visibility changes no ownership, hitbox, lighting or gameplay state.
  player.root.visible=!this.playerOccluded;
  this.propVisuals?.update(state,(actorId,anchor)=>this.characters.get(actorId)?.[anchor],this.playerOccluded);
  if(this.propVisuals){
   const standingDesks=[...state.colleagues.filter(c=>c.workStance==='chair-standing').map(c=>c.deskId),...(state.player.workStance==='chair-standing'&&state.player.workstationId?[state.player.workstationId]:[])];
   for(const id of standingDesks){const chair=this.propVisuals.root.getObjectByName(`desk-chair:${id}`);if(chair)chair.visible=!this.characterLibrary;}
  }
  if(this.propVisuals)for(const [id,pot] of this.propVisuals.pots)pot.userData.potId=id;
  this.renderer.render(this.scene,this.camera);
 }
 getRuleVisuals(){return {
  characters:[...this.characters].map(([id,visual])=>({id,assetId:visual.assetId,visible:visual.root.visible})),
  modelInstances:this.getModelInstances(),
  camera:{position:{x:this.camera.position.x,y:this.camera.position.y,z:this.camera.position.z},focus:{x:this.currentTarget.x,y:this.currentTarget.y,z:this.currentTarget.z},playerVisible:this.characters.get('player')?.root.visible??false},
  ...(this.environment?.getDiagnostics()??{ceilings:[],desks:[],partitions:[],flows:[],decorationColliders:[]}),
  roomDecorations:this.roomDecorations?.getDiagnostics(),
  decorationColliders:this.getDecorationColliders(),
 };}
 private getModelInstances(){const counts=new Map<string,number>();this.group.traverse(object=>{const id=object.userData.runtimeAssetId as string|undefined;if(id)counts.set(id,(counts.get(id)??0)+1);});return [...counts].map(([assetId,count])=>({assetId,count}));}
 getCharacterDiagnostics(state:GameState){return structuredClone([...this.characters].map(([id,visual])=>{
  const pot=state.pots.find(item=>item.owner===id&&item.phase!=='flying'&&item.phase!=='returning');
  return {id,assetId:visual.assetId,...visual.formal?.getDiagnostics(),motion:visual.motion?.getDiagnostics(),composition:visual.formal?.measure(pot?this.propVisuals?.pots.get(pot.id):undefined)};
 }));}
 getDecorationColliders():StaticDecorationCollider[]{
  const environment=this.environment;if(!environment)return [];
  environment.root.updateWorldMatrix(true,true);
  const colliders=environment.decorationColliders.map(candidate=>{
   const object=environment.root.getObjectByName(candidate.id);
   if(object){
    const bounds=new THREE.Box3().setFromObject(object);
    if(!bounds.isEmpty())return {id:candidate.id,roomId:candidate.roomId,x:(bounds.min.x+bounds.max.x)/2,z:(bounds.min.z+bounds.max.z)/2,w:bounds.max.x-bounds.min.x,d:bounds.max.z-bounds.min.z,height:bounds.max.y};
   }
   const cos=Math.abs(Math.cos(candidate.yaw)),sin=Math.abs(Math.sin(candidate.yaw));
   return {id:candidate.id,roomId:candidate.roomId,x:candidate.x,z:candidate.z,w:candidate.w*cos+candidate.d*sin,d:candidate.w*sin+candidate.d*cos,height:candidate.height};
  });
  this.propVisuals?.root.updateWorldMatrix(true,true);
  this.roomDecorations?.root.updateWorldMatrix(true,true);
  for(const candidate of this.roomDecorations?.decorationColliders??[]){
   const object=this.roomDecorations?.root.getObjectByName(candidate.id);
   const bounds=object?physicalBounds(object):null;
   colliders.push(bounds&&!bounds.isEmpty()?{id:candidate.id,roomId:candidate.roomId,x:(bounds.min.x+bounds.max.x)/2,z:(bounds.min.z+bounds.max.z)/2,w:bounds.max.x-bounds.min.x,d:bounds.max.z-bounds.min.z,height:bounds.max.y}:{...candidate});
  }
  for(const station of this.world?.stations??[]){
   const object=this.propVisuals?.root.getObjectByName(`clock-station:${station.id}`)?.children.find(child=>child.userData.runtimeAssetId==='clock-station-v1');
   if(!object)continue;
   const bounds=new THREE.Box3().setFromObject(object);
   if(!bounds.isEmpty())colliders.push({id:`station-body:${station.id}`,roomId:station.roomId,x:(bounds.min.x+bounds.max.x)/2,z:(bounds.min.z+bounds.max.z)/2,w:bounds.max.x-bounds.min.x,d:bounds.max.z-bounds.min.z,height:bounds.max.y});
  }
  return colliders;
 }
 getMetrics(){const gl=this.renderer.getContext();const ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),drawingBuffer:{width:gl.drawingBufferWidth,height:gl.drawingBufferHeight},css:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,pixelRatio:this.renderer.getPixelRatio(),drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,programs:this.renderer.info.programs?.length??0,memory:{...this.renderer.info.memory}};}
 clear(){
  const group=this.group,resources=this.resources,instances=this.runtimeInstances,assets=this.runtimeAssets;
  const environment=this.environment,propVisuals=this.propVisuals,roomDecorations=this.roomDecorations,characters=[...this.characters.values()];
  this.environment=null;this.propVisuals=null;this.roomDecorations=null;this.cameraSolids=[];
  this.scene.remove(group);this.resources=new Set();this.runtimeInstances=new Set();
  // Three polls material programs until compileAsync settles; detaching is safe, disposal is not.
  this.releaseWhenIdle(()=>{
   // Module resource pools own their geometry/materials; detach before the legacy actor sweep.
   for(const character of characters)character.dispose?.();
   environment?.dispose();propVisuals?.dispose();roomDecorations?.dispose();
   group.traverse(o=>{if(!o.userData.runtimeAssetOwned&&(o instanceof THREE.Mesh||o instanceof THREE.Line||o instanceof THREE.Sprite)){
    if(!(o instanceof THREE.Sprite)&&o.geometry!==this.boxGeometry)resources.add(o.geometry);
    for(const m of Array.isArray(o.material)?o.material:[o.material])resources.add(m);
   }});
   for(const instance of instances)assets?.releaseInstance(instance);instances.clear();
   for(const resource of resources)resource.dispose();resources.clear();
  });
  this.group=new THREE.Group();this.scene.add(this.group);this.world=null;this.warmed=false;this.playerOccluded=false;
  this.characters.clear();
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;this.clear();this.resizeObserver.disconnect();this.canvas.remove();
  this.releaseWhenIdle(()=>this.characterLibrary?.dispose());
  this.releaseWhenIdle(()=>this.renderer.dispose());
 }
}
