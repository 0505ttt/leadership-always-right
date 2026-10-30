import { describe, expect, it } from 'vitest';
import type { ActiveRule, InputFrame, RuleKind, WorldDef } from '../src/contracts/game';
import { createGame } from '../src/rules/game';
import { updateEnvironment } from '../src/rules/environment';
import { updatePlayer } from '../src/rules/player';
import { requestReturnWarning, updateBoss } from '../src/rules/boss';
import { attachPot, updateObjects } from '../src/rules/objects';
import { runtimeFor } from '../src/rules/runtime';
import { makeWorldQuery } from '../src/world/query';
import { generateWorld } from '../src/world/generate';
import { resolveCamera } from '../src/gameplay/camera';

const idle:InputFrame={moveX:0,moveZ:0,yaw:0,sprint:false,crouchPressed:false,jumpPressed:false,interact:false,interactPressed:false,potPressed:false,dropPressed:false,throwPressed:false,aim:false};
const durations={flow:16,transparent:18,pressure:14,pot:.4} as const;

function fixture(seed=123) {
 const world:WorldDef={seed,width:40,depth:30,
  rooms:[{id:0,name:'本人工作区',kind:'work',x:10,z:15,w:20,d:30,lit:true,permanentLight:false,switch:{x:1,z:15},pressure:false},{id:1,name:'会议室',kind:'meeting',x:30,z:15,w:20,d:30,lit:true,permanentLight:false,switch:{x:21,z:3},pressure:true}],
  walls:[{id:'panel',x:35,z:15,w:.15,d:6,height:2.2,roomId:1,partition:true}],doors:[],
  desks:[{id:'home',roomId:0,x:4,z:4.5,seat:{x:4,z:3},yaw:0,home:true},{id:'project',roomId:1,x:25,z:24,seat:{x:25,z:22.8},yaw:0}],
  stations:[{id:'clock',roomId:1,x:35,z:27,yaw:0}],exits:[{id:'exit',roomId:1,x:39.35,z:25,yaw:Math.PI/2,outward:{x:1,z:0}}],
  props:[{id:'cake-a',kind:'cake',roomId:0,x:12,z:14},{id:'cake-b',kind:'cake',roomId:1,x:28,z:22},{id:'box',kind:'box',roomId:1,x:36,z:23}],
  colleagues:[{id:'c0',name:'甲',roomId:0,deskId:'d0',x:8,z:10,yaw:0,pot:true},{id:'c1',name:'乙',roomId:0,deskId:'d1',x:12,z:10,yaw:0,pot:true},{id:'c2',name:'丙',roomId:1,deskId:'d2',x:36,z:14,yaw:0,pot:false},{id:'c3',name:'丁',roomId:1,deskId:'d3',x:36,z:18,yaw:0,pot:false}],
  spawn:{x:4,z:3},bossSpawn:{x:10,z:8},patrol:[{x:10,z:16},{x:30,z:10}],validation:[]};
 const state=createGame(world),query=makeWorldQuery(world);
 Object.assign(state.player,{x:10,z:12,pose:'standing'});
 runtimeFor(state).nextEnvironment=Infinity;
 return {world,state,query};
}
type Fixture=ReturnType<typeof fixture>;

function allowOnly(f:Fixture,kinds:RuleKind[],random=0) {
 f.state.elapsed=20;
 const runtime=runtimeFor(f.state);runtime.nextEnvironment=20;runtime.random=()=>random;
 for(const kind of ['cake','desk','pot','flow','transparent','pressure'] as const)if(!kinds.includes(kind))runtime.lastKinds[kind]=20;
}

function advance(f:Fixture,seconds:number) {
 for(let i=0;i<Math.ceil(seconds/.05);i++) {
  const dt=Math.min(.05,seconds-i*.05);f.state.elapsed+=dt;
  updateEnvironment(f.state,dt,f.world,f.query);
  updateObjects(f.state,dt,f.world,f.query);
 }
}

