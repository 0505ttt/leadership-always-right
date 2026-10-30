import { describe,it,expect } from 'vitest';
import type { Vec2 } from '../src/contracts/game';
import { createGame } from '../src/rules/game';
import { generateWorld } from '../src/world/generate';
import { makeWorldQuery, segmentRect } from '../src/world/query';
import { validateWorld } from '../src/world/validate';
describe('V3 offices',()=>{
 for(const seed of [0,1,2,3,4,5,42,618,666,2026,1030,99999,0xffffffff])it(`seed ${seed} has two routes and all objective clearances`,()=>{const w=generateWorld(seed),s=createGame(w),r=validateWorld(w,s);expect(r.failures,JSON.stringify(r)).toEqual([]);expect(generateWorld(seed)).toEqual(w);});
 it('chair crosses every normal door without walking through the wall',()=>{const w=generateWorld(618),s=createGame(w),q=makeWorldQuery(w);for(const d of w.doors.filter(d=>!d.crawl)){const a={x:d.x+(d.axis==='z'?-.8:0),z:d.z+(d.axis==='x'?-.8:0)},delta={x:d.axis==='z'?1.6:0,z:d.axis==='x'?1.6:0};const b=q.move(a,delta,.3,1.42,s);expect(Math.hypot(b.x-a.x,b.z-a.z)).toBeGreaterThan(1.5);}});
 it('crawlways permit crouch but block chair; overhead prevents standing inside',()=>{const w=generateWorld(618),s=createGame(w),q=makeWorldQuery(w),d=w.doors.find(d=>d.crawl)!;const a={x:d.x,z:d.z-.8};expect(q.move(a,{x:0,z:1.6},.3,.9,s).z).toBeCloseTo(d.z+.8);expect(q.move(a,{x:0,z:1.6},.3,1.42,s).z).toBeLessThan(d.z);expect(q.clearance(d,s)).toBe(.95);});
 it('raised desk opens the actual air underneath, and a jump clears a low box',()=>{const w=generateWorld(618),s=createGame(w),q=makeWorldQuery(w),d=w.desks[0];s.deskHeights[d.id]=1.9;expect(q.lineOfSight({x:d.x-1.1,z:d.z},{x:d.x+1.1,z:d.z},1.5,s)).toBe(true);const p=s.props.find(p=>p.kind==='box')!;const a={x:p.x-1,z:p.z};expect(q.move(a,{x:2,z:0},.3,1.75,s,.65).x).toBeCloseTo(p.x+1);expect(q.move(a,{x:2,z:0},.3,1.75,s,0).x).toBeLessThan(p.x);});
 it('A* path segments stay out of walls even on a long capture route',()=>{const w=generateWorld(618),s=createGame(w),q=makeWorldQuery(w);let p:Vec2={...w.stations[1]};const path=q.path(p,w.spawn,s);expect(path.length).toBeGreaterThan(3);for(const end of path){for(const wall of w.walls)expect(segmentRect(p,end,wall,.3)).toBe(false);p=end;}});
});

describe('tight clearance regressions',()=>{
 it('allows an actor touching a wall to enter and leave the navigation graph',()=>{const w=generateWorld(618),s=createGame(w),q=makeWorldQuery(w);for(const x of [.42,.43,.45]){const edge={x,z:10},open={x:3,z:10};expect(q.validPlacement(edge,.3,s)).toBe(true);expect(q.path(edge,open,s).length).toBeGreaterThan(0);expect(q.path(open,edge,s).length).toBeGreaterThan(0);}});
});

it('navigation admits legal circular positions around door-frame corners',()=>{const w=generateWorld(989494184),s=createGame(w),q=makeWorldQuery(w),p={x:18.927146,z:20.813904};expect(q.path(p,w.spawn,s).length).toBeGreaterThan(0);expect(q.path(w.spawn,p,s).length).toBeGreaterThan(0);});

