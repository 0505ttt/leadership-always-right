import { describe, expect, it } from 'vitest';
import type { ActiveRule, GameState, InputFrame, WorldDef, WorldQuery } from '../src/contracts/game';
import { createGame, stepGame } from '../src/rules/game';
import { runtimeFor } from '../src/rules/runtime';
import { dropHeld, handleObjectInput, updateObjects } from '../src/rules/objects';
import { generateWorld } from '../src/world/generate';
import { deskWorkingPoint } from '../src/world/workstations';
import { makeWorldQuery } from '../src/world/query';

const idle:InputFrame={moveX:0,moveZ:0,yaw:0,sprint:false,crouchPressed:false,jumpPressed:false,interact:false,interactPressed:false,potPressed:false,dropPressed:false,throwPressed:false,aim:false};

function fixture():{world:WorldDef;query:WorldQuery;state:GameState} {
  const world:WorldDef={seed:123,rooms:[{id:0,name:'工作区',kind:'work',x:25,z:25,w:50,d:50,lit:true,permanentLight:false,switch:{x:6,z:6},pressure:true}],walls:[],doors:[],desks:[{id:'home',roomId:0,x:4,z:5.2,seat:{x:4,z:4},yaw:0,home:true}],stations:[{id:'clock',roomId:0,x:10,z:10,yaw:0}],exits:[{id:'exit',roomId:0,x:49,z:25,yaw:Math.PI/2,outward:{x:1,z:0}}],props:[{id:'cake',kind:'cake',roomId:0,x:30,z:30},{id:'box',kind:'box',roomId:0,x:30,z:25}],colleagues:[0,1,2,3].map((i)=>({id:`c${i}`,name:`同事${i}`,roomId:0,deskId:`d${i}`,x:20+i*3,z:20,yaw:0,pot:i<2})),spawn:{x:4,z:4},bossSpawn:{x:42,z:42},patrol:[{x:42,z:42},{x:42,z:32}],width:50,depth:50,validation:[]};
  const query:WorldQuery={roomAt:point=>Math.hypot(point.x-10,point.z-10)<2||Math.hypot(point.x-49,point.z-25)<2?{...world.rooms[0],permanentLight:true}:world.rooms[0],move:(p,d)=>({x:p.x+d.x,z:p.z+d.z}),lineOfSight:()=>true,path:(_,b)=>[{...b}],validPlacement:()=>true,clearance:()=>Infinity,supportHeight:()=>0};
  return {world,query,state:createGame(world)};
}
function reportedJourneyFixture() {
  const {world}=fixture();world.walls.push({id:'report-detour',x:25,z:25,w:.3,d:40,height:2.8,roomId:0});
  world.bossSpawn={x:10,z:40};world.patrol=[{x:10,z:40}];
  const query=makeWorldQuery(world),state=createGame(world),destination={x:40,z:40};
  state.player.pose='standing';runtimeFor(state).nextEnvironment=Infinity;
  state.colleagues[0].reportAt=.05;state.colleagues[0].reportPosition={...destination};
  return {world,query,state,destination};
}
function run(state:GameState,world:WorldDef,query:WorldQuery,seconds:number,patch:Partial<InputFrame>={}) {
  const frames=Math.ceil(seconds*60);
  for(let i=0;i<frames;i++)stepGame(state,{...idle,...patch},Math.min(1/60,seconds-i/60),world,query);
}
function stand(state:GameState){state.player.pose='standing';}
function closeBoss(state:GameState){state.boss.x=state.player.x;state.boss.z=state.player.z+.9;state.boss.yaw=Math.PI;state.boss.path=[];}
function rule(kind:ActiveRule['kind'],targetId:string,remaining=0):ActiveRule{return {id:99,kind,quote:'测试规则',effect:'测试后果',targetId,roomId:0,phase:'warning',remaining,duration:kind==='desk'?20:kind==='pressure'?14:18,age:0};}

