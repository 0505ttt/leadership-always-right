import { describe, expect, it } from 'vitest';
import type { ActiveRule, InputFrame, WorldDef } from '../src/contracts/game';
import { createGame, stepGame } from '../src/rules/game';
import { beginInspection, inspectionCompliant, INSPECTION_SEARCH_SPEED } from '../src/rules/inspection';
import { updateEnvironment } from '../src/rules/environment';
import { updateBoss, visible } from '../src/rules/boss';
import { updateInteraction, updatePlayer } from '../src/rules/player';
import { runtimeFor } from '../src/rules/runtime';
import { makeWorldQuery } from '../src/world/query';
import { generateWorld } from '../src/world/generate';

const idle:InputFrame={moveX:0,moveZ:0,yaw:0,sprint:false,crouchPressed:false,jumpPressed:false,interact:false,interactPressed:false,potPressed:false,dropPressed:false,throwPressed:false,aim:false};

function fixture() {
  const world:WorldDef={seed:216,width:40,depth:24,
    rooms:[{id:0,name:'本人工位',kind:'work',x:10,z:12,w:20,d:24,lit:true,permanentLight:false,switch:{x:1,z:12},pressure:true},
      {id:1,name:'另一工作区',kind:'work',x:30,z:12,w:20,d:24,lit:true,permanentLight:false,switch:{x:39,z:12},pressure:true}],
    walls:[],doors:[{id:'door',x:20,z:12,a:0,b:1,axis:'z',width:3}],
    desks:[{id:'home',x:5,z:6,seat:{x:5,z:4.8},roomId:0,yaw:0,home:true},{id:'other',x:28,z:6,seat:{x:28,z:4.8},roomId:1,yaw:0}],
    colleagues:[{id:'c0',name:'同事',x:28,z:4.8,roomId:1,deskId:'other',yaw:0,pot:true}],
    stations:[{id:'clock',x:36,z:18,roomId:1,yaw:0}],exits:[{id:'east',x:39.35,z:20,roomId:1,yaw:Math.PI/2,outward:{x:1,z:0}}],
    props:[{id:'cake-intro',kind:'cake',x:5,z:10,roomId:0}],spawn:{x:5,z:4.8},bossSpawn:{x:9,z:20},patrol:[{x:9,z:20},{x:30,z:20}],validation:[]};
  const state=createGame(world),query=makeWorldQuery(world);runtimeFor(state).nextEnvironment=Infinity;
  return {state,world,query};
}
type Fixture=ReturnType<typeof fixture>;
function rule(f:Fixture,kind:ActiveRule['kind']='desk'):ActiveRule {
  const result:ActiveRule={id:runtimeFor(f.state).nextRuleId++,kind,quote:'规则',effect:'效果',targetId:kind==='desk'?'home':kind==='cake'?'cake-intro':'room-0',roomId:0,phase:'warning',remaining:3,duration:20,age:0};
  f.state.rules.push(result);return result;
}
function environment(f:Fixture,seconds:number) {
  for(let i=0;i<Math.ceil(seconds/.02);i++){f.state.elapsed+=.02;updateEnvironment(f.state,.02,f.world,f.query);}
}
function steps(f:Fixture,seconds:number) {
  for(let i=0;i<Math.ceil(seconds*60);i++)stepGame(f.state,{...idle,yaw:f.state.player.yaw},1/60,f.world,f.query);
}

