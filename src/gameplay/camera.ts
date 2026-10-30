import type { GameState, Vec2, WorldDef } from '../contracts/game';
import { inside } from '../world/query';
export interface Point3 extends Vec2 {y:number}
/** Pure camera-volume query; no aesthetic choices or mutation of actor state. */
export function resolveCamera(world:WorldDef,state:GameState,focus:Point3,desired:Point3):Point3 {
 const blocked=(p:Point3)=>{
  const room=world.rooms.find(r=>inside(p,r));
  const ceiling=room&&state.pressureRooms.includes(room.id)?1.6:2.8;
  if(p.y<.14||p.y>ceiling-.12)return true;
  for(const w of world.walls)if(inside(p,w,.14)&&p.y<w.height+.12&&(!w.crawl||p.y>.83))return true;
  for(const d of world.desks){const h=state.deskHeights[d.id]??.75;if(inside(p,{...d,w:1.6,d:.85},.14)&&Math.abs(p.y-h)<.2)return true;}
  for(const prop of state.props)if(!prop.held&&(prop.y??0)<.1){const size=prop.kind==='box'?.55:.6*prop.scale,h=prop.kind==='box'?.55:.4*prop.scale;if(inside(p,{...prop,w:size,d:size},.12)&&p.y<h+.12)return true;}
  for(const e of world.exits)if(!state.openedExits.includes(e.id)){const r={x:e.x+e.outward.x*.65,z:e.z+e.outward.z*.65,w:e.outward.x?.2:2.4,d:e.outward.z?.2:2.4};if(inside(p,r,.14)&&p.y<2.42)return true;}
  return false;
 };
 let last={...focus};const length=Math.hypot(desired.x-focus.x,desired.y-focus.y,desired.z-focus.z),steps=Math.max(1,Math.ceil(length/.06));
 for(let i=1;i<=steps;i++){const t=i/steps,p={x:focus.x+(desired.x-focus.x)*t,y:focus.y+(desired.y-focus.y)*t,z:focus.z+(desired.z-focus.z)*t};if(blocked(p))return last;last=p;}return last;
}