describe('single-match objectives and clock',()=>{
  it('starts with no work quota, no clock-in, two conserved pots and ten minutes',()=>{
    const {state}=fixture();expect(state.remaining).toBe(600);expect(state.player.pose).toBe('working');expect(state.clocked).toBe(false);expect(state.pots).toHaveLength(2);expect(new Set(state.pots.map(p=>p.owner)).size).toBe(2);
  });
  it('requires clock-in, holds for the true duration, then requires crossing the opened boundary',()=>{
    const {state,world,query}=fixture();stand(state);
    state.player.x=48.2;state.player.z=25;
    run(state,world,query,4.2,{interact:true,yaw:Math.PI/2});expect(state.openedExits).toEqual([]);expect(state.ending).toBeNull();
    run(state,world,query,.1);
    state.player.x=10;state.player.z=9.2;
    run(state,world,query,1.4,{interact:true});expect(state.clocked).toBe(false);
    run(state,world,query,.11,{interact:true});expect(state.clocked).toBe(true);
    run(state,world,query,.1);state.player.x=48.2;state.player.z=25;
    run(state,world,query,3.9,{interact:true,yaw:Math.PI/2});expect(state.openedExits).toEqual([]);
    run(state,world,query,.12,{interact:true,yaw:Math.PI/2});expect(state.openedExits).toEqual(['exit']);expect(state.ending).toBeNull();
    run(state,world,query,.6,{moveZ:1,yaw:Math.PI/2});expect(state.ending).toBe('escaped');
  });
  it('allows turning the camera during a hold and cancels progress immediately on movement',()=>{
    const {state,world,query}=fixture();stand(state);state.player.x=10;state.player.z=9.2;
    run(state,world,query,.8,{interact:true});run(state,world,query,.3,{interact:true,yaw:Math.PI});expect(state.interaction?.progress).toBeGreaterThan(.7);
    run(state,world,query,.1,{interact:true,moveX:1});expect(state.clocked).toBe(false);expect(state.interaction?.progress).toBe(0);
    run(state,world,query,.1);state.player.x=10;state.player.z=9.2;run(state,world,query,1.51,{interact:true});expect(state.clocked).toBe(true);
  });
  it('limits the last movement step to the actual time remaining at an opened exit',()=>{
    for(const [remaining,gap,ending] of [[.001,.04,'overtime'],[.02,.04,'escaped'],[.001,.002,'escaped']] as const) {
      const {world}=fixture();const query=makeWorldQuery(world),state=createGame(world);stand(state);
      state.clocked=true;state.openedExits.push('exit');state.elapsed=600-remaining;state.remaining=remaining;
      state.player.x=49.75-gap;state.player.z=25;const start=state.player.x;
      stepGame(state,{...idle,moveZ:1,yaw:Math.PI/2},1/60,world,query);
      expect(state.player.x-start).toBeCloseTo(3.1*Math.min(remaining,1/60),6);expect(state.ending).toBe(ending);
    }
  });
  it('ends an already expired match before accepting movement or object input',()=>{
    const {world}=fixture();const query=makeWorldQuery(world),state=createGame(world);stand(state);
    state.elapsed=600;state.remaining=0;state.player.x=25;state.player.z=25;
    const box=state.props.find(prop=>prop.kind==='box')!;box.held=true;state.player.holding=box.id;
    stepGame(state,{...idle,moveZ:1,throwPressed:true},1/60,world,query);
    expect(state.ending).toBe('overtime');expect(state.player.z).toBe(25);expect(state.player.holding).toBe(box.id);
    expect(runtimeFor(state).propFlights.size).toBe(0);
  });
  it('stops at exactly 600 seconds and freezes an already chosen outcome',()=>{
    const {state,world,query}=fixture();state.elapsed=599.96;state.remaining=.04;
    run(state,world,query,.1);expect(state.ending).toBe('overtime');expect(state.elapsed).toBe(600);
    run(state,world,query,5,{moveZ:1});expect(state.ending).toBe('overtime');expect(state.elapsed).toBe(600);
  });
});

