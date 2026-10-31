import { describe,expect,it } from 'vitest';
import type { Vec2,Wall,WorldDef } from '../src/contracts/game';
import { createGame } from '../src/rules/game';
import { generateWorld } from '../src/world/generate';
import { makeWorldQuery } from '../src/world/query';

const seeds=[1,2,3,42,2026,99999];
const gap=(a:Vec2,b:Vec2)=>Math.hypot(a.x-b.x,a.z-b.z);

function aisleQuery(world:WorldDef,width:number){
 // The production navigator uses a 0.3 m actor radius. Inflate every static
 // solid by the extra radius to conservatively check the wider main aisle.
 const extra=width/2-.3;
 const walls:Wall[]=world.walls.map(wall=>({...wall,w:wall.w+extra*2,d:wall.d+extra*2}));
 for(const desk of world.desks)walls.push({id:desk.id,roomId:desk.roomId,x:desk.x,z:desk.z,w:1.6+extra*2,d:.85+extra*2,height:2.8});
 for(const prop of world.props)walls.push({id:prop.id,roomId:prop.roomId,x:prop.x,z:prop.z,w:(prop.kind==='box'?.55:.6)+extra*2,d:(prop.kind==='box'?.55:.6)+extra*2,height:2.8});
 const expanded={...world,walls,desks:[],props:[]},state=createGame(expanded);
 return {query:makeWorldQuery(expanded),state};
}

describe('functional office density',()=>{
 for(const seed of seeds)it(`seed ${seed} has accessible desks, occupants, props and inspection stops`,async()=>{
  const world=generateWorld(seed),state=createGame(world),query=makeWorldQuery(world);
  expect(world.desks).toHaveLength(21);expect(world.colleagues).toHaveLength(7);expect(state.pots).toHaveLength(2);
  expect(world.props.filter(p=>p.kind==='cake')).toHaveLength(5);expect(world.props.filter(p=>p.kind==='box')).toHaveLength(4);
  expect(new Set(world.colleagues.map(c=>c.deskId)).size).toBe(7);
  for(const room of world.rooms.filter(r=>r.kind==='work')){
   expect(world.desks.filter(d=>d.roomId===room.id&&!d.home)).toHaveLength(6);
   expect(world.colleagues.filter(c=>c.roomId===room.id)).toHaveLength(2);
  }
  for(const [index,desk] of world.desks.entries()){
   if(index%4===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
   const room=world.rooms.find(r=>r.id===desk.roomId)!,control=room.switch;
   const approach={x:control.x+Math.sin(control.yaw??0)*.65,z:control.z+Math.cos(control.yaw??0)*.65};
   const path=query.path(approach,desk.seat,state);
   expect(path.length,desk.id).toBeGreaterThan(0);
   expect(gap(path[path.length-1],desk.seat),desk.id).toBeLessThan(.01);
  }
  for(const [index,person] of world.colleagues.entries())for(const other of world.colleagues.slice(index+1))expect(gap(person,other)).toBeGreaterThan(1);
  for(const prop of world.props){
   const approaches=[{x:prop.x-1,z:prop.z},{x:prop.x+1,z:prop.z},{x:prop.x,z:prop.z-1},{x:prop.x,z:prop.z+1}];
   expect(approaches.some(p=>query.path(world.spawn,p,state).length>0),prop.id).toBe(true);
  }
  expect(world.stations.some(station=>gap(station,world.bossSpawn)<1.1)).toBe(true);expect(gap(world.bossSpawn,world.spawn)).toBeGreaterThan(8);
  expect(world.patrol[0]).toEqual(world.bossSpawn);
  for(const objective of [...world.stations,...world.exits])expect(world.patrol.some(p=>gap(p,objective)<1.1),objective.id).toBe(true);
  for(const room of world.rooms.filter(r=>r.kind==='work'))expect(world.patrol.some(p=>query.roomAt(p)?.id===room.id&&world.desks.some(d=>d.roomId===room.id&&gap(p,d.seat)<2))).toBe(true);
  for(let i=0;i<world.patrol.length;i++)expect(query.path(world.patrol[i],world.patrol[(i+1)%world.patrol.length],state).length).toBeGreaterThan(0);
 },60_000);
 for(const seed of seeds)it(`seed ${seed} keeps 1.8 m main routes and a 1.4 m home-seat connection`,async()=>{
  const world=generateWorld(seed),wide=aisleQuery(world,1.8),home=aisleQuery(world,1.4);
  const targets=[...world.stations.map(s=>({x:s.x+Math.sin(s.yaw)*.95,z:s.z+Math.cos(s.yaw)*.95})),...world.exits.map(e=>({x:e.x-e.outward.x*.95,z:e.z-e.outward.z*.95}))];
  for(const target of targets){
   await new Promise<void>(resolve=>setTimeout(resolve,0));
   expect(wide.query.path(world.spawn,target,wide.state).length,`seed ${seed} spawn=${JSON.stringify(world.spawn)} target=${JSON.stringify(target)}`).toBeGreaterThan(0);
   expect(home.query.path(target,world.spawn,home.state).length,`seed ${seed} spawn=${JSON.stringify(world.spawn)} target=${JSON.stringify(target)}`).toBeGreaterThan(0);
  }
 },60_000);
 it('keeps the fallback furniture layout with the new intro cake',()=>{
  const world=generateWorld(618);expect(world.desks).toHaveLength(7);expect(world.colleagues).toHaveLength(4);expect(world.props).toHaveLength(6);expect(world.props.filter(prop=>prop.kind==='bed')).toHaveLength(1);expect(world.patrol).toHaveLength(10);
 });
});
