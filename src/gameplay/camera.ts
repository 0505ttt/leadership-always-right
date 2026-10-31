import type { GameState, Vec2, WorldDef } from '../contracts/game';
import { DIMENSIONS } from '../contracts/game';
import { inside } from '../world/query';
export interface Point3 extends Vec2 {y:number}
/** Hide the local actor only while the collision-resolved camera is inside its readable shoulder distance. */
export function localPlayerOccluded(camera:Point3,focus:Point3,wasHidden:boolean):boolean {
 // Separate hide/reveal distances stop tiny wall corrections from flashing the actor.
 const clearance=wasHidden?1.5:1.2;
 return Math.hypot(camera.x-focus.x,camera.y-focus.y,camera.z-focus.z)<clearance;
}
/** Pure camera-volume query; no aesthetic choices or mutation of actor state. */
export function resolveCamera(world:WorldDef,state:GameState,focus:Point3,desired:Point3):Point3 {
 const ceilingAt=(p:Point3)=>{
  const room=world.rooms.find(r=>inside(p,r));
  return room&&state.pressureRooms.includes(room.id)?(state.pressureHeights[room.id]??1.6):2.8;
 };
 const blocked=(p:Point3)=>{
  const ceiling=ceilingAt(p);
  if(p.y<.14||p.y>ceiling-.12)return true;
  for(const w of world.walls)if(inside(p,w,.14)&&p.y<w.height+.12&&(!w.crawl||p.y>.83))return true;
  for(const decoration of world.decorationColliders??[])if(inside(p,decoration,.14)&&p.y<decoration.height+.12)return true;
  for(const d of world.desks){const h=state.deskHeights[d.id]??.75;if(inside(p,{...d,w:1.6,d:.85},.14)&&Math.abs(p.y-h)<.2)return true;}
  for(const prop of state.props)if(!prop.held&&(prop.y??0)<.1){const size=prop.kind==='box'?.55:.6*prop.scale,h=prop.kind==='box'?.55:DIMENSIONS.cakeHeight*prop.scale;if(inside(p,{...prop,w:size,d:size},.12)&&p.y<h+.12)return true;}
  for(const e of world.exits)if(!state.openedExits.includes(e.id)){const r={x:e.x+e.outward.x*.65,z:e.z+e.outward.z*.65,w:e.outward.x?.2:2.4,d:e.outward.z?.2:2.4};if(inside(p,r,.14)&&p.y<2.42)return true;}
  return false;
 };
 const start={...focus,y:Math.max(.14,Math.min(focus.y,ceilingAt(focus)-.12))};
 let last={...start};const length=Math.hypot(desired.x-start.x,desired.y-start.y,desired.z-start.z),steps=Math.max(1,Math.ceil(length/.06));
 for(let i=1;i<=steps;i++){const t=i/steps,p={x:start.x+(desired.x-start.x)*t,y:start.y+(desired.y-start.y)*t,z:start.z+(desired.z-start.z)*t};if(blocked(p))return last;last=p;}return last;
}