describe('perception, warning, capture and chairs',()=>{
  it('waits for observation plus three seconds, then drags back without erasing clock-in',()=>{
    const {state,world,query}=fixture();stand(state);state.clocked=true;closeBoss(state);
    world.patrol=[{...state.boss}];
    run(state,world,query,1.1);expect(state.rules.some(r=>r.kind==='return')).toBe(false);
    run(state,world,query,.2);expect(state.rules.some(r=>r.phase==='warning')).toBe(true);
    run(state,world,query,2.8);expect(state.player.pose).not.toBe('dragged');
    run(state,world,query,1);expect(state.player.pose).toBe('dragged');
    const caughtAt=state.eventLog.find(event=>event.event==='boss:caught')!.time;
    for(let i=0;i<240&&!state.player.sticky;i++)run(state,world,query,1/60);
    expect(state.elapsed-caughtAt).toBeGreaterThanOrEqual(1.98);expect(state.elapsed-caughtAt).toBeLessThanOrEqual(4);
    expect(state.player.sticky).toBe(true);expect(state.clocked).toBe(true);expect(state.catches).toBe(1);expect(state.player.protection).toBeGreaterThan(7.95);expect(state.boss.mode).toBe('leave');
    run(state,world,query,.2,{moveZ:1,crouchPressed:true,jumpPressed:true});expect(state.player.pose).toBe('rolling');expect(state.player.y).toBe(0);
  });
  it('cancels ordinary warning with actual occlusion, and does not track a hidden player',()=>{
    const {state,world,query}=fixture();stand(state);closeBoss(state);world.patrol=[{...state.boss}];
    run(state,world,query,1.3);expect(state.boss.mode).toBe('warning');
    query.lineOfSight=()=>false;run(state,world,query,.1);expect(state.rules.some(r=>r.phase==='warning')).toBe(false);
    const old=state.boss.lastSeen&&{...state.boss.lastSeen};state.player.x=30;state.player.z=30;run(state,world,query,.5);expect(state.boss.lastSeen).toEqual(old);
  });
  it('interrupts the half-second grab when the player enters darkness',()=>{
    const {state,world,query}=fixture();stand(state);closeBoss(state);world.patrol=[{...state.boss}];
    runtimeFor(state).orderActive=true;state.boss.mode='chase';run(state,world,query,.35);expect(state.boss.contactFor).toBeGreaterThan(.3);
    state.lights[0]=false;run(state,world,query,.3);expect(state.player.pose).not.toBe('dragged');expect(state.boss.contactFor).toBe(0);
  });
  it('lets the leader see and pursue across a transparent partition without grabbing through it',()=>{
    const {world}=fixture();world.walls.push({id:'transparent-grab',x:26,z:18.6,w:3,d:.08,height:2.8,roomId:0});
    const query=makeWorldQuery(world),state=createGame(world);stand(state);state.transparentWalls.push('transparent-grab');
    Object.assign(state.player,{x:26,z:19});Object.assign(state.boss,{x:26,z:18.2,yaw:0,mode:'chase'});runtimeFor(state).orderActive=true;
    expect(query.lineOfSight(state.boss,state.player,1.05,state)).toBe(true);
    stepGame(state,idle,1/60,world,query);expect(state.boss.mode).toBe('chase');
    run(state,world,query,.3-1/60);expect(state.boss.lastSeen).toEqual({x:26,z:19});expect(state.boss.contactFor).toBe(0);expect(state.player.pose).toBe('standing');
    let lateral=Math.abs(state.boss.x-26);
    for(let frame=0;frame<480&&state.player.pose!=='dragged';frame++) {
      const previous={x:state.boss.x,z:state.boss.z};stepGame(state,idle,1/60,world,query);
      expect(query.lineOfSight(previous,state.boss,1.05,state,'solid')).toBe(true);
      lateral=Math.max(lateral,Math.abs(state.boss.x-26));
      if(state.boss.contactFor>0)expect(query.lineOfSight(state.boss,state.player,1.05,state,'solid')).toBe(true);
    }
    expect(lateral).toBeGreaterThan(1.7);expect(state.player.pose).toBe('dragged');expect(state.eventLog.some(event=>event.event==='boss:caught')).toBe(true);
  });
  it('applies a completed light switch before a same-frame grab could finish',()=>{
    const {state,world,query}=fixture();stand(state);state.player.x=6;state.player.z=5.4;closeBoss(state);
    world.patrol=[{...state.boss}];runtimeFor(state).orderActive=true;state.boss.mode='chase';state.boss.contactFor=.25;
    run(state,world,query,.25,{interact:true});expect(state.lights[0]).toBe(false);expect(state.player.pose).not.toBe('dragged');expect(state.boss.contactFor).toBe(0);
  });
  it('drags a long generated-world route back within four seconds without crossing walls',()=>{
    for(const seed of [618,42,1030]) {
      const world=generateWorld(seed),query=makeWorldQuery(world),state=createGame(world),station=world.stations[0];
      stand(state);state.player.x=station.x;state.player.z=station.z-.9;state.clocked=true;
      state.boss.x=state.player.x;state.boss.z=state.player.z-.7;state.boss.yaw=0;world.patrol=[{...state.boss},world.spawn];
      runtimeFor(state).orderActive=true;state.boss.mode='chase';
      run(state,world,query,.6);expect(state.player.pose).toBe('dragged');
      const caught=state.eventLog.find(e=>e.event==='boss:caught')!.time;
      for(let i=0;i<250&&!state.player.sticky;i++) {
        const from={x:state.player.x,z:state.player.z};stepGame(state,idle,1/60,world,query);
        expect(query.lineOfSight(from,state.player,1.5,state)).toBe(true);
      }
      const home=deskWorkingPoint(world.desks.find(desk=>desk.home)!);
      expect(state.player.sticky).toBe(true);expect(state.elapsed-caught).toBeLessThanOrEqual(4);expect(Math.hypot(state.player.x-home.x,state.player.z-home.z)).toBeLessThan(.1);expect(state.clocked).toBe(true);
    }
  });
  it('keeps emergency interaction zones bright when the parent room is dark',()=>{
    const {state,world,query}=fixture();stand(state);state.lights[0]=false;state.player.x=10;state.player.z=9.2;
    run(state,world,query,1.51,{interact:true});expect(state.clocked).toBe(true);expect(state.dark).toBe(false);
  });
  it('does not clear explicit evidence by sitting or refresh it from the same action',()=>{
    const {state,world,query}=fixture();stand(state);state.player.x=10;state.player.z=9.2;closeBoss(state);world.patrol=[{...state.boss}];
    run(state,world,query,.3,{interact:true});expect(state.boss.evidenceId).not.toBeNull();const until=state.boss.evidenceUntil;
    run(state,world,query,.6,{interact:true});expect(state.boss.evidenceUntil).toBe(until);
    state.player.pose='working';run(state,world,query,2.1);expect(state.boss.evidenceUntil).toBe(until);
  });
});