function warn(f:Fixture,kind:keyof typeof durations):ActiveRule {
 const rule:ActiveRule={id:91,kind,quote:'测试预警',effect:'测试后果',targetId:kind==='transparent'?'panel':'room-1',roomId:1,phase:'warning',remaining:3,duration:durations[kind],age:0};
 f.state.rules.push(rule);return rule;
}

function issuePot(f:Fixture) {
 f.state.elapsed=20;
 const runtime=runtimeFor(f.state);runtime.nextEnvironment=20;runtime.random=()=>0;
 for(const kind of ['cake','desk','flow','transparent','pressure'] as const)runtime.lastKinds[kind]=20;
 updateEnvironment(f.state,0,f.world,f.query);
 expect(f.state.rules.map(rule=>rule.kind)).toEqual(['pot']);
 expect(f.state.rules[0].targetId).toBe('player');
 runtime.nextEnvironment=Infinity;
}

function playerTravel(f:Fixture,yaw:number,options:{x?:number;sticky?:boolean;crouch?:boolean}={}) {
 Object.assign(f.state.player,{x:options.x??30,z:15,y:0,vy:0,pose:options.sticky?'rolling':'standing',sticky:options.sticky??false,crouchIntent:options.crouch??false,potId:null});
 updatePlayer(f.state,{...idle,moveZ:1,yaw},.5,f.world,f.query);
 return Math.abs(f.state.player.z-15);
}

function bossTravel(f:Fixture,yaw:number) {
 Object.assign(f.state.player,{x:4,z:3,pose:'working'});
 Object.assign(f.state.boss,{x:30,z:15,yaw,mode:'patrol',path:[],patrolIndex:0});
 Object.assign(runtimeFor(f.state),{navTarget:null,navEndpoint:null,nextPathAt:0,stuckFor:0});
 f.world.patrol=[{x:30,z:yaw===0?22:8}];
 updateBoss(f.state,.2,f.world,f.query);
 return Math.abs(f.state.boss.z-15);
}

