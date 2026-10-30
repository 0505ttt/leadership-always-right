import { expect,it } from 'vitest';
import { resolveCamera } from '../src/gameplay/camera';
import { generateWorld } from '../src/world/generate';
import { createGame } from '../src/rules/game';
it('low ceiling blocks the shoulder camera before it crosses the pressure plate',()=>{const w=generateWorld(618),s=createGame(w),r=w.rooms.find(r=>r.pressure)!;s.pressureRooms=[r.id];const p=resolveCamera(w,s,{x:r.x+2,y:.8,z:r.z+3},{x:r.x+2,y:2.65,z:r.z+5});expect(p.y).toBeLessThan(1.49);expect(p.y).toBeGreaterThan(.8);});
