import type { GameState, WorldDef } from '../contracts/game';
import { makeWorldQuery, pathLength } from './query';
export interface MapValidation { valid:boolean; failures:string[]; spawnClockDistances:number[]; spawnExitDistances:number[]; exitSeparation:number; routes:number }
export function validateWorld(world:WorldDef,state:GameState):MapValidation {
 const query=makeWorldQuery(world),failures:string[]=[];
 const distance=(a:{x:number;z:number},b:{x:number;z:number})=>{const path=query.path(a,b,state);return path.length?pathLength(a,path):Infinity;};
 const spawnClockDistances=world.stations.map(s=>distance(world.spawn,s));
 const spawnExitDistances=world.exits.map(e=>distance(world.spawn,e));
 const exitSeparation=distance(world.exits[0],world.exits[1]);
 const adjacency=world.rooms.map(()=>[] as number[]);for(const d of world.doors)if(!d.crawl){adjacency[d.a].push(d.b);adjacency[d.b].push(d.a);}
 const hops=(a:number,b:number)=>{const seen=new Set([a]),queue:[[number,number]]=[[a,0]];while(queue.length){const [id,d]=queue.shift()!;if(id===b)return d;for(const n of adjacency[id])if(!seen.has(n)){seen.add(n);queue.push([n,d+1]);}}return Infinity;};
 const spawnRoom=query.roomAt(world.spawn)!.id;
 if(world.rooms.length!==10)failures.push('房间数量不是10');
 if(spawnClockDistances.some(d=>!Number.isFinite(d)||d<24))failures.push('出生至打卡机不足24米或不可达');
 if(world.stations.some(s=>hops(spawnRoom,s.roomId)<3))failures.push('打卡机距离不足3个连接');
 if(spawnExitDistances.some(d=>!Number.isFinite(d)||d<45))failures.push('出生至出口不足45米或不可达');
 if(!Number.isFinite(exitSeparation)||exitSeparation<50)failures.push('两出口之间不足50米或不可达');
 if(world.stations.some(s=>world.exits.some(e=>hops(s.roomId,e.roomId)<2)))failures.push('打卡机至出口不足2个连接');
 if(world.stations.some(s=>adjacency[s.roomId].length<2))failures.push('打卡机存在唯一瓶颈');
 const normalDoors=world.doors.filter(d=>!d.crawl);if(normalDoors.length-world.rooms.length+1<2)failures.push('不足两条独立回路');
 if(normalDoors.some(d=>d.width<1.4))failures.push('门宽不足1.4米');
 for(const room of world.rooms)if(!room.permanentLight&&!Number.isFinite(distance(world.spawn,room.switch)))failures.push(`开关不可达:${room.id}`);
 const home=world.desks.find(d=>d.home)!;if(Math.abs(home.z-home.seat.z)-.425<.9)failures.push('本人座位净空不足0.9米');
 return {valid:failures.length===0,failures,spawnClockDistances,spawnExitDistances,exitSeparation,routes:normalDoors.length-world.rooms.length+1};
}