describe('environment rule lifecycle with actual collision queries',()=>{
 it.each([
  {pose:'working' as const,sticky:false,body:1.42},
  {pose:'rolling' as const,sticky:true,body:1.42},
  {pose:'dragged' as const,sticky:false,body:1.75},
  {pose:'dragged' as const,sticky:true,body:1.42},
 ])('preserves the supported $pose envelope when it cannot duck',({pose,sticky,body})=>{
  const f=fixture(),desk=f.world.desks[1];
  Object.assign(f.state.player,{x:desk.x,z:desk.z,y:f.query.supportHeight(desk,f.state),pose,sticky});
  warn(f,'pressure');advance(f,4.1);
  expect(f.state.pressureHeights[1]).toBeGreaterThanOrEqual(f.state.player.y+body+.05-1e-8);
  expect(f.state.player.pose).toBe(pose);expect(f.state.player.sticky).toBe(sticky);
 });

 it('pauses the pressure plate above a crouched player on desk-3 and continues after they move off',()=>{
  const world=generateWorld(618),state=createGame(world),query=makeWorldQuery(world);
  const desk=world.desks.find(item=>item.id==='desk-3')!;
  expect(world.rooms.find(room=>room.id===desk.roomId)?.pressure).toBe(true);
  Object.assign(state.player,{x:desk.x,z:desk.z,y:query.supportHeight(desk,state),vy:0,pose:'standing'});
  const originalFeet=state.player.y;expect(originalFeet).toBeCloseTo(.831);
  runtimeFor(state).nextEnvironment=Infinity;
  state.rules.push({id:99,kind:'pressure',quote:'测试压力',effect:'测试后果',targetId:`room-${desk.roomId}`,roomId:desk.roomId,phase:'warning',remaining:0,duration:14,age:0});
  updateEnvironment(state,0,world,query);
  const step=(moving=false)=>{
   state.elapsed+=1/60;updatePlayer(state,{...idle,moveZ:moving?1:0,yaw:Math.PI/2},1/60,world,query);
   updateEnvironment(state,1/60,world,query);
   expect(state.pressureHeights[desk.roomId]).toBeGreaterThanOrEqual(state.player.y+.9+.05-1e-8);
  };
  for(let frame=0;frame<120;frame++)step();
  expect(state.player.pose).toBe('crouching');expect(state.player.y).toBe(originalFeet);
  expect(state.pressureHeights[desk.roomId]).toBeCloseTo(1.781);
  for(let frame=0;frame<120;frame++)step(true);
  expect(state.player.y).toBe(0);expect(state.player.pose).toBe('crouching');
  expect(state.pressureHeights[desk.roomId]).toBeCloseTo(1.6);
 });

 it('uses one authoritative ceiling for the one-second descent, fourteen-second hold and one-second rise',()=>{
  const f=fixture();const rule=warn(f,'pressure');advance(f,2.99);
  expect(f.state.pressureHeights[1]).toBeUndefined();
  expect(f.query.clearance({x:30,z:15},f.state)).toBe(Infinity);
  expect(playerTravel(f,0)).toBeCloseTo(1.55);
  advance(f,.02);
  expect(f.state.pressureHeights?.[1]).toBeCloseTo(2.8);
  expect(f.query.clearance({x:30,z:15},f.state)).toBeCloseTo(2.8);
  expect(playerTravel(f,0)).toBeCloseTo(1.55);
  expect(bossTravel(f,0)).toBeCloseTo(.4);
  advance(f,.5);
  expect(f.state.pressureHeights[1]).toBeCloseTo(2.2);
  expect(f.query.clearance({x:30,z:15},f.state)).toBeCloseTo(2.2);
  const camera=resolveCamera(f.world,f.state,{x:30,z:15,y:.8},{x:30,z:16,y:2.65});
  expect(camera.y).toBeGreaterThan(2);expect(camera.y).toBeLessThanOrEqual(2.08);
  expect(playerTravel(f,0)).toBeCloseTo(1.55);
  expect(bossTravel(f,0)).toBeCloseTo(.4);
  advance(f,.5);
  expect(f.state.pressureHeights[1]).toBeCloseTo(1.6);
  expect(rule.remaining).toBeCloseTo(14);
  expect(playerTravel(f,0)).toBeCloseTo(.8);
  expect(bossTravel(f,0)).toBeCloseTo(.32);
  advance(f,13.9);
  expect(f.state.pressureHeights[1]).toBeCloseTo(1.6);
  expect(rule.phase).toBe('active');expect(rule.remaining).toBeCloseTo(.1);
  advance(f,.11);
  expect(rule.phase).toBe('restoring');expect(f.state.pressureHeights[1]).toBeGreaterThanOrEqual(1.6);
  expect(f.state.pressureHeights[1]).toBeLessThan(1.62);
  advance(f,.5-rule.age);
  expect(f.state.pressureHeights[1]).toBeCloseTo(2.2);
  expect(playerTravel(f,0)).toBeCloseTo(1.55);
  expect(bossTravel(f,0)).toBeCloseTo(.4);
  advance(f,.51);
  expect(f.state.pressureHeights[1]).toBeUndefined();expect(f.state.pressureRooms).not.toContain(1);
  expect(f.query.clearance({x:30,z:15},f.state)).toBe(Infinity);
 });

 it('slows only reverse movement in the marked flow strip for both actors, then restores it',()=>{
  const f=fixture();const normal=playerTravel(f,Math.PI),normalBoss=bossTravel(f,Math.PI);
  warn(f,'flow');advance(f,2.99);
  expect(playerTravel(f,Math.PI)).toBeCloseTo(normal);
  advance(f,.02);
  expect(playerTravel(f,Math.PI)).toBeCloseTo(normal*.6);
  expect(playerTravel(f,0)).toBeCloseTo(normal);
  expect(playerTravel(f,Math.PI,{x:26})).toBeCloseTo(normal);
  expect(bossTravel(f,Math.PI)).toBeCloseTo(.2*1.3); // The shared movement floor also applies to the leader.
  expect(bossTravel(f,0)).toBeCloseTo(normalBoss);
  advance(f,16.01);
  expect(playerTravel(f,Math.PI)).toBeCloseTo(normal);
  expect(bossTravel(f,Math.PI)).toBeCloseTo(normalBoss);
  expect(f.state.rules).toHaveLength(0);
 });

 it('makes the same partition visible through from both sides while retaining collision, then restores occlusion',()=>{
  const f=fixture(),a={x:33,z:15},b={x:37,z:15};
  const before=f.query.move(a,{x:4,z:0},.3,1.75,f.state);
  expect(before.x).toBeLessThan(35);
  expect(f.query.lineOfSight(a,b,1.05,f.state)).toBe(false);
  warn(f,'transparent');advance(f,2.99);
  expect(f.query.lineOfSight(a,b,1.05,f.state)).toBe(false);
  advance(f,.02);
  expect(f.query.lineOfSight(a,b,1.05,f.state)).toBe(true);
  expect(f.query.lineOfSight(b,a,1.05,f.state)).toBe(true);
  expect(f.query.move(a,{x:4,z:0},.3,1.75,f.state)).toEqual(before);
  advance(f,18.01);
  expect(f.query.lineOfSight(a,b,1.05,f.state)).toBe(false);
  expect(f.query.lineOfSight(b,a,1.05,f.state)).toBe(false);
  expect(f.query.move(a,{x:4,z:0},.3,1.75,f.state)).toEqual(before);
 });

 it.each([false,true])('restores pressure headroom and preserves voluntary crouching=%s',crouch=>{
  const f=fixture();warn(f,'pressure');advance(f,4.1);
  expect(f.query.clearance({x:30,z:15},f.state)).toBe(1.6);
  expect(playerTravel(f,0,{crouch})).toBeCloseTo(.8);
  expect(f.state.player.pose).toBe('crouching');
  updatePlayer(f.state,{...idle,jumpPressed:true},.1,f.world,f.query);
  expect(f.state.player.y).toBe(0);
  expect(bossTravel(f,0)).toBeCloseTo(.32);
  advance(f,16.1); // Allow the complete hold plus rise; ramp timing has its own collision/animation contract.
  expect(f.query.clearance({x:30,z:15},f.state)).toBe(Infinity);
  expect(f.state.player.crouchIntent).toBe(crouch);
  Object.assign(f.state.player,{x:30,z:15,pose:'standing'});
  updatePlayer(f.state,{...idle,moveZ:1},.5,f.world,f.query);
  expect(f.state.player.z-15).toBeCloseTo(crouch?.8:1.55);
  expect(f.state.player.pose).toBe(crouch?'crouching':'standing');
  expect(bossTravel(f,0)).toBeCloseTo(.4);
 });

 it('lets the rolling chair pass a pressured room at rolling speed without a jump or crouch',()=>{
  const f=fixture();warn(f,'pressure');advance(f,4.1);
  expect(playerTravel(f,0,{sticky:true})).toBeCloseTo(1.8);
  updatePlayer(f.state,{...idle,crouchPressed:true,jumpPressed:true},.1,f.world,f.query);
  expect(f.state.player.pose).toBe('rolling');expect(f.state.player.y).toBe(0);
  advance(f,16.1);
  expect(f.state.player.sticky).toBe(true);
  expect(playerTravel(f,0,{sticky:true})).toBeCloseTo(1.8);
 });
});

