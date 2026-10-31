import { expect,it } from 'vitest';
import { resolveCamera, localPlayerOccluded } from '../src/gameplay/camera';
import { generateWorld } from '../src/world/generate';
import { createGame } from '../src/rules/game';
it('low ceiling blocks the shoulder camera before it crosses the pressure plate',()=>{const w=generateWorld(618),s=createGame(w),r=w.rooms.find(r=>r.pressure)!;s.pressureRooms=[r.id];const p=resolveCamera(w,s,{x:r.x+2,y:.8,z:r.z+3},{x:r.x+2,y:2.65,z:r.z+5});expect(p.y).toBeLessThan(1.49);expect(p.y).toBeGreaterThan(.8);});
it.each([1.551,-.4])('corrects an illegal focus height %s before an obstructed ray can return it',y=>{
 const world=generateWorld(618),state=createGame(world),desk=world.desks.find(item=>item.id==='desk-3')!;
 state.pressureRooms=[desk.roomId];state.pressureHeights[desk.roomId]=1.6;
 const focus={x:desk.x,z:desk.z,y};
 const result=resolveCamera(world,state,focus,{...focus,z:focus.z+2,y:y>0?2.65:-1});
 expect(result.y).toBeGreaterThanOrEqual(.14);expect(result.y).toBeLessThanOrEqual(1.48);
 expect(focus.y).toBe(y);
});

it('removes self-obstruction near the camera without flickering at the clearance boundary',()=>{
 const focus={x:4,y:1.38,z:8};
 const at=(distance:number)=>({...focus,z:focus.z-distance});
 let hidden=localPlayerOccluded(at(.6),focus,false);
 expect(hidden).toBe(true);
 for(const distance of [1.25,1.35,1.21]){
  hidden=localPlayerOccluded(at(distance),focus,hidden);expect(hidden).toBe(true);
 }
 hidden=localPlayerOccluded(at(1.6),focus,hidden);expect(hidden).toBe(false);
 expect(localPlayerOccluded(at(1.35),focus,hidden)).toBe(false);
 expect(localPlayerOccluded(at(3.5),focus,false)).toBe(false);
});