describe('pot conservation and delayed reports',()=>{
  it('transfers on contact, keeps burden while held, and returns a miss without duplication',()=>{
    const {state,world,query}=fixture();stand(state);state.player.x=20;state.player.z=19.3;
    run(state,world,query,.3);expect(state.player.potId).not.toBeNull();expect(state.pots).toHaveLength(2);
    stepGame(state,{...idle,potPressed:true},1/60,world,query);run(state,world,query,.31);expect(state.player.potInHand).toBe(true);
    const potId=state.player.potId;stepGame(state,{...idle,throwPressed:true,yaw:Math.PI},1/60,world,query);expect(state.player.potId).toBe(potId);
    run(state,world,query,1.5,{yaw:Math.PI});expect(state.pots.find(p=>p.id===potId)?.phase).toBe('attached');expect(state.player.potId).toBe(potId);expect(new Set(state.pots.map(p=>p.owner)).size).toBe(2);
  });
  it('keeps a rear contact donor from receiving a forward throw with real collision queries',()=>{
    // Browser repro used seed 639334048; preserve its relative positions independently of map generation.
    const {world}=fixture();Object.assign(world.colleagues[0],{x:17,z:21.4});
    const query=makeWorldQuery(world),state=createGame(world);stand(state);
    Object.assign(state.player,{x:16.864,z:20.95,yaw:Math.PI});
    const donor=state.colleagues[0];
    expect(donor).toBeDefined();updateObjects(state,.01,world,query);updateObjects(state,.25,world,query);
    const pot=state.pots.find(item=>item.owner==='player')!;expect(pot).toBeDefined();
    handleObjectInput(state,{...idle,potPressed:true},world,query);updateObjects(state,.3,world,query);
    expect(pot.phase).toBe('held');state.aiming=true;updateObjects(state,.5,world,query);
    expect(pot.owner).toBe('player');expect(state.aimTarget).toContain('没有目标');
    handleObjectInput(state,{...idle,throwPressed:true},world,query);updateObjects(state,.2,world,query);
    for(let frame=0;frame<90;frame++) {
      updateObjects(state,1/60,world,query);expect(pot.owner).toBe('player');expect(state.ending).toBeNull();
    }
    expect(pot.phase).toBe('attached');expect(donor.grudge).toBe(false);
    expect(state.pots).toHaveLength(2);expect(new Set(state.pots.map(item=>item.owner)).size).toBe(2);
  });
  it('hits a close forward colleague without shifting the release past them',()=>{
    for(const separation of [.2,.47,5.95]) {
      const {world}=fixture();const query=makeWorldQuery(world),state=createGame(world);stand(state);
      const pot=state.pots[0];Object.assign(pot,{owner:'player',phase:'held'});
      state.player.x=26;state.player.z=17;state.player.yaw=0;
      state.colleagues[2].x=26;state.colleagues[2].z=17+separation;
      handleObjectInput(state,{...idle,throwPressed:true},world,query);updateObjects(state,.2,world,query);
      for(let frame=0;frame<31&&pot.phase==='flying';frame++)updateObjects(state,1/60,world,query);
      expect(pot.owner).toBe(state.colleagues[2].id);expect(state.colleagues[2].grudge).toBe(true);
    }
  });
  it('does not hit a leader behind the release or an actor beyond the six-metre range',()=>{
    for(const separation of [-.47,6.2]) {
      const {world}=fixture();const query=makeWorldQuery(world),state=createGame(world);stand(state);
      const pot=state.pots[0];Object.assign(pot,{owner:'player',phase:'held'});
      state.player.x=10;state.player.z=15;state.player.yaw=0;state.boss.x=10;state.boss.z=15+separation;
      state.aiming=true;updateObjects(state,0,world,query);expect(state.aimTarget).toContain('没有目标');
      handleObjectInput(state,{...idle,throwPressed:true},world,query);updateObjects(state,.2,world,query);
      for(let frame=0;frame<70;frame++)updateObjects(state,1/60,world,query);
      expect(state.ending).toBeNull();expect(pot.owner).toBe('player');expect(pot.phase).toBe('attached');
    }
  });
  it('checks a nearby target behind a real wall before accepting the enlarged contact radius',()=>{
    const {world}=fixture();world.walls.push({id:'pot-wall',x:26,z:18.2,w:3,d:.2,height:2.8,roomId:0});
    const query=makeWorldQuery(world),state=createGame(world);stand(state);
    const pot=state.pots[0];Object.assign(pot,{owner:'player',phase:'held'});
    state.player.x=26;state.player.z=17;state.player.yaw=0;state.colleagues[2].x=26;state.colleagues[2].z=18.65;
    handleObjectInput(state,{...idle,throwPressed:true},world,query);updateObjects(state,.2,world,query);
    for(let frame=0;frame<70;frame++)updateObjects(state,1/60,world,query);
    expect(pot.owner).toBe('player');expect(pot.phase).toBe('attached');expect(state.colleagues[2].grudge).toBe(false);
  });
  it('makes a fired ending only when the flying pot actually intersects the leader',()=>{
    const {state,world,query}=fixture();stand(state);state.player.x=20;state.player.z=19.3;run(state,world,query,.3);
    stepGame(state,{...idle,potPressed:true},1/60,world,query);run(state,world,query,.31);
    state.player.x=10;state.player.z=10;state.boss.x=10;state.boss.z=13;state.boss.yaw=0;world.patrol=[{x:10,z:13}];
    stepGame(state,{...idle,aim:true},1/60,world,query);expect(state.aimTarget).toContain('辞退');
    stepGame(state,{...idle,throwPressed:true},1/60,world,query);run(state,world,query,.65);expect(state.ending).toBe('fired');
  });
  it('rejects a second pot on an already burdened colleague and retains both owners',()=>{
    const {state,world,query}=fixture();stand(state);state.player.x=20;state.player.z=19.3;run(state,world,query,.3);
    stepGame(state,{...idle,potPressed:true},1/60,world,query);run(state,world,query,.31);
    state.player.x=23;state.player.z=17;const owner=state.player.potId;
    stepGame(state,{...idle,throwPressed:true},1/60,world,query);run(state,world,query,1.5);
    expect(state.colleagues[1].grudge).toBe(true);expect(state.player.potId).toBe(owner);expect(new Set(state.pots.map(p=>p.owner)).size).toBe(2);expect(state.pots).toHaveLength(2);
  });
  it('a wall intercepts a flying pot before a colleague behind it can receive it',()=>{
    const {state,world,query}=fixture();stand(state);state.player.x=20;state.player.z=19.3;run(state,world,query,.3);
    stepGame(state,{...idle,potPressed:true},1/60,world,query);run(state,world,query,.31);
    state.player.x=26;state.player.z=17;
    query.lineOfSight=(a,b)=>!(Math.min(a.z,b.z)<18.5&&Math.max(a.z,b.z)>=18.5);
    stepGame(state,{...idle,throwPressed:true},1/60,world,query);run(state,world,query,1.5);
    expect(state.player.potId).not.toBeNull();expect(state.colleagues[2].grudge).toBe(false);expect(state.pots).toHaveLength(2);
  });
  it('sees through a transparent wall while it still blocks movement, aiming and pot flight',()=>{
    const {world}=fixture();world.walls.push({id:'transparent-test',x:26,z:18.2,w:3,d:.2,height:2.8,roomId:0});
    const query=makeWorldQuery(world),state=createGame(world);stand(state);state.transparentWalls.push('transparent-test');
    state.player.x=26;state.player.z=17;state.player.yaw=0;const target=state.colleagues[2];target.x=26;target.z=19;
    expect(query.lineOfSight(state.player,target,1.15,state)).toBe(true);
    expect(query.move(state.player,{x:0,z:3},.3,1.75,state).z).toBeLessThan(18.2);
    const pot=state.pots[0];Object.assign(pot,{owner:'player',phase:'held'});state.aiming=true;updateObjects(state,0,world,query);
    const aimed=state.aimTarget;handleObjectInput(state,{...idle,throwPressed:true},world,query);updateObjects(state,.2,world,query);
    for(let frame=0;frame<70;frame++)updateObjects(state,1/60,world,query);
    expect(pot.owner).toBe('player');expect(pot.phase).toBe('attached');expect(target.grudge).toBe(false);expect(aimed).toContain('没有目标');
  });
  it('retains a box when all forward drop and throw points are beyond a transparent wall',()=>{
    for(const action of ['drop','throw']) {
      const {world}=fixture();world.walls.push({id:'transparent-test',x:26,z:18,w:3,d:.1,height:2.8,roomId:0});
      const query=makeWorldQuery(world),state=createGame(world);stand(state);state.transparentWalls.push('transparent-test');
      state.player.x=26;state.player.z=17.35;state.player.yaw=0;
      const box=state.props.find(prop=>prop.kind==='box')!;box.held=true;state.player.holding=box.id;
      if(action==='drop')dropHeld(state,world,query);else handleObjectInput(state,{...idle,throwPressed:true},world,query);
      expect(state.player.holding).toBe(box.id);expect(box.held).toBe(true);expect(runtimeFor(state).propFlights.size).toBe(0);
    }
  });
  it('does not perform a physical contact handoff through a transparent wall',()=>{
    const {world}=fixture();world.walls.push({id:'transparent-test',x:20,z:19.65,w:3,d:.08,height:2.8,roomId:0});
    const query=makeWorldQuery(world),state=createGame(world);stand(state);state.transparentWalls.push('transparent-test');
    state.player.x=20;state.player.z=19.3;expect(query.lineOfSight(state.player,state.colleagues[0],1.1,state)).toBe(true);
    updateObjects(state,.01,world,query);expect(state.player.potId).toBeNull();expect(state.pots[0].owner).toBe(state.colleagues[0].id);
  });
  it.each(['prop','light','desk'] as const)('blocks %s interaction through a transparent wall while vision remains clear',(kind)=>{
    const {world}=fixture();
    const point=kind==='prop'?world.props.find(prop=>prop.kind==='box')!:kind==='light'?world.rooms[0].switch:world.desks[0].seat;
    world.walls.push({id:'transparent-interaction',x:point.x,z:point.z-.45,w:3,d:.1,height:2.8,roomId:0});
    const query=makeWorldQuery(world),state=createGame(world);stand(state);state.transparentWalls.push('transparent-interaction');
    Object.assign(state.player,{x:point.x,z:point.z-.9,yaw:0});
    expect(query.lineOfSight(state.player,point,1.3,state)).toBe(true);
    stepGame(state,{...idle,interact:true,interactPressed:true},1/60,world,query);run(state,world,query,.3,{interact:true});
    expect(state.player.holding).toBeNull();expect(state.player.pose).toBe('standing');expect(state.lights[0]).toBe(true);expect(state.interaction).toBeNull();
  });
  it('keeps solid-mode throw rays above a low desk clear while its tabletop remains solid',()=>{
    const {world}=fixture();world.desks.push({id:'throw-desk',x:26,z:19,roomId:0,seat:{x:26,z:18},yaw:0});
    const query=makeWorldQuery(world),state=createGame(world);stand(state);
    state.player.x=26;state.player.z=17;state.player.yaw=0;const target=state.colleagues[2];target.x=26;target.z=21;
    expect(query.lineOfSight(state.player,target,1.15,state,'solid')).toBe(true);
    expect(query.lineOfSight(state.player,target,.75,state,'solid')).toBe(false);
    const pot=state.pots[0];Object.assign(pot,{owner:'player',phase:'held'});
    handleObjectInput(state,{...idle,throwPressed:true},world,query);updateObjects(state,.2,world,query);
    for(let frame=0;frame<31&&pot.phase==='flying';frame++)updateObjects(state,1/60,world,query);
    expect(pot.owner).toBe(target.id);expect(target.grudge).toBe(true);
  });
  it('keeps a newly delivered report through the end of an older search and investigates its long route before timing out',()=>{
    const {world,query,state,destination}=reportedJourneyFixture();
    state.boss.mode='search';state.boss.lastSeen={...world.bossSpawn};state.boss.searchFor=5.9;
    state.boss.evidenceUntil=8;state.boss.evidenceId='earlier-observation';
    const route=query.path(state.boss,destination,state);let length=0,point={x:state.boss.x,z:state.boss.z};
    for(const end of route){length+=Math.hypot(end.x-point.x,end.z-point.z);point=end;}expect(length).toBeGreaterThan(30);
    let accepted=false;
    for(let frame=0;frame<2400&&Math.hypot(state.boss.x-destination.x,state.boss.z-destination.z)>.7;frame++) {
      const before={x:state.boss.x,z:state.boss.z};stepGame(state,idle,1/60,world,query);
      expect(query.lineOfSight(before,state.boss,1.5,state,'solid')).toBe(true);
      if(state.boss.lastSeen?.x===destination.x&&state.boss.lastSeen.z===destination.z)accepted=true;
      if(accepted){expect(state.boss.lastSeen).toEqual(destination);expect(state.boss.searchFor).toBeLessThan(1/60+.001);}
    }
    expect(accepted).toBe(true);expect(Math.hypot(state.boss.x-destination.x,state.boss.z-destination.z)).toBeLessThanOrEqual(.7);
    expect(state.elapsed).toBeGreaterThan(8);expect(state.boss.evidenceUntil).toBe(0);
    run(state,world,query,5);expect(state.boss.mode).toBe('search');run(state,world,query,1.3);
    expect(state.boss.mode).toBe('patrol');expect(state.boss.lastSeen).toBeNull();expect(runtimeFor(state).reports).toEqual([]);
  });
  it('can acquire a genuinely visible player while travelling to a report and pursue after the normal warning',()=>{
    const {world,query,state,destination}=reportedJourneyFixture();run(state,world,query,2);
    expect(state.boss.lastSeen).toEqual(destination);expect(state.boss.mode).toBe('search');
    Object.assign(state.player,{x:state.boss.x+Math.sin(state.boss.yaw)*3,z:state.boss.z+Math.cos(state.boss.yaw)*3});
    expect(query.validPlacement(state.player,.3,state)).toBe(true);const observed={x:state.player.x,z:state.player.z};
    let warned=false;
    for(let frame=0;frame<360&&state.boss.mode!=='chase';frame++) {
      stepGame(state,idle,1/60,world,query);warned ||=state.rules.some(rule=>rule.kind==='return'&&rule.phase==='warning');
    }
    expect(warned).toBe(true);expect(state.boss.mode).toBe('chase');expect(state.boss.lastSeen).toEqual(observed);
    expect(state.boss.lastSeen).not.toEqual(destination);
  });
  it('gives up an unreachable reported point in bounded time and accepts the next report',()=>{
    const {world}=fixture();world.width=16;world.depth=16;world.rooms[0]={...world.rooms[0],x:8,z:8,w:16,d:16};
    world.props=[];world.stations=[];world.exits=[];world.bossSpawn={x:2,z:12};world.patrol=[{x:2,z:12}];
    world.colleagues.forEach((colleague,index)=>Object.assign(colleague,{x:2+index*2,z:8}));
    world.walls.push(...[{x:10,z:12,w:.2,d:4},{x:14,z:12,w:.2,d:4},{x:12,z:10,w:4,d:.2},{x:12,z:14,w:4,d:.2}].map((rect,index)=>({...rect,id:`report-block-${index}`,height:2.8,roomId:0})));
    const query=makeWorldQuery(world),state=createGame(world);runtimeFor(state).nextEnvironment=Infinity;state.player.x=14;state.player.z=4;
    runtimeFor(state).reports.push({x:12,z:12});run(state,world,query,8);
    expect(state.boss.mode).toBe('patrol');expect(state.boss.lastSeen).toBeNull();expect(runtimeFor(state).reports).toEqual([]);
    runtimeFor(state).reports.push({x:2,z:10});run(state,world,query,2);
    expect(Math.hypot(state.boss.x-2,state.boss.z-10)).toBeLessThan(.7);expect(state.boss.mode).toBe('search');
  });
  it('reports a snapshot ten seconds later, never the new hidden position',()=>{
    const {state,world,query}=fixture();stand(state);const colleague=state.colleagues[2];colleague.grudge=true;state.player.x=colleague.x;state.player.z=colleague.z+3;
    run(state,world,query,1.1);expect(colleague.reportAt).not.toBeNull();const reported={...colleague.reportPosition!};
    state.player.x=4;state.player.z=40;state.lights[0]=false;
    run(state,world,query,10.1);expect(state.eventLog.some(e=>e.event===`colleague:reported:${colleague.id}`)).toBe(true);
    expect(state.boss.lastSeen).toEqual(reported);expect(state.boss.lastSeen).not.toEqual({x:4,z:40});
  });
});

