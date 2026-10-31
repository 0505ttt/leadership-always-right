import type { GameState, Vec2, WorldDef, WorldQuery } from '../contracts/game';
import { makeWorldQuery, pathLength, switchOperatingPoint } from './query';

export interface MapValidation {
 valid:boolean;
 failures:string[];
 spawnClockDistances:number[];
 spawnExitDistances:number[];
 exitSeparation:number;
 routes:number;
}

/** Validate the graph and the actual collision routes; crawlways never count as required routes. */
export function validateWorld(world:WorldDef,state:GameState,query:WorldQuery=makeWorldQuery(world)):MapValidation {
 const failures:string[]=[];
 const normalDoors=world.doors.filter(door=>!door.crawl);
 const adjacency=new Map(world.rooms.map(room=>[room.id,[] as {id:number;door:string}[]]));
 const duplicateIds=new Set(world.rooms.map(room=>room.id)).size!==world.rooms.length;
 if(world.rooms.length!==10||duplicateIds)failures.push('房间数量不是10或ID重复');
 const counts=new Map<string,number>();
 for(const room of world.rooms)counts.set(room.kind,(counts.get(room.kind)??0)+1);
 if(counts.get('work')!==3||['meeting','tea','print','storage','front','admin','boss'].some(kind=>counts.get(kind)!==1))failures.push('房间模块类型不符合V3');
 for(const door of normalDoors){
  if(door.a===door.b||!adjacency.has(door.a)||!adjacency.has(door.b)){failures.push(`门连接无效:${door.id}`);continue;}
  adjacency.get(door.a)!.push({id:door.b,door:door.id});
  adjacency.get(door.b)!.push({id:door.a,door:door.id});
 }
 const hops=(a:number,b:number,omittedDoor?:string,omittedRoom?:number)=>{
  const seen=new Set([a]),queue:[number,number][]=[[a,0]];
  for(let index=0;index<queue.length;index++){
   const [id,depth]=queue[index];if(id===b)return depth;
   for(const next of adjacency.get(id)??[])if(next.door!==omittedDoor&&next.id!==omittedRoom&&!seen.has(next.id)){seen.add(next.id);queue.push([next.id,depth+1]);}
  }
  return Infinity;
 };
 const spawnRoom=query.roomAt(world.spawn)?.id;
 const home=world.desks.find(desk=>desk.home);
 if(spawnRoom===undefined)failures.push('出生点不在房间内');
 if(world.desks.filter(desk=>desk.home).length!==1)failures.push('本人座位必须恰好一个');
 if(world.stations.length!==1)failures.push('必须恰有一台全局打卡机');
 if(world.exits.length!==2)failures.push('必须有两个出口');
 const distance=(a:Vec2,b:Vec2)=>{const path=query.path(a,b,state);return path.length?pathLength(a,path):Infinity;};
 const spawnClockDistances=world.stations.map(station=>distance(world.spawn,station));
 const spawnExitDistances=world.exits.map(exit=>distance(world.spawn,exit));
 const exitSeparation=world.exits.length===2?distance(world.exits[0],world.exits[1]):Infinity;
 if(spawnClockDistances.some(d=>!Number.isFinite(d)||d<24))failures.push('出生至打卡机不足24米或不可达');
 if(spawnExitDistances.some(d=>!Number.isFinite(d)||d<45))failures.push('出生至出口不足45米或不可达');
 if(!Number.isFinite(exitSeparation)||exitSeparation<50)failures.push('两出口之间不足50米或不可达');
 if(spawnRoom!==undefined){
  if(world.rooms.some(room=>!Number.isFinite(hops(spawnRoom,room.id))))failures.push('普通门连接图不连通');
  if(world.stations.some(station=>{const n=hops(spawnRoom,station.roomId);return !Number.isFinite(n)||n<3;}))failures.push('打卡机距离不足3个连接或不可达');
  // Degree >= 2 alone misses a bridge between two cyclic regions. Remove each edge
  // to prove that no mandatory objective depends on one normal-door bottleneck.
  const required=[...world.stations,...world.exits];
  if(normalDoors.some(door=>required.some(target=>!Number.isFinite(hops(spawnRoom,target.roomId,door.id)))))failures.push('必需目标存在唯一门瓶颈');
  if(world.rooms.some(room=>room.id!==spawnRoom&&required.some(target=>target.roomId!==room.id&&!Number.isFinite(hops(spawnRoom,target.roomId,undefined,room.id)))))failures.push('必需目标存在唯一房间瓶颈');
 }
 if(world.stations.some(station=>world.exits.some(exit=>{const n=hops(station.roomId,exit.roomId);return !Number.isFinite(n)||n<2;})))failures.push('打卡机至出口不足2个连接或不可达');
 const routes=normalDoors.length-world.rooms.length+1;
 if(routes<2)failures.push('不足两条独立回路');
 if(normalDoors.some(door=>door.width<2.2))failures.push('普通门净宽不足2.2米');
 for(const door of normalDoors){
  const a={x:door.x+(door.axis==='z'?-.8:0),z:door.z+(door.axis==='x'?-.8:0)};
  const delta={x:door.axis==='z'?1.6:0,z:door.axis==='x'?1.6:0};
  const b=query.move(a,delta,.3,1.42,state);
  if(Math.hypot(b.x-(a.x+delta.x),b.z-(a.z+delta.z))>.01)failures.push(`滚椅无法穿门:${door.id}`);
 }
 const crawlways=world.doors.filter(door=>door.crawl);
 if(crawlways.length!==2||crawlways.some(door=>query.clearance(door,state)!==.95))failures.push('可选0.95米检修短道规格不符');
 for(const door of crawlways){
  const start={x:door.x+(door.axis==='z'?-.8:0),z:door.z+(door.axis==='x'?-.8:0)},delta={x:door.axis==='z'?1.6:0,z:door.axis==='x'?1.6:0};
  const end=query.move(start,delta,.3,.9,state);
  if(Math.hypot(end.x-(start.x+delta.x),end.z-(start.z+delta.z))>.01)failures.push(`蹲姿无法穿短道:${door.id}`);
 }
 for(const room of world.rooms){const point=switchOperatingPoint(room);if(!Number.isFinite(distance(world.spawn,point))||!query.lineOfSight(point,room.switch,1.12,state,'solid'))failures.push(`开关不可达:${room.id}`);}
 if(home){
  if(Math.abs(home.z-home.seat.z)-.425<.9)failures.push('本人座位净空不足0.9米');
  if(!Number.isFinite(distance(world.spawn,home.seat)))failures.push('本人座位无法接入主路');
 }
 // Every room switch was already connected to spawn; use it as a local anchor
 // instead of running ten more whole-building A* searches during startup.
 const locallyConnected=(point:Vec2)=>{const room=query.roomAt(point);return !!room&&Number.isFinite(distance(point,switchOperatingPoint(room)));};
 if(!locallyConnected(world.bossSpawn))failures.push('领导出生点无法接入主路');
 for(const waypoint of world.patrol)if(!locallyConnected(waypoint)){failures.push('巡逻点无法接入主路');break;}
 return {valid:failures.length===0,failures,spawnClockDistances,spawnExitDistances,exitSeparation,routes};
}