describe('announced assignment preserves the two existing pots',()=>{
 it('waits three seconds, transfers a visible existing pot once, and keeps ownership after the notice expires',()=>{
  const f=fixture(),ids=f.state.pots.map(pot=>pot.id);issuePot(f);
  advance(f,2.99);expect(f.state.pots.some(pot=>pot.owner==='player')).toBe(false);
  advance(f,.02);expect(f.state.pots.filter(pot=>pot.owner==='player')).toHaveLength(1);
  advance(f,.8);
  expect(f.state.rules).toHaveLength(0);
  expect(f.state.player.potId).not.toBeNull();
  expect(f.state.pots.find(pot=>pot.owner==='player')?.phase).toBe('attached');
  expect(f.state.pots.map(pot=>pot.id)).toEqual(ids);
  expect(new Set(f.state.pots.map(pot=>pot.owner)).size).toBe(2);
  expect(f.state.eventLog.filter(event=>event.event.includes(':transferred:player'))).toHaveLength(1);
 });

 it.each(['dark','occluded','source-transferred','target-occupied'] as const)('rechecks %s at activation and cancels without duplicating or swapping pots',change=>{
  const f=fixture();issuePot(f);advance(f,1);
  if(change==='dark')f.state.lights[0]=false;
  if(change==='occluded')f.world.walls.push({id:'new-occluder',x:10,z:11,w:8,d:.15,height:2.8,roomId:0});
  if(change==='source-transferred')attachPot(f.state,f.state.pots[0],'c2');
  if(change==='target-occupied')attachPot(f.state,f.state.pots[1],'player');
  const ownership=f.state.pots.map(pot=>pot.owner);
  advance(f,2.1);
  expect(f.state.pots).toHaveLength(2);
  expect(f.state.pots.map(pot=>pot.owner)).toEqual(ownership);
  expect(new Set(f.state.pots.map(pot=>pot.owner)).size).toBe(2);
  expect(f.state.eventLog.some(event=>event.event==='rule:pot:cancelled')).toBe(true);
 });
});