describe('global raised-workstation rule and the sticky-chair loophole',()=>{
  it('raises every desk, raises all employees, and changes shared collision/under-desk routes',()=>{
    const f=fixture();rule(f);environment(f,4);
    for(const desk of f.world.desks)expect(f.state.deskHeights[desk.id]).toBeCloseTo(1.9);
    expect(f.state.colleagues[0]).toMatchObject({workStance:'chair-standing',y:.55});
    expect(f.state.player).toMatchObject({pose:'working',workStance:'chair-standing',y:.55});
    expect(f.query.move({x:2,z:6},{x:6,z:0},.3,1.75,f.state).x).toBeCloseTo(8);
    expect(inspectionCompliant(f.state,f.world)).toBe(true);
  });

  it('accepts a sticky player working at home but rejects a borrowed workstation and mere proximity',()=>{
    const f=fixture();f.state.player.sticky=true;rule(f);environment(f,4);
    expect(f.state.player).toMatchObject({pose:'working',workStance:'seated',y:0});
    expect(inspectionCompliant(f.state,f.world)).toBe(true);
    f.state.player.workstationId='other';expect(inspectionCompliant(f.state,f.world)).toBe(false);
    f.state.player.workstationId='home';f.state.player.pose='rolling';expect(inspectionCompliant(f.state,f.world)).toBe(false);
    f.state.player.pose='working';f.state.player.x+=2;expect(inspectionCompliant(f.state,f.world)).toBe(false);
  });

  it('lets a returning sticky player use the actual interaction to pass without jumping or climbing',()=>{
    const f=fixture();f.state.player.sticky=true;rule(f);environment(f,4);
    Object.assign(f.state.player,{pose:'rolling',z:4.3,yaw:0,workstationId:null});runtimeFor(f.state).workingDesk=null;
    updateInteraction(f.state,{...idle,interact:true,interactPressed:true},1/60,f.world,f.query);
    expect(f.state.player).toMatchObject({pose:'working',workstationId:'home',workStance:'seated',y:0});
    expect(inspectionCompliant(f.state,f.world)).toBe(true);
  });

  it('keeps raised chair work grounded on its support and the seated body facing the desk',()=>{
    const f=fixture();rule(f);environment(f,4);
    updatePlayer(f.state,{...idle,yaw:Math.PI},.1,f.world,f.query);
    expect(f.state.player.y).toBe(.55);expect(f.state.player.yaw).toBe(0);
    updateInteraction(f.state,{...idle,interact:true,interactPressed:true},.01,f.world,f.query);
    expect(f.state.player.pose).toBe('standing');expect(f.state.player.workstationId).toBeNull();
    for(let i=0;i<30;i++)updatePlayer(f.state,idle,.02,f.world,f.query);
    expect(f.state.player.y).toBe(0);
  });

  it.each([true,false])('forced pressure overlap never clips chair-standing staff (pressure first=%s)',first=>{
    const f=fixture();if(first)rule(f,'pressure');rule(f,'desk');if(!first)rule(f,'pressure');
    environment(f,4);
    expect(f.state.pressureHeights[0]).toBeGreaterThanOrEqual(2.35-1e-8);
    expect(f.state.player.y+1.75).toBeLessThan(f.state.pressureHeights[0]);
    f.state.player.sticky=true;environment(f,.1);
    expect(f.state.player.y).toBe(0);expect(inspectionCompliant(f.state,f.world)).toBe(true);
  });

  it('restores all desks and seated workers without crushing somebody beneath one desk',()=>{
    const f=fixture(),r=rule(f);environment(f,4);
    Object.assign(f.state.player,{x:5,z:6,y:0,pose:'rolling',sticky:true,workstationId:null});runtimeFor(f.state).workingDesk=null;
    r.phase='restoring';r.age=0;r.remaining=0;environment(f,1);
    expect(f.state.deskHeights.home).toBeGreaterThanOrEqual(1.58-1e-8);expect(f.state.deskHeights.other).toBe(.75);
    expect(f.state.colleagues[0]).toMatchObject({workStance:'seated',y:0});
    f.state.player.x=10;environment(f,1);expect(Object.values(f.state.deskHeights)).toEqual([.75,.75]);
  });

  it('keeps inspections and desk restoration live through a full generated round after a leader enters a lowering desk',()=>{
    const world=generateWorld(777),state=createGame(world),query=makeWorldQuery(world);
    const announcements=new Set<number>();
    let firstRestoring:number|null=null,restored=false,positionAt90:{x:number;z:number}|null=null,movedAfter90=false;
    for(let frame=0;frame<600*60;frame++){
      stepGame(state,{...idle,yaw:state.player.yaw},1/60,world,query);
      for(const active of state.rules){announcements.add(active.id);if(active.kind==='desk'&&active.phase==='restoring'&&firstRestoring===null)firstRestoring=active.id;}
      if(firstRestoring!==null&&!state.rules.some(active=>active.id===firstRestoring))restored=true;
      if(state.elapsed>=90&&!positionAt90)positionAt90={x:state.boss.x,z:state.boss.z};
      if(positionAt90&&Math.hypot(state.boss.x-positionAt90.x,state.boss.z-positionAt90.z)>2)movedAfter90=true;
    }
    expect(firstRestoring).not.toBeNull();expect(restored).toBe(true);
    expect(movedAfter90).toBe(true);expect(announcements.size).toBeGreaterThan(3);
  },60_000);

  it('does not naturally schedule a ceiling drop over a raised employee workstation',()=>{
    const f=fixture();f.state.elapsed=100;f.state.deskHeights.other=1.9;
    Object.assign(f.state.player,{x:28,z:12,pose:'standing'});Object.assign(f.state.boss,{x:28,z:15,yaw:Math.PI});
    const runtime=runtimeFor(f.state);runtime.nextEnvironment=100;runtime.lastEnvironment=50;
    for(const kind of ['cake','desk','pot','flow','transparent'] as const)runtime.lastKinds[kind]=100;
    updateEnvironment(f.state,0,f.world,f.query);
    expect(f.state.rules).toEqual([]);expect(f.state.inspection).toBeNull();
  });
});

