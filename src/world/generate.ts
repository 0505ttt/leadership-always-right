import type { ColleagueDef, Desk, Door, Exit, Room, Vec2, Wall, WorldDef } from '../contracts/game';

export function seeded(seed:number) {
 let a=seed>>>0; return ()=>{ a+=0x6D2B79F5; let t=a; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
}
const names=['第二事业部','增长一组','会议室 · 向上','前台','茶水间','总经理室','产品三组','储物间','行政服务','打印中心'];
const kinds=['work','work','meeting','front','tea','boss','work','storage','admin','print'];
interface Layout { cross:number; doorRows:number[][]; home:number; clocks:[number,number]; exits:[number,number] }
// Authored connectivity templates, not unconstrained procedural floor plans. Furniture,
// module roles, door offsets and exterior reflection are chosen reproducibly per seed.
const layouts:Layout[]=[
 {cross:1,doorRows:[[2,16,2,2],[2,16,2,2]],home:3,clocks:[6,7],exits:[0,9]},
 {cross:2,doorRows:[[2,2,16,2],[2,16,2,16]],home:1,clocks:[8,9],exits:[3,5]},
 {cross:3,doorRows:[[2,2,16,2],[2,16,16,2]],home:1,clocks:[7,8],exits:[4,5]},
];
function shuffled<T>(items:T[],random:()=>number):T[]{
 const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;
}

/** Ten room modules; a ladder with three cross-connections creates two independent loops. */
export function generateWorld(seed:number):WorldDef {
 const random=seeded(seed), variation=seeded(seed^0x51f15e), rw=9.6, rd=18;
 // Keep the verified fallback exactly reproducible, including its original RNG sequence.
 const layout=seed===618?undefined:layouts[Math.floor(variation()*layouts.length)];
 const roomNames=[...names],roomKinds=[...kinds];
 if(layout){
  const roles=shuffled([0,2,3,4,5,6,7],variation),slots=shuffled(Array.from({length:10},(_,id)=>id).filter(id=>![layout.home,...layout.clocks].includes(id)),variation);
  for(let i=0;i<slots.length;i++){roomNames[slots[i]]=names[roles[i]];roomKinds[slots[i]]=kinds[roles[i]];}
  for(const [id,role] of [[layout.home,1],[layout.clocks[0],8],[layout.clocks[1],9]]){roomNames[id]=names[role];roomKinds[id]=kinds[role];}
 }
 const local=(roomId:number,x:number,z:number)=>({x:(roomId%5)*rw+x,z:Math.floor(roomId/5)*rd+z});
 const rooms:Room[]=Array.from({length:10},(_,id)=>({id,name:roomNames[id],kind:roomKinds[id],x:(id%5+.5)*rw,z:(Math.floor(id/5)+.5)*rd,w:rw,d:rd,lit:true,permanentLight:roomKinds[id]==='front', switch:{x:(id%5)*rw+.65,z:Math.floor(id/5)*rd+3.3},pressure:layout?roomKinds[id]==='meeting'||roomNames[id]===names[6]:id===2||id===6}));
 const doors:Door[]=[];
 for(let row=0;row<2;row++) for(let col=0;col<4;col++){
  const a=row*5+col,base=(layout?.doorRows[row]??(row===0?[2,2,16,2]:[2,16,2,16]))[col]+row*rd;
  doors.push({id:`door-${a}-${a+1}`,a,b:a+1,x:(col+1)*rw,z:base+(random()-.5)*.35,axis:'z',width:2.2});
 }
 for(const col of [0,layout?.cross??2,4]) doors.push({id:`door-${col}-${col+5}`,a:col,b:col+5,x:col*rw+(col===0?2.4:col===4?7.2:4.8)+(random()-.5)*.4,z:rd,axis:'x',width:2.2});
 for(const col of [1,2,3].filter(col=>col!==(layout?.cross??2))) doors.push({id:`crawl-${col}`,a:col,b:col+5,x:col*rw+(layout&&col===layout.home%5?2.6:4.8),z:rd,axis:'x',width:1.4,crawl:true});
 const exits:Exit[]=layout?layout.exits.map((roomId,index)=>({id:index===0?'exit-east':'exit-west',roomId,...local(roomId,4.8+ (variation()-.5)*.5,roomId<5?.65:17.35),yaw:roomId<5?Math.PI:0,outward:{x:0,z:roomId<5?-1:1}})):[{id:'exit-east',roomId:3,x:33.6,z:.65,yaw:Math.PI,outward:{x:0,z:-1}},{id:'exit-west',roomId:5,x:4.8,z:35.35,yaw:0,outward:{x:0,z:1}}];
 if(layout&&layout.cross!==2&&variation()>.5){
  // Corner modules also permit exits on the perpendicular exterior walls.
  for(const exit of exits){const west=exit.roomId%5===0;exit.x=west?.65:47.35;exit.z=exit.roomId<5?1.4:34.6;exit.yaw=west?-Math.PI/2:Math.PI/2;exit.outward={x:west?-1:1,z:0};}
 }
 const stations=layout?layout.clocks.map((roomId,index)=>({id:index===0?'clock-admin':'clock-print',roomId,...local(roomId,layout.cross===2?(index===0?6.7:7.1):4.8,layout.cross===2?(index===0?15:14.5):15),yaw:0})):[{id:'clock-admin',roomId:8,x:35.5,z:33,yaw:0},{id:'clock-print',roomId:9,x:45.5,z:32.5,yaw:0}];
 const walls:Wall[]=[];
 function split(id:string,x:number,z:number,w:number,d:number,axis:'x'|'z',gaps:{center:number;width:number;crawl?:boolean}[],roomId:number){
  const center=axis==='x'?x:z,length=axis==='x'?w:d;
  let cursor=center-length/2,ordinal=0;
  for(const gap of [...gaps].sort((a,b)=>a.center-b.center)){
   const lo=gap.center-gap.width/2,hi=gap.center+gap.width/2;
   if(lo>cursor+.01){ const mid=(lo+cursor)/2; walls.push({id:`${id}-${ordinal++}`,x:axis==='x'?mid:x,z:axis==='z'?mid:z,w:axis==='x'?lo-cursor:w,d:axis==='z'?lo-cursor:d,height:2.8,roomId}); }
   if(gap.crawl) walls.push({id:`${id}-crawl`,x:axis==='x'?gap.center:x,z:axis==='z'?gap.center:z,w:axis==='x'?gap.width:w,d:axis==='z'?gap.width:d,height:2.8,roomId,crawl:true});
   cursor=hi;
  }
  const end=center+length/2;if(cursor<end-.01){ const mid=(cursor+end)/2;walls.push({id:`${id}-${ordinal}`,x:axis==='x'?mid:x,z:axis==='z'?mid:z,w:axis==='x'?end-cursor:w,d:axis==='z'?end-cursor:d,height:2.8,roomId}); }
 }
 for(let col=1;col<5;col++)for(let row=0;row<2;row++){
  const a=row*5+col-1,door=doors.find(d=>d.a===a&&d.b===a+1)!;
  split(`wall-v${row}-${col}`,col*rw,row*rd+rd/2,.18,rd,'z',[{center:door.z,width:door.width}],a);
 }
 for(let col=0;col<5;col++){
  const door=doors.find(d=>d.a===col&&d.b===col+5)!;
  split(`wall-h${col}`,col*rw+rw/2,rd,rw,.18,'x',[{center:door.x,width:door.width,crawl:door.crawl}],col);
 }
 split('north',24,0,48,.24,'x',exits.filter(e=>e.outward.z<0).map(e=>({center:e.x,width:2.4})),exits[0].roomId);
 split('south',24,36,48,.24,'x',exits.filter(e=>e.outward.z>0).map(e=>({center:e.x,width:2.4})),exits[1].roomId);
  if(exits.some(e=>e.outward.x)){
  split('west',0,18,.24,36,'z',exits.filter(e=>e.outward.x<0).map(e=>({center:e.z,width:2.4})),0);
  split('east',48,18,.24,36,'z',exits.filter(e=>e.outward.x>0).map(e=>({center:e.z,width:2.4})),4);
 }else walls.push({id:'west',x:0,z:18,w:.24,d:36,height:2.8,roomId:0},{id:'east',x:48,z:18,w:.24,d:36,height:2.8,roomId:4});
 // Short partitions have room around both ends. Their exact solids are shared by renderer, LOS and collision.
 for(const id of layout?[layout.home===3?4:0,...shuffled(rooms.filter(r=>r.id!==layout.home&&r.id!==(layout.home===3?4:0)).map(r=>r.id),variation).slice(0,3)]:[0,2,6,7]){const r=rooms[id];walls.push({id:`partition-${id}`,x:r.x-1,z:r.z+1,w:3.2,d:.16,height:2.2,roomId:id,partition:true});}
 const desks:Desk[]=layout?[{id:'home',roomId:layout.home,...local(layout.home,4.8,17.4),seat:local(layout.home,4.8,16),yaw:0,home:true}]:[{id:'home',roomId:1,x:14.4,z:16.45,seat:{x:14.4,z:15.05},yaw:0,home:true}];
 if(layout){
  // Fixed safe furniture slots leave all door approaches and a 1.8 m main aisle free.
  const workrooms=rooms.filter(r=>r.kind==='work').map(r=>r.id);
  const staffRooms=shuffled([...workrooms,...workrooms,rooms.find(r=>r.kind==='boss')!.id],variation).slice(0,6);
  const used=new Map<number,number>();
  for(const id of staffRooms){const slot=used.get(id)??0;used.set(id,slot+1);const p=local(id,slot===0?6.7:2.5,slot===0?6:12.5);desks.push({id:`desk-${desks.length}`,roomId:id,...p,seat:{x:p.x,z:p.z-1.2},yaw:0});}
 }else for(const [id,x,z] of [[1,17,15.8],[0,5.7,7],[6,15,25],[6,17,31],[5,5.6,27],[8,32,25]] as const) desks.push({id:`desk-${desks.length}`,roomId:id,x,z,seat:{x,z:z-1.2},yaw:0});
 const colleagues:ColleagueDef[]=(layout?shuffled([1,2,3,4,5,6],variation).slice(0,4):[1,2,3,4]).map((di,i)=>{const d=desks[di];return {id:`colleague-${i}`,name:['小周','老陈','小林','阿许'][i],deskId:d.id,roomId:d.roomId,x:d.seat.x,z:d.seat.z,yaw:0,pot:i<2};});
 const props=layout?shuffled(rooms.filter(r=>r.id!==layout.home),variation).slice(0,4).map((r,index)=>({id:index<2?`cake-${index}`:`box-${index-2}`,kind:index<2?'cake' as const:'box' as const,roomId:r.id,...local(r.id,6.8,11.8)})):[{id:'cake-0',kind:'cake' as const,roomId:2,x:26.4,z:10.8},{id:'cake-1',kind:'cake' as const,roomId:7,x:26.6,z:26},{id:'box-0',kind:'box' as const,roomId:7,x:21.5,z:30},{id:'box-1',kind:'box' as const,roomId:4,x:41,z:8}];
 const world:WorldDef={seed,rooms,walls,doors,desks,stations,exits,props,colleagues,spawn:{...desks[0].seat},bossSpawn:layout?local(rooms.find(r=>r.kind==='boss')!.id,7,8):{x:6,z:26},patrol:layout?shuffled(rooms,variation).map(r=>local(r.id,7.3,8)):[{x:5,z:26},{x:15,z:23},{x:25,z:26},{x:35,z:32},{x:45,z:31},{x:45,z:8},{x:33,z:7},{x:24,z:7},{x:14,z:6},{x:5,z:6}],width:48,depth:36,validation:[]};
 // Reflection varies exterior walls/route direction without changing legal dimensions or topology.
 const mirrorX=random()>.5,mirrorZ=random()>.5;
 const point=(p:Vec2)=>{if(mirrorX)p.x=48-p.x;if(mirrorZ)p.z=36-p.z;};
 const facing=(v:{yaw:number})=>{if(mirrorX)v.yaw=-v.yaw;if(mirrorZ)v.yaw=Math.PI-v.yaw;};
 for(const r of rooms){point(r);point(r.switch);}
 for(const w of walls)point(w);for(const d of doors)point(d);
 for(const d of desks){point(d);point(d.seat);facing(d);}
 for(const c of colleagues){point(c);facing(c);}for(const p of props)point(p);
 for(const p of stations){point(p);facing(p);}
 for(const e of exits){point(e);facing(e);if(mirrorX)e.outward.x*=-1;if(mirrorZ)e.outward.z*=-1;}
 point(world.spawn);point(world.bossSpawn);world.patrol.forEach(point);
 world.validation=[layout?`连接模板：中间横联${layout.cross}`:'备用布局618','10个模块','两条独立回路/三处横向连接','两处可选蹲洞','门净宽2.2米','主路线无台阶'];
 return world;
}
