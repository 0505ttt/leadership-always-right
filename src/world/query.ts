import type { GameState, Rect, Vec2, WorldDef, WorldQuery } from '../contracts/game';
const navigationDirections=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const;
export const distance=(a:Vec2,b:Vec2)=>Math.hypot(a.x-b.x,a.z-b.z);
export function inside(p:Vec2,r:Rect,pad=0){return Math.abs(p.x-r.x)<r.w/2+pad&&Math.abs(p.z-r.z)<r.d/2+pad;}
export function circleHitsRect(p:Vec2,r:Rect,radius:number){const dx=Math.max(Math.abs(p.x-r.x)-r.w/2,0),dz=Math.max(Math.abs(p.z-r.z)-r.d/2,0);return dx*dx+dz*dz<radius*radius;}
export function segmentRect(a:Vec2,b:Vec2,r:Rect,pad=0):boolean {
 // Minkowski sum with a circle: square-expanded corners would reject legal actor positions.
 if(pad>0){
  if(segmentRect(a,b,{...r,w:r.w+pad*2},0)||segmentRect(a,b,{...r,d:r.d+pad*2},0))return true;
  const dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;
  for(const sx of [-1,1])for(const sz of [-1,1]){const cx=r.x+sx*r.w/2,cz=r.z+sz*r.d/2;const t=length2?Math.max(0,Math.min(1,((cx-a.x)*dx+(cz-a.z)*dz)/length2)):0;if((a.x+t*dx-cx)**2+(a.z+t*dz-cz)**2<=pad*pad)return true;}
  return false;
 }
 let low=0,high=1;
 for(const axis of ['x','z'] as const){const half=(axis==='x'?r.w:r.d)/2+pad,min=r[axis]-half,max=r[axis]+half,d=b[axis]-a[axis];if(Math.abs(d)<1e-8){if(a[axis]<min||a[axis]>max)return false;}else{let t1=(min-a[axis])/d,t2=(max-a[axis])/d;if(t1>t2)[t1,t2]=[t2,t1];low=Math.max(low,t1);high=Math.min(high,t2);if(low>high)return false;}}
 return true;
}
export function makeWorldQuery(world:WorldDef):WorldQuery {
 let navigationCache:{width:number;depth:number;rects:Rect[];cells:Int8Array}|undefined;
 const roomAt=(p:Vec2)=>{const r=world.rooms.find(r=>inside(p,r,.01));if(!r)return undefined;return [...world.stations,...world.exits].some(s=>s.roomId===r.id&&distance(s,p)<=2.25)?{...r,permanentLight:true}:r;};
 function solids(height:number,state:GameState,vision=false,feet=0):Rect[]{
  const rows:Rect[]=world.walls.filter(w=>w.height>feet&&!(w.crawl&&height+feet<=.95)&&!(vision&&state.transparentWalls.includes(w.id)));
  for(const e of world.exits)if(!state.openedExits.includes(e.id)) rows.push({x:e.x+e.outward.x*.65,z:e.z+e.outward.z*.65,w:e.outward.x? .2:2.4,d:e.outward.z?.2:2.4});
  for(const d of world.desks){const h=state.deskHeights[d.id]??.75;if(vision?Math.abs(height-h)<.13:height+feet>h-.12&&feet<h+.08)rows.push({x:d.x,z:d.z,w:1.6,d:.85});}
  for(const p of state.props){if(p.held||(p.y??0)>.15)continue;const size=p.kind==='box'?.55:.6*p.scale;if(vision?height<(p.kind==='box'?.62:.4*p.scale):feet<(p.kind==='box'?.55:.4*p.scale))rows.push({x:p.x,z:p.z,w:size,d:size});}
  return rows;
 }
 function free(p:Vec2,radius:number,height:number,state:GameState,feet=0){
  if(p.x<radius||p.x>world.width-radius||p.z<radius||p.z>world.depth-radius){
   const exiting=world.exits.some(e=>state.openedExits.includes(e.id)&&Math.abs((p.x-e.x)*e.outward.z+(p.z-e.z)*e.outward.x)<1.1&&distance(p,e)<3);
   if(!exiting)return false;
  }
  for(const r of solids(height,state,false,feet)){const dx=Math.max(Math.abs(p.x-r.x)-r.w/2,0),dz=Math.max(Math.abs(p.z-r.z)-r.d/2,0);if(dx*dx+dz*dz<radius*radius-1e-8)return false;}
  return true;
 }
 const query:WorldQuery={roomAt,
  move(p,delta,radius,height,state,feet=0){let out={x:p.x,z:p.z};const steps=Math.max(1,Math.ceil(Math.hypot(delta.x,delta.z)/.12));const dx=delta.x/steps,dz=delta.z/steps;for(let i=0;i<steps;i++){const both={x:out.x+dx,z:out.z+dz};if(free(both,radius,height,state,feet)){out=both;continue;}const x={x:out.x+dx,z:out.z};if(free(x,radius,height,state,feet))out=x;const z={x:out.x,z:out.z+dz};if(free(z,radius,height,state,feet))out=z;}return out;},
  lineOfSight(a,b,height,state){return !solids(height,state,true).some(r=>segmentRect(a,b,r));},
  validPlacement(p,radius,state){if(!free(p,radius,1.75,state))return false;if(distance(p,world.spawn)<1.5)return false;return ![...world.doors,...world.exits,...world.stations,...world.rooms.map(r=>r.switch)].some(d=>distance(p,d)<radius+1.6);},
  supportHeight(p,state){const overlaps=(r:Rect)=>{const dx=Math.max(Math.abs(p.x-r.x)-r.w/2,0),dz=Math.max(Math.abs(p.z-r.z)-r.d/2,0);return dx*dx+dz*dz<.3*.3;};let y=0;for(const prop of state.props)if(!prop.held&&(prop.y??0)<.1&&overlaps({...prop,w:prop.kind==='box'?.55:.6*prop.scale,d:prop.kind==='box'?.55:.6*prop.scale}))y=Math.max(y,prop.kind==='box'?.55:.4*prop.scale);for(const d of world.desks)if(overlaps({...d,w:1.6,d:.85}))y=Math.max(y,(state.deskHeights[d.id]??.75)+.081);return y;},
  clearance(p,state){let h=Infinity;for(const w of world.walls)if(w.crawl&&inside(p,w,.31))h=Math.min(h,.95);for(const d of world.desks)if(inside(p,{...d,w:1.6,d:.85},.3)&&((p as Vec2 & {y?:number}).y??0)<(state.deskHeights[d.id]??.75))h=Math.min(h,(state.deskHeights[d.id]??.75)-.1);const room=roomAt(p);if(room&&state.pressureRooms.includes(room.id))h=Math.min(h,state.pressureHeights[room.id]??1.6);return h;},
  path(a,b,state){
   const radius=.3-1e-6,height=1.75,rs=solids(height,state);
   const clear=(p:Vec2,q:Vec2)=>!rs.some(r=>segmentRect(p,q,r,radius));
   if(clear(a,b))return [{...b}];
   const cell=.4,cols=Math.ceil(world.width/cell)+1,rows=Math.ceil(world.depth/cell)+1,total=cols*rows;
   // Reuse only occupancy, never a route. Snapshot numbers so in-place solid changes invalidate too.
   if(!navigationCache||navigationCache.width!==world.width||navigationCache.depth!==world.depth||navigationCache.rects.length!==rs.length||rs.some((r,i)=>{const old=navigationCache!.rects[i];return r.x!==old.x||r.z!==old.z||r.w!==old.w||r.d!==old.d;})){
    navigationCache={width:world.width,depth:world.depth,rects:rs.map(r=>({x:r.x,z:r.z,w:r.w,d:r.d})),cells:new Int8Array(total)};
   }
   const openCell=navigationCache.cells;
   const pos=(id:number)=>({x:(id%cols)*cell,z:Math.floor(id/cols)*cell});
   const walk=(id:number)=>{if(id<0||id>=total)return false;if(openCell[id]!==0)return openCell[id]===1;const p=pos(id);const ok=p.x>=radius&&p.z>=radius&&p.x<=world.width-radius&&p.z<=world.depth-radius&&!rs.some(r=>circleHitsRect(p,r,radius));openCell[id]=ok?1:-1;return ok;};
   const nearest=(p:Vec2)=>{const x=Math.round(p.x/cell),z=Math.round(p.z/cell);let best=-1,dist=Infinity;for(let dz=-4;dz<=4;dz++)for(let dx=-4;dx<=4;dx++){const cx=x+dx,cz=z+dz;if(cx<0||cx>=cols||cz<0||cz>=rows)continue;const id=cz*cols+cx;if(!walk(id))continue;const q=pos(id),d=distance(p,q);if(d<dist&&clear(p,q)){best=id;dist=d;}}return best;};
   const start=nearest(a),end=nearest(b);if(start<0||end<0)return [];
   const g=new Float32Array(total);g.fill(Infinity);g[start]=0;const parents=new Int32Array(total);parents.fill(-1);const closed=new Uint8Array(total);
   // Binary heap keeps navigation bounded without scanning the entire frontier each expansion.
   const heap:{id:number;f:number}[]=[];
   const push=(id:number,f:number)=>{let n=heap.length;heap.push({id,f});while(n>0){const p=(n-1)>>1;if(heap[p].f<=f)break;heap[n]=heap[p];n=p;}heap[n]={id,f};};
   const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let n=0;while(n*2+1<heap.length){let c=n*2+1;if(c+1<heap.length&&heap[c+1].f<heap[c].f)c++;if(heap[c].f>=last.f)break;heap[n]=heap[c];n=c;}heap[n]=last;}return first.id;};
   const endpoint=pos(end);push(start,distance(pos(start),endpoint));let found=false;
   while(heap.length){const id=pop();if(closed[id])continue;if(id===end){found=true;break;}closed[id]=1;const x=id%cols,z=Math.floor(id/cols);
    for(const [dx,dz] of navigationDirections){const nx=x+dx,nz=z+dz;if(nx<0||nx>=cols||nz<0||nz>=rows)continue;const next=nz*cols+nx;if(closed[next]||!walk(next))continue;if(dx&&dz&&(!walk(z*cols+nx)||!walk(nz*cols+x)))continue;const cost=g[id]+cell*(dx&&dz?Math.SQRT2:1);if(cost>=g[next])continue;g[next]=cost;parents[next]=id;push(next,cost+distance(pos(next),endpoint));}
   }
   if(!found)return [];const raw:Vec2[]=[{...b}];for(let id=end;id!==start&&id>=0;id=parents[id])raw.push(pos(id));raw.reverse();
   const smooth:Vec2[]=[];let anchor={...a},i=0;while(i<raw.length){let j=i;while(j+1<raw.length&&clear(anchor,raw[j+1]))j++;smooth.push(raw[j]);anchor=raw[j];i=j+1;}return smooth;
  }
 };
 return query;
}
export function pathLength(start:Vec2,path:Vec2[]){let length=0,p=start;for(const next of path){length+=distance(p,next);p=next;}return length;}