describe('environment and locomotion safety',()=>{
  it('pulls a player off a box through a legal elevated segment instead of granting permanent immunity',()=>{
    const {world}=fixture();const query=makeWorldQuery(world),state=createGame(world);stand(state);
    state.player.x=30;state.player.z=25;state.player.y=.55;
    state.boss.x=30;state.boss.z=21;state.boss.yaw=0;
    world.patrol=[{...state.boss}];runtimeFor(state).orderActive=true;state.boss.mode='chase';
    for(let frame=0;frame<120&&state.player.pose!=='dragged';frame++)stepGame(state,idle,.02,world,query);
    expect(state.player.pose).toBe('dragged');expect(state.player.y).toBe(.55);
    for(let frame=0;frame<190&&state.player.pose==='dragged';frame++) {
      stepGame(state,idle,.02,world,query);
      expect(state.player.y).toBeGreaterThanOrEqual(query.supportHeight(state.player,state)-1e-6);
    }
    expect(state.player.sticky).toBe(true);expect(state.player.y).toBe(0);
  });
  it('finishes searching a box-top last-seen position after reaching its legal ground edge',()=>{
    const {world}=fixture();const query=makeWorldQuery(world),state=createGame(world);stand(state);
    state.player.x=4;state.player.z=40;state.boss.x=30;state.boss.z=21;
    state.boss.mode='search';state.boss.lastSeen={x:30,z:25};query.lineOfSight=()=>false;
    run(state,world,query,10);
    expect(state.eventLog.some(event=>event.event==='boss:search-ended')).toBe(true);expect(state.boss.lastSeen).toBeNull();
  });
  it('places held boxes beside actors and leaves the leader able to walk',()=>{
    const {world}=fixture();const query=makeWorldQuery(world),state=createGame(world);stand(state);
    const box=state.props.find(prop=>prop.kind==='box')!;box.held=true;state.player.holding=box.id;
    state.player.x=30;state.player.z=24.1;state.boss.x=30;state.boss.z=25;world.patrol=[{x:30,z:21}];
    expect(dropHeld(state,world,query)).toBe(true);expect(Math.hypot(box.x-state.boss.x,box.z-state.boss.z)).toBeGreaterThan(.7);
    state.player.x=10;state.player.z=40;run(state,world,query,2);expect(state.boss.z).toBeLessThan(24);
  });
  it('rechecks throw landings when any actor has walked into the reserved point',()=>{
    for(const actorId of ['player','boss','colleague']) {
      const {world}=fixture();const query=makeWorldQuery(world),state=createGame(world);stand(state);
      const box=state.props.find(prop=>prop.kind==='box')!;box.held=true;state.player.holding=box.id;state.player.x=30;state.player.z=19;
      handleObjectInput(state,{...idle,throwPressed:true},world,query);
      const flight=runtimeFor(state).propFlights.get(box.id)!;expect(flight).toBeDefined();
      const actor=actorId==='player'?state.player:actorId==='boss'?state.boss:state.colleagues[0];Object.assign(actor,flight.to);
      updateObjects(state,.55,world,query);
      expect(box.y).toBe(0);expect(Math.hypot(box.x-actor.x,box.z-actor.z)).toBeGreaterThan(.7);
      expect(runtimeFor(state).propFlights.has(box.id)).toBe(false);
    }
  });
  it('lands a thrown box beside a wall after the player sprints into its reserved landing point',()=>{
    const world=generateWorld(618),query=makeWorldQuery(world),state=createGame(world);stand(state);
    Object.assign(state.player,{x:2,z:33.1,yaw:0});const box=state.props.find(prop=>prop.kind==='box')!;
    box.held=true;state.player.holding=box.id;handleObjectInput(state,{...idle,throwPressed:true},world,query);
    const destination={...runtimeFor(state).propFlights.get(box.id)!.to};expect(destination.x).toBe(2);expect(destination.z).toBeCloseTo(35.3);
    for(let frame=0;frame<34;frame++)stepGame(state,{...idle,moveZ:1,sprint:true},1/60,world,query);
    run(state,world,query,2);
    expect(box.y).toBe(0);expect(runtimeFor(state).propFlights.has(box.id)).toBe(false);
    expect(Math.hypot(box.x-destination.x,box.z-destination.z)).toBeLessThanOrEqual(1.6);
    expect(Math.hypot(box.x-state.player.x,box.z-state.player.z)).toBeGreaterThan(.7);
    box.held=true;expect(query.validPlacement(box,Math.SQRT2*.275,state)).toBe(true);
    expect(query.lineOfSight(destination,box,.6,state)).toBe(true);box.held=false;
    stepGame(state,{...idle,yaw:Math.atan2(box.x-state.player.x,box.z-state.player.z),interact:true,interactPressed:true},1/60,world,query);
    expect(state.player.holding).toBe(box.id);
  });
  it('lowers a restoring desk beneath a player standing on its top instead of lifting it through them',()=>{
    const {world}=fixture();const query=makeWorldQuery(world),state=createGame(world);stand(state);
    const desk=world.desks[0];state.deskHeights[desk.id]=1.9;state.player.x=desk.x;state.player.z=desk.z;state.player.y=1.9;
    const restoring={...rule('desk',desk.id),phase:'restoring' as const};state.rules.push(restoring);
    stepGame(state,idle,.05,world,query);expect(state.deskHeights[desk.id]).toBeLessThan(1.9);expect(state.player.y).toBeLessThanOrEqual(1.9);
    run(state,world,query,1.5);expect(state.deskHeights[desk.id]).toBeCloseTo(.75);expect(state.player.y).toBeCloseTo(.75,3);
  });
  it('throttles failed ground and edge route searches instead of retrying them every physics frame',()=>{
    const {state,world,query}=fixture();stand(state);state.player.x=10;state.player.z=15;
    state.boss.x=10;state.boss.z=10;state.boss.yaw=0;state.boss.mode='chase';runtimeFor(state).orderActive=true;
    let attempts=0;query.path=()=>{attempts++;return[];};
    run(state,world,query,1);expect(attempts).toBeGreaterThanOrEqual(25);expect(attempts).toBeLessThanOrEqual(50);
  });
  it('maps camera-right D to screen right at both opposite headings',()=>{
    for(const [yaw,expectedSign] of [[0,-1],[Math.PI,1]]) {
      const {state,world,query}=fixture();stand(state);const before=state.player.x;
      run(state,world,query,.25,{moveX:1,yaw});expect((state.player.x-before)*expectedSign).toBeGreaterThan(.7);
    }
  });
  it('lands on a real box top, can jump again, then falls off without becoming embedded',()=>{
    const {world}=fixture();world.spawn={x:27.7,z:25};world.bossSpawn={x:45,z:45};
    const query=makeWorldQuery(world),state=createGame(world);stand(state);
    state.player.x=28.9;state.player.z=25;
    stepGame(state,{...idle,jumpPressed:true,yaw:Math.PI/2},1/60,world,query);
    run(state,world,query,.18,{yaw:Math.PI/2});
    run(state,world,query,.24,{yaw:Math.PI/2,moveZ:1});
    run(state,world,query,.8,{yaw:Math.PI/2});
    expect(state.player.x).toBeGreaterThan(29.425);expect(state.player.y).toBeCloseTo(.55,3);expect(state.player.vy).toBe(0);
    stepGame(state,{...idle,jumpPressed:true,yaw:Math.PI/2},1/60,world,query);expect(state.player.vy).toBeGreaterThan(0);
    run(state,world,query,.5,{moveZ:1,yaw:Math.PI/2});run(state,world,query,.6,{yaw:Math.PI/2});
    expect(state.player.x).toBeGreaterThan(30.6);expect(state.player.y).toBe(0);
    const before=state.player.x;run(state,world,query,.2,{moveZ:1,yaw:Math.PI/2});expect(state.player.x-before).toBeGreaterThan(.5);
  });
  it('keeps exhausted continuous Shift at ordinary speed until some stamina recovers',()=>{
    const {state,world,query}=fixture();stand(state);run(state,world,query,4.1,{moveZ:1,sprint:true});
    const from=state.player.z;run(state,world,query,.5,{moveZ:1,sprint:true});expect(state.player.z-from).toBeCloseTo(3.1*.5,2);
  });
  it('cannot rise or jump under a crawl opening and preserves deliberate crouch',()=>{
    const {state,world,query}=fixture();stand(state);query.clearance=()=>.95;run(state,world,query,.1,{jumpPressed:true});expect(state.player.pose).toBe('crouching');expect(state.player.y).toBe(0);
    state.player.crouchIntent=true;query.clearance=()=>Infinity;run(state,world,query,.1);expect(state.player.pose).toBe('crouching');
  });
  it('cancels cake growth if the announced cake has been picked up',()=>{
    const {state,world,query}=fixture();state.props[0].held=true;state.player.holding=state.props[0].id;state.rules.push(rule('cake','cake'));
    run(state,world,query,.1);expect(state.props[0].large).toBe(false);expect(state.rules.some(r=>r.kind==='cake')).toBe(false);
  });
  it('holds a descending desk safely above a character, then finishes after they leave',()=>{
    const {state,world,query}=fixture();stand(state);state.player.x=4;state.player.z=5.2;state.deskHeights.home=1.9;
    state.rules.push({...rule('desk','home'),phase:'restoring'});run(state,world,query,1);expect(state.deskHeights.home).toBeGreaterThanOrEqual(1.9);expect(state.rules[0]?.effect).toContain('受阻');
    state.player.x=10;run(state,world,query,1);expect(state.deskHeights.home).toBe(.75);expect(state.rules.some(r=>r.kind==='desk')).toBe(false);
  });
  it('uses seeded independent per-match schedules and keeps restarts clean',()=>{
    const a=fixture(),b=fixture();run(a.state,a.world,a.query,36);run(b.state,b.world,b.query,36);
    expect(a.state.rules).toEqual(b.state.rules);expect(a.state.eventLog).toEqual(b.state.eventLog);
    const restarted=createGame(a.world);expect(restarted.elapsed).toBe(0);expect(restarted.clocked).toBe(false);expect(restarted.rules).toEqual([]);expect(restarted.pots).toHaveLength(2);
  });
  it('creates and runs against the real generated world and collision adapter',()=>{
    const world=generateWorld(618),state=createGame(world),query=makeWorldQuery(world);
    stepGame(state,{...idle,interact:true,interactPressed:true,yaw:state.player.yaw},1/60,world,query);
    expect(state.player.pose).toBe('standing');run(state,world,query,10,{moveX:1,yaw:state.player.yaw});
    expect(Number.isFinite(state.player.x)).toBe(true);expect(query.roomAt(state.player)).toBeDefined();expect(state.pots).toHaveLength(2);
  });
});