describe('announcement priority and spatial budgets',()=>{
 it('finishes an already visible environment warning before displaying the pending return order',()=>{
  const f=fixture();warn(f,'flow');requestReturnWarning(f.state);
  expect(f.state.rules.filter(rule=>rule.phase==='warning').map(rule=>rule.kind)).toEqual(['flow']);
  advance(f,3.01);updateBoss(f.state,.01,f.world,f.query);
  expect(f.state.rules.filter(rule=>rule.phase==='warning').map(rule=>rule.kind)).toEqual(['return']);
  const count=f.state.rules.length;
  runtimeFor(f.state).nextEnvironment=0;
  f.state.elapsed=30;updateEnvironment(f.state,.01,f.world,f.query);
  expect(f.state.rules).toHaveLength(count);
 });

 it('respects two spatial slots, one per room, one warning and the 18/50-second spacing throughout a round',()=>{
  const f=fixture(51);const runtime=runtimeFor(f.state);runtime.nextEnvironment=0;
  const announcements:{id:number;kind:RuleKind;at:number}[]=[],seen=new Set<number>();
  for(let frame=0;frame<6000;frame++) {
   advance(f,.1);
   const warnings=f.state.rules.filter(rule=>rule.phase==='warning');
   const spatial=f.state.rules.filter(rule=>rule.kind!=='return'&&rule.kind!=='pot'&&rule.phase!=='restoring');
   expect(warnings.length).toBeLessThanOrEqual(1);
   expect(spatial.length).toBeLessThanOrEqual(2);
   expect(new Set(spatial.map(rule=>rule.roomId)).size).toBe(spatial.length);
   for(const warning of warnings)if(!seen.has(warning.id)) {
    seen.add(warning.id);announcements.push({id:warning.id,kind:warning.kind,at:f.state.elapsed});
    if(warning.kind==='pressure')expect(warning.roomId).not.toBe(f.world.desks[0].roomId);
   }
  }
  expect(announcements.length).toBeGreaterThan(10);
  expect(announcements[0].at).toBeGreaterThanOrEqual(15);
  const lastKind=new Map<RuleKind,number>();
  announcements.forEach((event,index)=>{
   if(index)expect(event.at-announcements[index-1].at).toBeGreaterThanOrEqual(18-1e-8);
   if(event.kind!=='pot'&&lastKind.has(event.kind))expect(event.at-lastKind.get(event.kind)!).toBeGreaterThanOrEqual(50-1e-8);
   lastKind.set(event.kind,event.at);
  });
  expect(f.state.pots).toHaveLength(2);
  expect(new Set(f.state.pots.map(pot=>pot.owner)).size).toBe(2);
 });
});