describe('seeded module templates',()=>{
 it('varies connectivity, room functions, objective nodes, exterior sides and occupants across 128 seeds including the unsigned 32-bit range',async()=>{
  const topology=new Set<string>(),roles=new Set<string>(),stations=new Set<string>(),exitAxes=new Set<string>(),props=new Set<string>(),staff=new Set<string>();
  let clockMin=Infinity,exitMin=Infinity,separationMin=Infinity;
  const seeds=[...Array.from({length:64},(_,i)=>i+1),...Array.from({length:64},(_,i)=>((i+1)*2654435761)>>>0)];
  for(const [index,seed] of seeds.entries()){
   // Keep Vitest's worker RPC responsive during the CPU-heavy batch under machine load.
   if(index%8===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
   const world=generateWorld(seed),state=createGame(world),report=validateWorld(world,state);
   expect(report.failures,`seed ${seed}: ${JSON.stringify(report)}`).toEqual([]);
   expect(generateWorld(seed)).toEqual(world);
   topology.add(world.doors.filter(d=>!d.crawl).map(d=>`${d.a}-${d.b}`).sort().join(','));
   roles.add(world.rooms.map(r=>r.kind).join(','));
   stations.add(world.stations.map(s=>s.roomId).join(','));
   exitAxes.add(world.exits.map(e=>e.outward.x?'x':'z').join(','));
   props.add(world.props.map(p=>p.roomId).join(','));
   staff.add(world.colleagues.map(c=>`${c.roomId}:${c.deskId}`).join(','));
   clockMin=Math.min(clockMin,...report.spawnClockDistances);exitMin=Math.min(exitMin,...report.spawnExitDistances);separationMin=Math.min(separationMin,report.exitSeparation);
  }
  expect(topology.size).toBe(3);expect(roles.size).toBeGreaterThan(40);expect(stations.size).toBe(3);expect(exitAxes.size).toBe(2);expect(props.size).toBeGreaterThan(40);expect(staff.size).toBeGreaterThan(40);
  console.info('128-seed map audit',JSON.stringify({topologies:topology.size,roomAssignments:roles.size,stationPairs:stations.size,exitAxes:exitAxes.size,propDistributions:props.size,staffDistributions:staff.size,clockMin,exitMin,separationMin}));
 },120_000);
 it('keeps chair paths to every mandatory target while both cakes are enlarged',()=>{
  for(const seed of [1,2,3,42,618,2026]){
   const world=generateWorld(seed),state=createGame(world),query=makeWorldQuery(world);
   for(const cake of state.props.filter(p=>p.kind==='cake'))cake.scale=3;
   state.pressureRooms=world.rooms.filter(r=>r.pressure).map(r=>r.id);
   for(const target of [...world.stations,...world.exits]){
    const path=query.path(world.spawn,target,state);expect(path.length,`seed ${seed}, ${target.id}`).toBeGreaterThan(0);
    let p={...world.spawn};
    for(const next of path){const moved=query.move(p,{x:next.x-p.x,z:next.z-p.z},.3,1.42,state);expect(Math.hypot(moved.x-next.x,moved.z-next.z),`seed ${seed}, ${target.id}`).toBeLessThan(.01);p=moved;}
   }
  }
 },30_000);
 it('rejects a bridge between two cycles even when every station has two neighboring rooms',()=>{
  const world=generateWorld(618),edges=[[0,1],[1,2],[2,0],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,3],[2,3]];
  world.doors.filter(d=>!d.crawl).forEach((door,index)=>{[door.a,door.b]=edges[index];});
  expect(validateWorld(world,createGame(world)).failures).toContain('必需目标存在唯一门瓶颈');
 });
 it('rejects two cycles sharing a single mandatory transit room',()=>{
  const world=generateWorld(618),edges=[[0,1],[1,2],[2,3],[3,0],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,3]];
  world.doors.filter(d=>!d.crawl).forEach((door,index)=>{[door.a,door.b]=edges[index];});
  expect(validateWorld(world,createGame(world)).failures).toContain('必需目标存在唯一房间瓶颈');
 });
 it('rejects missing module roles and undersized chair doors',()=>{
  const world=generateWorld(618);world.rooms.find(r=>r.kind==='tea')!.kind='work';world.doors[0].width=2.1;
  const report=validateWorld(world,createGame(world));expect(report.failures).toContain('房间模块类型不符合V3');expect(report.failures).toContain('普通门净宽不足2.2米');
 });
});
