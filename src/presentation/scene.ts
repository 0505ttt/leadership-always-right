import * as THREE from 'three';
import type { GameState, Page, Settings, Vec2, WorldDef } from '../contracts/game';
import { makeTechnicalCharacter, makeTechnicalChair, makeTechnicalPot, type CharacterVisual } from './technical-character';
import { inside } from '../world/query';
import { resolveCamera } from '../gameplay/camera';
import type { RuntimeAssets } from '../gameplay/assets';

export class OfficeScene {
 readonly renderer:THREE.WebGLRenderer;
 readonly scene=new THREE.Scene();
 readonly camera=new THREE.PerspectiveCamera(65,1,.06,110);
 readonly canvas:HTMLCanvasElement;
 private world:WorldDef|null=null;
 private group=new THREE.Group();
 private characters=new Map<string,CharacterVisual>();
 private desks=new Map<string,THREE.Group>();
 private pots=new Map<string,THREE.Object3D>();
 private runtimeAssets:RuntimeAssets|null=null;
 private runtimeInstances=new Set<THREE.Object3D>();
 private props=new Map<string,THREE.Object3D>();
 private exits=new Map<string,THREE.Group>();
 private wallMeshes=new Map<string,THREE.Mesh>();
 private ceilings=new Map<number,THREE.Mesh>();
 private roomMaterials=new Map<number,THREE.MeshStandardMaterial[]>();
 private lamps=new Map<number,THREE.PointLight>();
 private flows=new Map<number,THREE.Group>();
 private switches=new Map<number,THREE.Mesh>();
 private labels:{object:THREE.Object3D;point:Vec2;range:number}[]=[];
 private boxGeometry=new THREE.BoxGeometry(1,1,1);
 private resources=new Set<THREE.Texture|THREE.Material|THREE.BufferGeometry>();
 private roomId=0;
 private settings:Settings;
 private target=new THREE.Vector3();
 private look=new THREE.Vector3();
 private currentTarget=new THREE.Vector3();
 private warmed=false;
 private compiling=0;
 private retiredResources:(()=>void)[]=[];
 private disposed=false;
 private resizeObserver:ResizeObserver;
 private screen:THREE.Mesh|null=null;
 private clockText:THREE.Sprite|null=null;
 private lastClock='';
 private pointerRing:THREE.Mesh;
 private aimLine:THREE.Line;
 constructor(host:HTMLElement,settings:Settings){
  this.settings=settings;
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;
  this.renderer.shadowMap.enabled=false;
  this.canvas=this.renderer.domElement;this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','办公室3D游戏画面');host.appendChild(this.canvas);
  this.scene.background=new THREE.Color(0x637b78);this.scene.fog=new THREE.Fog(0x6e817a,28,70);
  this.scene.add(new THREE.HemisphereLight(0xc9e0dc,0x5c6253,1.5));
  const sun=new THREE.DirectionalLight(0xffe1ad,2.2);sun.position.set(-14,30,7);this.scene.add(sun);
  this.scene.add(this.group);
  this.pointerRing=new THREE.Mesh(new THREE.RingGeometry(.38,.42,32),new THREE.MeshBasicMaterial({color:0xe4b35c,transparent:true,opacity:.8,side:THREE.DoubleSide}));this.pointerRing.rotation.x=-Math.PI/2;this.pointerRing.position.y=.015;this.scene.add(this.pointerRing);
  const ag=new THREE.BufferGeometry().setFromPoints(Array.from({length:25},()=>new THREE.Vector3()));this.aimLine=new THREE.Line(ag,new THREE.LineBasicMaterial({color:0xffdd8c,transparent:true,opacity:.85}));this.scene.add(this.aimLine);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
 }
 private material(color:THREE.ColorRepresentation,roughness=.85,metalness=0){const m=new THREE.MeshStandardMaterial({color,roughness,metalness});this.resources.add(m);return m;}
 private box(parent:THREE.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.Material){const mesh=new THREE.Mesh(this.boxGeometry,material);mesh.scale.set(w,h,d);mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
 private text(text:string,width=512,height=128,color='#e9e8d8',background='rgba(0,0,0,0)',size=42){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const c=canvas.getContext('2d')!;c.fillStyle=background;c.fillRect(0,0,width,height);c.fillStyle=color;c.font=`600 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(text,width/2,height/2,width-22);
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());this.resources.add(t);return t;
 }
 private sign(parent:THREE.Object3D,text:string,x:number,y:number,z:number,w:number,h:number,yaw=0,color='#eff0dc',background='#26453c'){
  const m=new THREE.MeshBasicMaterial({map:this.text(text,512,128,color,background,43),side:THREE.DoubleSide});this.resources.add(m);const geo=new THREE.PlaneGeometry(w,h);this.resources.add(geo);const sign=new THREE.Mesh(geo,m);sign.position.set(x,y,z);sign.rotation.y=yaw;parent.add(sign);return sign;
 }
 private sprite(text:string,x:number,y:number,z:number,w=1.5,color='#fff0cd'){
  const mat=new THREE.SpriteMaterial({map:this.text(text,512,128,color,'#213a32cc',44),depthTest:true});this.resources.add(mat);const sprite=new THREE.Sprite(mat);sprite.position.set(x,y,z);sprite.scale.set(w,w/4,1);this.group.add(sprite);return sprite;
 }
 private trackRoomMaterial(id:number,m:THREE.MeshStandardMaterial){const all=this.roomMaterials.get(id)??[];all.push(m);this.roomMaterials.set(id,all);m.userData.baseColor=m.color.clone();return m;}
 useRuntimeAssets(assets:RuntimeAssets){this.runtimeAssets=assets;}
 private runtimeAsset(id:string,fallback:()=>THREE.Object3D){
  if(!this.runtimeAssets)return fallback();
  const instance=this.runtimeAssets.instantiate(id);this.runtimeInstances.add(instance);return instance;
 }
 private character(boss=false,tint?:number){
  const visual=makeTechnicalCharacter(boss,tint);
  if(this.runtimeAssets){
   // These placeholder chair meshes have never been uploaded; keep the control/visibility root.
   visual.chair.clear();visual.chair.add(this.runtimeAsset('chair-v1',makeTechnicalChair));
  }
  return visual;
 }
 load(world:WorldDef){
  if(this.disposed)return;
  this.clear();this.world=world;
  const brass=this.material(0xb8a47a,.5,.35),metal=this.material(0x485b55,.5,.55),wood=this.material(0xb8a17c),dark=this.material(0x25453d),white=this.material(0xe1e3cf);
  for(const room of world.rooms){
   const floor=this.trackRoomMaterial(room.id,this.material(room.kind==='tea'?0xa6a18b:room.kind==='front'?0x9ca98d:0x788c7c));
   this.box(this.group,room.w,.1,room.d,room.x,-.07,room.z,floor);
   const carpet=this.trackRoomMaterial(room.id,this.material(0x4c665c));
   for(let x=-3;x<=3;x+=1.5)this.box(this.group,.012,.006,room.d-.25,room.x+x,.001,room.z,carpet);
   const wallMat=this.trackRoomMaterial(room.id,this.material(0xcdd6bf));
   for(const w of world.walls.filter(w=>w.roomId===room.id)){
    const mesh=this.box(this.group,w.w,w.crawl?w.height-.95:w.height,w.d,w.x,w.crawl?(w.height+.95)/2:w.height/2,w.z,this.trackRoomMaterial(room.id,wallMat.clone()));this.resources.add(mesh.material as THREE.Material);this.wallMeshes.set(w.id,mesh);
    if(!w.crawl){this.box(this.group,w.w+.015,.14,w.d+.015,w.x,.08,w.z,dark);this.box(this.group,w.w+.015,.04,w.d+.015,w.x,2.55,w.z,brass);}
   }
   const ceiling=this.box(this.group,room.w-.3,.1,room.d-.3,room.x,2.9,room.z,this.trackRoomMaterial(room.id,this.material(0xa7b3a1)));this.ceilings.set(room.id,ceiling);
   for(const z of [-5,4]){
    this.box(this.group,2.3,.07,.42,room.x,2.78,room.z+z,metal);
    const glow=new THREE.MeshBasicMaterial({color:0xf9f0ce});this.resources.add(glow);this.box(this.group,2.1,.025,.33,room.x,2.73,room.z+z,glow);
   }
   const light=new THREE.PointLight(0xffedc7,25,15,2);light.position.set(room.x,2.5,room.z);this.group.add(light);this.lamps.set(room.id,light);
   if(room.pressure){this.sign(this.group,'活动顶板 · 注意净高',room.x,2.52,room.z-room.d/2+.13,2.5,.35);}
   const sw=this.box(this.group,.13,.28,.16,room.switch.x,1.12,room.switch.z,white);sw.rotation.y=room.switch.yaw??0;const led=this.box(sw,.3,.16,1,0,0,.55,new THREE.MeshBasicMaterial({color:0x99efaf}));this.switches.set(room.id,led);
   const sl=this.sprite('E  灯',room.switch.x,1.65,room.switch.z,.8);this.labels.push({object:sl,point:room.switch,range:5});
   this.sign(this.group,room.name,room.x,2.2,room.z-room.d/2+.14,3.1,.48);
   const flow=new THREE.Group();for(let i=-3;i<=3;i+=1.4){const arrow=this.sign(flow,'↑',room.x,.025,room.z+i,1.1,1.1,0,'#f4d08a','#63583a');arrow.rotation.x=-Math.PI/2;}flow.visible=false;this.group.add(flow);this.flows.set(room.id,flow);
   // Solid but non-interactive decorative strips stay against room edges, never in playable clearance.
   this.box(this.group,.18,1.35,3,room.x-room.w/2+.15,.7,room.z-4,wood);
  }
  for(const door of world.doors){if(door.crawl){const label=this.sprite('检修通道 · 蹲下',door.x,1.14,door.z,1.7);this.labels.push({object:label,point:door,range:6});continue;}
   const horizontal=door.axis==='x';this.box(this.group,horizontal?door.width+.14:.28,.22,horizontal?.28:door.width+.14,door.x,2.48,door.z,dark);
   for(const side of [-1,1])this.box(this.group,.1,2.4,.1,door.x+(horizontal?side*(door.width/2+.05):0),1.2,door.z+(horizontal?0:side*(door.width/2+.05)),brass);
  }
  for(const desk of world.desks){
   for(const side of [-1,1])this.box(this.group,.07,.7,.65,desk.x+side*.69,.35,desk.z,metal);
   const top=new THREE.Group();top.position.set(desk.x,.75,desk.z);top.rotation.y=desk.yaw;this.group.add(top);this.desks.set(desk.id,top);
   this.box(top,1.6,.09,.85,0,0,0,wood);this.box(top,.1,.2,.1,0,.15,.1,metal);this.box(top,.72,.45,.065,0,.43,.16,dark);
   const screen=this.sign(top,desk.home?'18:00  /  豆包':'Q4 项目进度',0,.43,.12,.66,.37,Math.PI,'#bddec4','#162d27');if(desk.home)this.screen=screen;
   this.box(top,.48,.025,.18,0,.067,-.16,dark);this.box(top,.07,.025,.1,.36,.07,-.17,metal);
   this.box(top,.13,.18,.13,-.58,.14,.2,white);
   const chair=this.runtimeAsset('chair-v1',makeTechnicalChair);chair.position.set(desk.seat.x,0,desk.seat.z);chair.rotation.y=desk.yaw;this.group.add(chair);chair.userData.deskId=desk.id;
   if(desk.home){const ring=new THREE.Mesh(new THREE.RingGeometry(.89,.91,40),new THREE.MeshBasicMaterial({color:0x9ab394,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(desk.seat.x,.01,desk.seat.z);this.group.add(ring);const label=this.sprite('我的工位',desk.x,1.55,desk.z,1.2);this.labels.push({object:label,point:desk,range:7});}
  }
  const player=this.character(false);this.group.add(player.root);this.characters.set('player',player);
  const boss=this.character(true);boss.root.scale.setScalar(1.04);this.group.add(boss.root);this.characters.set('boss',boss);
  for(const [i,c] of world.colleagues.entries()){const v=this.character(false,[0xc8d3be,0xa8bdad,0xc8b6a2,0xb7c7c8][i]);v.root.position.set(c.x,0,c.z);v.root.rotation.y=c.yaw;this.group.add(v.root);this.characters.set(c.id,v);}
  for(const s of world.stations){
   const g=new THREE.Group();g.position.set(s.x,0,s.z);g.rotation.y=s.yaw;this.group.add(g);
   this.box(g,.48,1.22,.38,0,.61,0,dark);this.sign(g,'下班打卡',0,.98,-.2,.42,.15,Math.PI,'#d0efc8','#214c3c');this.sign(g,'18:00',0,.78,-.2,.37,.18,Math.PI,'#b9f7c2','#0a2019');this.box(g,.17,.09,.05,0,.5,-.23,brass);
   this.sign(g,'常亮应急操作区',0,.03,-1.1,2,.35,Math.PI,'#d9d8ae','#4f614d').rotation.x=-Math.PI/2;
   const label=this.sprite('打卡机',s.x,1.8,s.z,1.15);this.labels.push({object:label,point:s,range:9});
   const emergency=new THREE.PointLight(0xd1edc6,8,5,2);emergency.position.set(s.x,2,s.z);this.group.add(emergency);
  }
  for(const e of world.exits){
   const faceYaw=Math.atan2(-e.outward.x,-e.outward.z),door=new THREE.Group();door.position.set(e.x+e.outward.x*.65,0,e.z+e.outward.z*.65);door.rotation.y=faceYaw;this.group.add(door);this.exits.set(e.id,door);
   this.box(door,2.2,2.3,.14,0,1.15,0,dark);this.box(door,1.65,.035,.08,0,1,.12,brass);this.sign(door,'安全出口',0,1.9,.085,1.65,.3,0,'#e8efda','#436b55');this.sign(door,'打卡后 按住 E 开门',0,1.45,.085,1.55,.22,0,'#d7d7b8','#25453d');
   const label=this.sprite('出口 · 常亮前室',e.x,2.55,e.z,2);this.labels.push({object:label,point:e,range:10});
   const outside=this.box(this.group,3,.08,3,e.x+e.outward.x*1.8,-.05,e.z+e.outward.z*1.8,white);outside.userData.exit=e.id;
   const emergency=new THREE.PointLight(0xd8f7c0,12,6,2);emergency.position.set(e.x,2.1,e.z);this.group.add(emergency);
  }
  for(const p of world.props){let v:THREE.Object3D;if(p.kind==='cake'){
    const g=new THREE.Group();const cake=new THREE.Mesh(new THREE.CylinderGeometry(.3,.29,.34,24),this.material(0xc99d57));cake.position.y=.19;g.add(cake);const top=new THREE.Mesh(new THREE.CylinderGeometry(.29,.29,.025,24),this.material(0xe8c788));top.position.y=.37;g.add(top);this.sign(g,'愿景',0,.39,0,.36,.22).rotation.x=-Math.PI/2;v=g;
   }else {const g=new THREE.Group();this.box(g,.55,.55,.55,0,.275,0,this.material(0xac8a60));this.box(g,.12,.008,.56,0,.555,0,this.material(0xc3ad7e));v=g;}
   this.group.add(v);this.props.set(p.id,v);
  }
  for(const id of ['pot-0','pot-1']){const p=this.runtimeAsset('pot-v1',makeTechnicalPot);p.visible=false;this.group.add(p);this.pots.set(id,p);}
  const r=world.rooms.find(r=>r.id===1)!;this.clockText=this.sprite('18:00',r.x-2,2.35,r.z-7,1.3,'#e9d7a6');
  this.currentTarget.set(world.spawn.x,1.25,world.spawn.z);this.warmed=false;
 }
 updateSettings(settings:Settings){this.settings=settings;this.resize();}
 resize(){const w=window.innerWidth,h=window.innerHeight;const maxPixels=this.settings.quality==='low'?1280*720:this.settings.quality==='medium'?1920*1080:2560*1440;const ratio=Math.min(window.devicePixelRatio,Math.sqrt(maxPixels/(w*h)));this.renderer.setPixelRatio(ratio);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 async prepare(){
  if(this.disposed)return;
  const group=this.group;
  if(!this.warmed){
   const textures=new Set<THREE.Texture>();
   group.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Line||object instanceof THREE.Sprite){for(const material of Array.isArray(object.material)?object.material:[object.material])for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);}});
   for(const texture of textures)this.renderer.initTexture(texture);
   await this.compile(this.scene);if(this.disposed||group!==this.group)return;
   // Compile the alternate shader without changing live walls while the frame loop is running.
   const wall=this.wallMeshes.values().next().value;
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
  for(const room of world.rooms){const lit=room.permanentLight||state.lights[room.id];this.lamps.get(room.id)!.intensity=lit?25:0;
   const mats=this.roomMaterials.get(room.id)??[];for(const m of mats)m.color.copy(m.userData.baseColor).multiplyScalar(lit?1:.4);
   const led=this.switches.get(room.id);if(led)(led.material as THREE.MeshBasicMaterial).color.set(lit?0x9aefb0:0xc17b45);
   this.flows.get(room.id)!.visible=state.flowRooms.includes(room.id);
   const ceiling=this.ceilings.get(room.id)!;const clearance=state.pressureRooms.includes(room.id)?(state.pressureHeights[room.id]??1.6):2.8;ceiling.position.y=clearance+.05;
  }
  for(const w of world.walls){const mesh=this.wallMeshes.get(w.id)!;const m=mesh.material as THREE.MeshStandardMaterial;const transparent=state.transparentWalls.includes(w.id);if(m.transparent!==transparent){m.transparent=transparent;m.needsUpdate=true;}m.opacity=transparent?.2:1;m.depthWrite=!transparent;}
  for(const d of world.desks)this.desks.get(d.id)!.position.y=state.deskHeights[d.id]??.75;
  for(const e of world.exits){const g=this.exits.get(e.id)!;g.visible=!state.openedExits.includes(e.id);}
  const player=this.characters.get('player')!;player.root.position.set(state.player.x,state.player.y,state.player.z);player.root.rotation.y=state.player.yaw;player.update(state.player.pose,state.player.moving,state.player.sprinting,time,state.player.potInHand||!!state.player.holding);
  const boss=this.characters.get('boss')!;boss.root.position.set(state.boss.x,0,state.boss.z);boss.root.rotation.y=state.boss.yaw;const bossRoom=world.rooms.find(r=>inside(state.boss,r))?.id??-1;const bossCeiling=state.pressureRooms.includes(bossRoom)?(state.pressureHeights[bossRoom]??1.6):2.8;boss.update(bossCeiling<1.85?'crouching':'standing',true,state.boss.mode==='chase',time,false);
  for(const c of state.colleagues){const v=this.characters.get(c.id)!;v.update('working',false,false,time+c.x,false);v.head.rotation.y=c.grudge?.35:Math.sin(time*.3+c.x)*.12;v.rightArm.rotation.x=c.reportAt!==null?-2.1:v.rightArm.rotation.x;}
  // Each occupied seat is represented by its actor's chair; a sticky player took the home chair along.
  const occupiedSeats=new Set(state.colleagues.map(colleague=>colleague.deskId));
  if(state.player.sticky)for(const desk of world.desks)if(desk.home)occupiedSeats.add(desk.id);
  if(state.player.pose==='working')for(const desk of world.desks)if(Math.hypot(state.player.x-desk.seat.x,state.player.z-desk.seat.z)<.4)occupiedSeats.add(desk.id);
  for(const child of this.group.children)if(child.userData.deskId)child.visible=!occupiedSeats.has(child.userData.deskId);
  for(const p of state.props){const v=this.props.get(p.id);if(!v)continue;v.scale.setScalar(p.scale);if(p.held){player.hand.updateWorldMatrix(true,false);player.hand.getWorldPosition(v.position);v.position.y+=.12;}else v.position.set(p.x,p.y??0,p.z);}
  for(const pot of state.pots){let v=this.pots.get(pot.id);if(!v){v=this.runtimeAsset('pot-v1',makeTechnicalPot);this.pots.set(pot.id,v);this.group.add(v);}const owner=this.characters.get(pot.owner);if(!owner){v.visible=false;continue;}v.visible=true;
   const seated=pot.owner!=='player'||state.player.pose==='working'||state.player.sticky;
   const held=pot.phase==='held'||pot.phase==='drawing';const anchor=held?owner.hand:seated?owner.crown:owner.back;anchor.updateWorldMatrix(true,false);anchor.getWorldPosition(v.position);
   v.rotation.set(seated||held?0:Math.PI/2,0,0);
   if(pot.phase==='flying'||pot.phase==='returning'){const t=THREE.MathUtils.clamp(pot.progress,0,1);v.position.set(THREE.MathUtils.lerp(pot.from.x,pot.to.x,t),1.15+Math.sin(t*Math.PI)*.65,THREE.MathUtils.lerp(pot.from.z,pot.to.z,t));v.rotation.y=time*10;}
  }
  for(const label of this.labels)label.object.visible=Math.hypot(label.point.x-state.player.x,label.point.z-state.player.z)<label.range;
  this.pointerRing.visible=state.interaction!==null&&page==='playing';if(state.interaction){const id=state.interaction.id;const obj=[...world.stations,...world.exits,...world.desks,...state.props].find(p=>p.id===id);if(obj)this.pointerRing.position.set(obj.x,.018,obj.z);else this.pointerRing.visible=false;}
  this.aimLine.visible=state.aiming&&!!state.player.holding||state.aiming&&state.player.potInHand;
  if(this.aimLine.visible){const a=this.aimLine.geometry.attributes.position;for(let i=0;i<a.count;i++){const t=i/(a.count-1);a.setXYZ(i,state.player.x+Math.sin(yaw)*6*t,state.player.y+1.1+Math.sin(t*Math.PI)*.65,state.player.z+Math.cos(yaw)*6*t);}a.needsUpdate=true;}
  const home=world.desks[0];
  if(page==='home'||page==='tutorial'||(page==='settings'&&state.elapsed===0)){
   this.camera.position.set(world.spawn.x+3.8,2.05,world.spawn.z-3.9);this.camera.lookAt(home.x,1.1,home.z);this.pointerRing.visible=false;this.aimLine.visible=false;
  }else{
   const seated=state.player.pose==='working'||state.player.sticky,head=state.player.pose==='crouching'?.72:seated?1:1.38;
   this.target.set(state.player.x,state.player.y+head,state.player.z);this.currentTarget.lerp(this.target,1-Math.exp(-dt*30));
   const dist=state.player.pose==='dragged'?4.1:state.aiming?2.35:3.5;const forward=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
   this.look.copy(this.currentTarget).addScaledVector(forward,3);const desired=this.currentTarget.clone().addScaledVector(forward,-dist).add(new THREE.Vector3(Math.cos(yaw)*.35,.35,-Math.sin(yaw)*.35));
   const position=resolveCamera(world,state,this.currentTarget,desired);
   this.camera.position.set(position.x,position.y,position.z);this.camera.lookAt(this.look);
  }
  const clock=`18:${Math.floor(state.elapsed/60).toString().padStart(2,'0')}`;if(this.clockText&&clock!==this.lastClock){this.lastClock=clock;const mat=this.clockText.material as THREE.SpriteMaterial;const old=mat.map;mat.map=this.text(clock);if(old){old.dispose();this.resources.delete(old);}}
  this.renderer.render(this.scene,this.camera);
 }
 getRuleVisuals(){return {
  ceilings:[...this.ceilings].map(([roomId,mesh])=>({roomId,clearance:mesh.position.y-mesh.scale.y/2})),
  desks:[...this.desks].map(([id,mesh])=>({id,height:mesh.position.y})),
  partitions:[...this.wallMeshes].filter(([id])=>id.startsWith('partition-')).map(([id,mesh])=>({id,opacity:(mesh.material as THREE.MeshStandardMaterial).opacity})),
  flows:[...this.flows].filter(([,mesh])=>mesh.visible).map(([roomId])=>roomId),
 };}
 getMetrics(){const gl=this.renderer.getContext();const ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),drawingBuffer:{width:gl.drawingBufferWidth,height:gl.drawingBufferHeight},css:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,pixelRatio:this.renderer.getPixelRatio(),drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,programs:this.renderer.info.programs?.length??0,memory:{...this.renderer.info.memory}};}
 clear(){
  const group=this.group,resources=this.resources,instances=this.runtimeInstances,assets=this.runtimeAssets;
  this.scene.remove(group);this.resources=new Set();this.runtimeInstances=new Set();
  // Three polls material programs until compileAsync settles; detaching is safe, disposal is not.
  this.releaseWhenIdle(()=>{
   group.traverse(o=>{if(!o.userData.runtimeAssetOwned&&(o instanceof THREE.Mesh||o instanceof THREE.Line||o instanceof THREE.Sprite)){
    if(!(o instanceof THREE.Sprite)&&o.geometry!==this.boxGeometry)resources.add(o.geometry);
    for(const m of Array.isArray(o.material)?o.material:[o.material])resources.add(m);
   }});
   for(const instance of instances)assets?.releaseInstance(instance);instances.clear();
   for(const resource of resources)resource.dispose();resources.clear();
  });
  this.group=new THREE.Group();this.scene.add(this.group);this.world=null;this.warmed=false;
  this.characters.clear();this.desks.clear();this.pots.clear();this.props.clear();this.exits.clear();this.wallMeshes.clear();this.ceilings.clear();this.roomMaterials.clear();this.lamps.clear();this.flows.clear();this.switches.clear();this.labels=[];this.lastClock='';this.screen=null;this.clockText=null;
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;this.clear();this.resizeObserver.disconnect();this.canvas.remove();
  this.releaseWhenIdle(()=>this.renderer.dispose());
 }
}