describe('environment announcements prefer observable targets without suppressing valid remote commands',()=>{
 it('opens the first seeded environment window at 15–18 seconds and keeps later windows at 24–36 seconds',()=>{
  for(const seed of [618,1,7,42,123,999]) {
   const f=fixture(seed),runtime=runtimeFor(f.state);
   const initial=createGame(f.world);const first=runtimeFor(initial).nextEnvironment;
   expect(first).toBeGreaterThanOrEqual(15);expect(first).toBeLessThanOrEqual(18);
   runtime.nextEnvironment=first;
   advance(f,14.99);expect(f.state.rules).toHaveLength(0);
   advance(f,first-14.99+.01);
   expect(f.state.rules.some(rule=>rule.kind!=='return')).toBe(true);
   expect(runtime.nextEnvironment-runtime.lastEnvironment).toBeGreaterThanOrEqual(24);
   expect(runtime.nextEnvironment-runtime.lastEnvironment).toBeLessThanOrEqual(36);
  }
 });
 it('chooses the occupied eligible room instead of a remote pressure plate and names it before lowering',()=>{
  const world=generateWorld(618),state=createGame(world),query=makeWorldQuery(world),f={world,state,query};
  const room=world.rooms.find(item=>item.id===2)!;
  Object.assign(state.player,{x:room.x+3,z:room.z-4,pose:'standing'});
  Object.assign(state.boss,{x:room.x+3,z:room.z-6});
  allowOnly(f,['pressure'],.999);updateEnvironment(state,0,world,query);
  const rule=state.rules[0];expect(rule?.roomId).toBe(room.id);
  expect(rule.effect).toContain(room.name);expect(rule.effect).toContain('活动顶板');
  expect(state.history[0]).toContain(room.name);
  expect(state.pressureRooms).toHaveLength(0);
  advance(f,2.99);expect(state.pressureRooms).toHaveLength(0);
  advance(f,.02);advance(f,.5);expect(state.pressureHeights[room.id]).toBeCloseTo(2.2);
  advance(f,.5);expect(state.pressureHeights[room.id]).toBeCloseTo(1.6);
  expect(state.pressureRooms).toEqual([room.id]);
 });

 it('does not infer a hidden player room to choose pressure there',()=>{
  const f=fixture();Object.assign(f.state.player,{x:30,z:15});
  f.world.patrol=[{x:10,z:15}];
  f.world.walls.push({id:'closed-boundary',x:20,z:15,w:.18,d:30,height:2.8,roomId:0});
  allowOnly(f,['pressure']);updateEnvironment(f.state,0,f.world,f.query);
  expect(f.state.rules).toHaveLength(0);expect(f.state.pressureRooms).toHaveLength(0);
 });

 it('keeps a known remote pressure room as a fallback and identifies the remote location',()=>{
  const f=fixture();f.world.doors.push({id:'entry',a:0,b:1,x:20,z:15,axis:'z',width:2.2});
  f.world.patrol=[{x:30,z:15}];allowOnly(f,['pressure']);
  updateEnvironment(f.state,0,f.world,f.query);
  expect(f.state.rules[0]?.roomId).toBe(1);
  expect(f.state.rules[0]?.effect).toContain('会议室');expect(f.state.rules[0]?.effect).toContain('其他房间');
  advance(f,4.1);expect(f.state.pressureHeights[1]).toBeCloseTo(1.6);
  expect(f.query.clearance(f.state.player,f.state)).toBe(Infinity);
 });

 it('can warn the known adjacent pressure room at a nearby visible doorway',()=>{
  const f=fixture();Object.assign(f.state.player,{x:18,z:15});
  f.world.doors.push({id:'entry',a:0,b:1,x:20,z:15,axis:'z',width:2.2});
  f.world.patrol=[{x:30,z:15}];allowOnly(f,['pressure']);
  updateEnvironment(f.state,0,f.world,f.query);
  expect(f.state.rules[0]?.roomId).toBe(1);expect(f.state.rules[0]?.effect).toContain('会议室');
 });

 it('falls back to a local legal flow rather than announcing an ineffective remote plate',()=>{
  const f=fixture();f.world.patrol=[{x:10,z:16}];allowOnly(f,['pressure','flow']);
  updateEnvironment(f.state,0,f.world,f.query);
  expect(f.state.rules[0]?.kind).toBe('flow');expect(f.state.rules[0]?.roomId).toBe(0);
  expect(f.state.rules[0]?.effect).toContain('本人工作区');expect(f.state.rules[0]?.effect).toContain('通道');
 });

 it('selects a visible local partition face without treating its own solid center as an occluder',()=>{
  const f=fixture();Object.assign(f.state.player,{x:30,z:15});Object.assign(f.state.boss,{x:31,z:15});
  f.world.walls.unshift({id:'remote-panel',x:5,z:20,w:3,d:.16,height:2.2,roomId:0,partition:true});
  expect(f.query.lineOfSight(f.state.player,f.world.walls.find(wall=>wall.id==='panel')!,1.05,f.state)).toBe(false);
  allowOnly(f,['transparent']);updateEnvironment(f.state,0,f.world,f.query);
  expect(f.state.rules[0]?.targetId).toBe('panel');expect(f.state.rules[0]?.effect).toContain('会议室');
  advance(f,3.01);expect(f.query.lineOfSight({x:33,z:15},{x:37,z:15},1.05,f.state)).toBe(true);
 });

 it('retains the fixed known home desk when no observable target is available',()=>{
  const f=fixture();f.world.walls.push({id:'occluder',x:10,z:8,w:20,d:.18,height:2.8,roomId:0});
  allowOnly(f,['desk']);updateEnvironment(f.state,0,f.world,f.query);
  expect(f.state.rules[0]?.targetId).toBe('home');expect(f.state.rules[0]?.effect).toContain('暂不可见');
  advance(f,3.9);expect(f.state.deskHeights.home).toBeCloseTo(1.9);
 });

 it('prefers a local command across rule kinds before falling back to a remote fixed desk',()=>{
  const f=fixture();Object.assign(f.state.player,{x:30,z:15});Object.assign(f.state.boss,{x:31,z:15});
  f.state.deskHeights.project=1.9;
  allowOnly(f,['desk','pressure']);updateEnvironment(f.state,0,f.world,f.query);
  expect(f.state.rules[0]?.kind).toBe('pressure');expect(f.state.rules[0]?.roomId).toBe(1);
  expect(f.state.rules[0]?.effect).not.toContain('其他房间');
 });

 it.each([
  {kind:'cake' as const,object:'愿景饼'},
  {kind:'desk' as const,object:'我的工位'},
  {kind:'pot' as const,object:'你'},
 ])('names the room and actual target in $kind notices',({kind,object})=>{
  const f=fixture();allowOnly(f,[kind]);updateEnvironment(f.state,0,f.world,f.query);
  expect(f.state.rules[0]?.kind).toBe(kind);
  expect(f.state.rules[0]?.effect).toContain('本人工作区');expect(f.state.rules[0]?.effect).toContain(object);
  if(kind==='pot')expect(f.state.rules[0].effect).toContain('甲');
 });
});