describe('one physical inspection, bounded search and counterplay',()=>{
  it.each([false,true])('physically checks home, uses the route deadline, and cannot stack (sticky=%s)',sticky=>{
    const f=fixture(),r=rule(f);f.state.player.sticky=sticky;
    expect(beginInspection(f.state,r,f.world,f.query)).toBe(true);
    expect(f.state.inspection!.returnBy).toBeGreaterThan(11);
    const id=f.state.inspection!.id;
    expect(beginInspection(f.state,{...r,id:r.id+1},f.world,f.query)).toBe(false);expect(f.state.inspection!.id).toBe(id);
    const before={x:f.state.boss.x,z:f.state.boss.z};steps(f,3.2);
    expect(Math.hypot(f.state.boss.x-before.x,f.state.boss.z-before.z)).toBeGreaterThan(.1);
    expect(f.state.eventLog.some(event=>event.event==='inspection:passed')).toBe(false);
    steps(f,15);
    expect(f.state.eventLog.some(event=>event.event==='inspection:arrived'),JSON.stringify({boss:f.state.boss,inspection:f.state.inspection,stuck:runtimeFor(f.state).stuckFor})).toBe(true);
    expect(f.state.eventLog.some(event=>event.event==='inspection:passed')).toBe(true);
    expect(f.state.inspection).toBeNull();expect(f.state.catches).toBe(0);
  });

  it('uses a longer deadline when the player must return from farther away',()=>{
    const a=fixture(),b=fixture();Object.assign(b.state.player,{x:37,z:20,pose:'standing',workstationId:null});
    beginInspection(a.state,rule(a),a.world,a.query);beginInspection(b.state,rule(b),b.world,b.query);
    expect(b.state.inspection!.returnBy).toBeGreaterThan(a.state.inspection!.returnBy);
  });

  it('does not fail a missing worker remotely before arriving, and does not chase before the deadline',()=>{
    const f=fixture();Object.assign(f.state.player,{x:36,z:20,pose:'standing',workstationId:null});
    beginInspection(f.state,rule(f),f.world,f.query);const deadline=f.state.inspection!.returnBy;
    steps(f,Math.max(4,deadline-1));
    expect(f.state.inspection?.phase).toBe('checking');expect(f.state.boss.mode).toBe('inspection');
    expect(f.state.eventLog.some(event=>event.event==='inspection:empty-search')).toBe(false);
    steps(f,1.5);expect(f.state.inspection?.phase).toBe('search');
    expect(f.state.eventLog.some(event=>event.event==='inspection:empty-search')).toBe(true);
  });

  it('bounds search by a fixed deadline, checks old positions, then relaxes without seeing through walls',()=>{
    const f=fixture();Object.assign(f.state.player,{x:37,z:21,pose:'standing',workstationId:null});
    const r=rule(f);beginInspection(f.state,r,f.world,f.query);
    f.state.inspection!.lastKnown={x:12,z:15};f.state.inspection!.returnBy=0;
    steps(f,16);
    expect(f.state.inspection?.phase).toBe('search');
    const deadline=f.state.inspection!.searchUntil;
    // Darkness removes current visual knowledge without removing the old search target.
    f.state.lights[1]=false;f.state.switchCooldown[1]=100;
    steps(f,28);
    expect(f.state.eventLog.some(event=>event.event==='inspection:search-ended')).toBe(true);
    expect(f.state.inspection).toBeNull();expect(f.state.boss.searchUntil).toBe(deadline);
  });

  it('searches at1.5x running speed but pays a real turn cost and never refreshes its deadline',()=>{
    const f=fixture();Object.assign(f.state.player,{x:37,z:21,pose:'standing',workstationId:null});
    beginInspection(f.state,rule(f),f.world,f.query);
    Object.assign(f.state.inspection!,{phase:'search',searchUntil:30});
    Object.assign(f.state.boss,{x:10,z:10,yaw:0,mode:'search'});
    const runtime=runtimeFor(f.state);runtime.inspectionSearchPoints=[{x:10,z:20}];
    f.state.rules=[];updateBoss(f.state,.1,f.world,f.query);
    expect(f.state.boss.z-10).toBeCloseTo(.72);expect(f.state.inspection!.searchUntil).toBe(30);
    runtime.inspectionSearchPoints=[{x:10,z:2}];runtime.nextPathAt=0;
    const before=f.state.boss.z;updateBoss(f.state,.1,f.world,f.query);
    expect(f.state.boss.z).toBeCloseTo(before);expect(Math.abs(f.state.boss.yaw)).toBeCloseTo(.35);
    expect(f.state.inspection!.searchUntil).toBe(30);
  });

  it('keeps the instantaneous cone at100 degrees with a separate ±40 degree head sweep',()=>{
    const f=fixture();Object.assign(f.state.boss,{x:10,z:12,yaw:0,lookYaw:40*Math.PI/180});
    const point=(angle:number)=>({x:10+Math.sin(angle*Math.PI/180)*3,z:12+Math.cos(angle*Math.PI/180)*3});
    expect(visible(f.state,f.state.boss,point(85),10,1,f.query)).toBe(true);
    expect(visible(f.state,f.state.boss,point(-15),10,1,f.query)).toBe(false);
    f.world.walls.push({id:'wall',x:11.5,z:12,w:.2,d:6,height:2.8,roomId:0});
    expect(visible(f.state,f.state.boss,point(85),10,1,makeWorldQuery(f.world))).toBe(false);
    expect(INSPECTION_SEARCH_SPEED).toBeCloseTo(4.8*1.5);
  });

  it('opens with the visible intro cake and retains its real route/LOS obstruction',()=>{
    const f=fixture();const runtime=runtimeFor(f.state);f.state.elapsed=16;runtime.nextEnvironment=16;
    const fresh=createGame(f.world);expect(runtimeFor(fresh).nextEnvironment).toBeGreaterThanOrEqual(3);expect(runtimeFor(fresh).nextEnvironment).toBeLessThanOrEqual(4);
    updateEnvironment(f.state,0,f.world,f.query);
    expect(f.state.rules[0]).toMatchObject({kind:'cake',targetId:'cake-intro',phase:'warning'});
    expect(f.state.inspection?.ruleId).toBe(f.state.rules[0].id);
    environment(f,4);
    expect(f.state.props[0]).toMatchObject({scale:3,large:true});
    expect(f.query.lineOfSight({x:3,z:10},{x:7,z:10},1.05,f.state)).toBe(false);
    expect(f.query.move({x:3,z:10},{x:4,z:0},.3,1.75,f.state).x).toBeLessThan(4);
  });

  it('does not replace an unseen intro cake with a different first rule or force the player to wait',()=>{
    const f=fixture();f.state.elapsed=5;runtimeFor(f.state).nextEnvironment=5;
    Object.assign(f.state.player,{x:37,z:20,pose:'standing',workstationId:null});
    updateEnvironment(f.state,0,f.world,f.query);
    expect(f.state.rules).toEqual([]);expect(f.state.inspection).toBeNull();
    const before=f.state.player.x;updatePlayer(f.state,{...idle,moveZ:1,yaw:Math.PI/2},.1,f.world,f.query);
    expect(f.state.player.x).toBeGreaterThan(before);
  });

  it('ends inspection pursuit at the fixed deadline even while the player stays visible but uncaught',()=>{
    const f=fixture();
    Object.assign(f.state.player,{x:37,z:21,pose:'standing',workstationId:null,protection:100});
    beginInspection(f.state,rule(f),f.world,f.query);
    Object.assign(f.state.inspection!,{phase:'search',searchUntil:f.state.elapsed+1});
    Object.assign(f.state.boss,{x:36,z:20,yaw:0,mode:'chase'});
    f.state.rules=[];
    steps(f,5);
    expect(f.state.catches).toBe(0);
    expect(f.state.inspection).toBeNull();
    expect(f.state.boss.mode).not.toBe('chase');
  });
});
